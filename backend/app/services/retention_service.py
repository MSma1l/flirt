"""Retenția datelor — ce se șterge/anonimizează și CÂND (Politica de confidențialitate, secț. 10).

Două roluri, ambele rulate de serviciul `purge` (`scripts/gdpr_purge.py`):

1. La PURJAREA unui cont (`account_service.purge_user_data`):
   * `collect_purge_media_urls` — fișierele din storage legate de rândurile care
     se șterg: pozele de profil, poveștile, atașamentele mesajelor din chat
     (`chat-media/`). Fără asta rândul dispărea, dar fișierul rămânea pe disc/S3.
   * `anonymize_ticket_orders` — comenzile de bilet NU se șterg (Legea 287/2017 a
     contabilității și raportării financiare cere păstrarea documentelor contabile
     primare), dar li se golesc datele personale: nume, telefon, e-mail, mesajele
     și notele, descrierea plății (conținea numele). Rămân: suma, moneda,
     cantitatea, referința de plată, evenimentul, datele și statusul. Legătura
     `user_id` rămâne spre rândul `users` ANONIMIZAT (tombstone; FK NOT NULL).
     Dovezile comenzilor respinse/anulate (nu sunt documente contabile) se șterg
     imediat; celelalte rămân până la expirarea termenului contabil (pct. 2).
   * `delete_files` — șterge efectiv fișierele (idempotent, tolerant la erori).

2. Periodic (`purge_expired_payment_proofs`):
   * dovezile de plată mai vechi de `PAYMENT_PROOF_RETENTION_DAYS` (de la crearea
     comenzii) — fișier șters + `payment_proof_url = NULL`;
   * dovezile comenzilor RESPINSE/ANULATE mai vechi de
     `REJECTED_PAYMENT_PROOF_RETENTION_DAYS` (de la decizie / ultima modificare).

Modelul `TicketOrder` e doar CITIT/ACTUALIZAT de aici (nu-l modificăm): logica
de comenzi rămâne în `ticket_order_service`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.chat import Chat, Message
from app.models.profile import Profile
from app.models.story import Story
from app.models.ticket_order import STATUS_CANCELLED, STATUS_REJECTED, TicketOrder
from app.services.storage import get_storage

log = logging.getLogger("app.retention")

# Comenzile care NU documentează o plată încasată: dovada lor nu e document
# contabil, deci nu se păstrează pe termenul contabil.
NON_ACCOUNTING_STATUSES = (STATUS_REJECTED, STATUS_CANCELLED)

_BATCH = 500


# --- Purjarea unui cont -------------------------------------------------------
async def collect_purge_media_urls(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """URL-urile fișierelor care devin orfane când `purge_user_data` șterge rândurile.

    Trebuie apelată ÎNAINTE de ștergeri. Acoperă exact mesajele pe care purjarea
    le șterge: cele trimise de user + toate mesajele din chat-urile lui.
    """
    urls: list[str] = []

    photos = (
        await db.execute(select(Profile.photos).where(Profile.user_id == user_id))
    ).scalars().all()
    for lst in photos:
        for item in lst or []:
            if isinstance(item, str):
                urls.append(item)
            elif isinstance(item, dict) and isinstance(item.get("url"), str):
                urls.append(item["url"])

    urls.extend(
        (await db.execute(select(Story.media_url).where(Story.user_id == user_id)))
        .scalars()
        .all()
    )

    chat_ids = select(Chat.id).where(
        or_(Chat.user_a_id == user_id, Chat.user_b_id == user_id)
    )
    urls.extend(
        (
            await db.execute(
                select(Message.attachment_url).where(
                    Message.attachment_url.is_not(None),
                    or_(Message.sender_id == user_id, Message.chat_id.in_(chat_ids)),
                )
            )
        )
        .scalars()
        .all()
    )
    # Ordinea păstrată, fără duplicate.
    return list(dict.fromkeys(u for u in urls if u))


async def anonymize_ticket_orders(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """Golește datele personale din comenzile userului; întoarce dovezile de șters ACUM.

    Nu face commit. Idempotentă.
    """
    proofs_now = (
        await db.execute(
            select(TicketOrder.payment_proof_url).where(
                TicketOrder.user_id == user_id,
                TicketOrder.status.in_(NON_ACCOUNTING_STATUSES),
                TicketOrder.payment_proof_url.is_not(None),
            )
        )
    ).scalars().all()

    await db.execute(
        update(TicketOrder)
        .where(TicketOrder.user_id == user_id)
        .values(
            full_name=None,
            phone=None,
            email=None,
            client_message=None,
            user_note=None,
            admin_note=None,
            payment_description=None,
        )
    )
    if proofs_now:
        await db.execute(
            update(TicketOrder)
            .where(
                TicketOrder.user_id == user_id,
                TicketOrder.status.in_(NON_ACCOUNTING_STATUSES),
            )
            .values(payment_proof_url=None)
        )
    return list(proofs_now)


async def delete_files(urls: Iterable[str]) -> int:
    """Șterge fișierele din storage. O eroare pe un fișier nu oprește restul.

    Întoarce câte ștergeri au reușit (no-op-urile storage-ului contează ca reușite).
    """
    storage = get_storage()
    done = 0
    for url in urls:
        try:
            await storage.delete(url)
            done += 1
        except Exception:  # noqa: BLE001 — logăm și continuăm
            log.exception("retenție: ștergerea fișierului a eșuat")
    return done


# --- Retenția periodică a dovezilor de plată --------------------------------
async def _purge_proofs_where(db: AsyncSession, condition) -> int:
    total = 0
    while True:
        rows = (
            await db.execute(
                select(TicketOrder.id, TicketOrder.payment_proof_url)
                .where(TicketOrder.payment_proof_url.is_not(None), condition)
                .limit(_BATCH)
            )
        ).all()
        if not rows:
            return total
        await delete_files(url for _, url in rows)
        await db.execute(
            update(TicketOrder)
            .where(TicketOrder.id.in_([oid for oid, _ in rows]))
            .values(payment_proof_url=None)
        )
        await db.commit()
        total += len(rows)
        if len(rows) < _BATCH:
            return total


async def purge_expired_payment_proofs(
    db: AsyncSession, now: datetime | None = None
) -> int:
    """Șterge dovezile de plată ieșite din termenul de retenție. Face commit.

    Întoarce numărul de comenzi a căror dovadă a fost ștearsă.
    """
    now = now or datetime.now(timezone.utc)
    accounting_cutoff = now - timedelta(days=settings.payment_proof_retention_days)
    rejected_cutoff = now - timedelta(
        days=settings.rejected_payment_proof_retention_days
    )
    n = await _purge_proofs_where(db, TicketOrder.created_at < accounting_cutoff)
    n += await _purge_proofs_where(
        db,
        and_(
            TicketOrder.status.in_(NON_ACCOUNTING_STATUSES),
            func.coalesce(TicketOrder.decided_at, TicketOrder.updated_at)
            < rejected_cutoff,
        ),
    )
    return n
