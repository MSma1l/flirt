"""Logica de chat: dialoguri per match, mesaje, mascare contacte (TZ secț. 5)."""
from __future__ import annotations

import logging
import uuid
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, true, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Block
from app.models.chat import Chat, Message
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Match
from app.models.user import User
from app.schemas.chat import ChatSummary, MessageOut, MessagePage, PartnerProfileOut
from app.services.chat_media import ChatMedia, build_attachment_key
from app.services.telegram_avatar import avatar_url_for
from app.services.compatibility import compute_compatibility
from app.services.contact_masker import mask_contacts
from app.services.pagination import (
    MESSAGES_MAX_LIMIT,
    MESSAGES_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)
from app.services.storage import get_storage
from app.services import tg_notify

logger = logging.getLogger("app.chat")


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _other_id(chat: Chat, user_id: uuid.UUID) -> uuid.UUID:
    """Id-ul celuilalt participant din chat."""
    return chat.user_b_id if chat.user_a_id == user_id else chat.user_a_id


async def _interests_by_profile(
    db: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    """Mapează profile_id -> set de slug-uri de interese (ca în feed_service)."""
    if not profile_ids:
        return {}
    result = await db.execute(
        select(ProfileInterest.profile_id, Interest.slug)
        .join(Interest, Interest.id == ProfileInterest.interest_id)
        .where(ProfileInterest.profile_id.in_(profile_ids))
    )
    mapping: dict[uuid.UUID, set[str]] = {}
    for profile_id, slug in result.all():
        mapping.setdefault(profile_id, set()).add(slug)
    return mapping


async def _ensure_chat_for_match(db: AsyncSession, match: Match) -> Chat:
    """Întoarce chat-ul match-ului, creându-l idempotent dacă lipsește."""
    result = await db.execute(select(Chat).where(Chat.match_id == match.id))
    chat = result.scalar_one_or_none()
    if chat is None:
        chat = Chat(
            match_id=match.id,
            user_a_id=match.user_a_id,
            user_b_id=match.user_b_id,
        )
        db.add(chat)
        await db.flush()  # avem nevoie de chat.id înainte de commit
    return chat


async def ensure_chat_for_match(db: AsyncSession, match: Match) -> Chat:
    """Wrapper public reutilizabil (ex. din feed_service la producerea unui match).

    Nu comite — apelantul decide momentul commit-ului.
    """
    return await _ensure_chat_for_match(db, match)


async def _get_participant_chat(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> Chat:
    """Încarcă chat-ul verificând că `user` e participant; altfel 404."""
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if chat is None or user.id not in (chat.user_a_id, chat.user_b_id):
        # Nu divulgăm existența unui chat străin → 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found"
        )
    return chat


async def _ensure_not_blocked(
    db: AsyncSession, user_id: uuid.UUID, other_id: uuid.UUID
) -> None:
    """403 dacă există un Block în ORICARE direcție între cei doi participanți.

    Un user blocat nu mai poate interacționa (scrie / reacționa) într-un chat
    deja existent, chiar dacă apartenența la chat e validă (breșă CHAT-BLOCK).
    """
    result = await db.execute(
        select(Block.id).where(
            or_(
                and_(Block.blocker_id == user_id, Block.blocked_id == other_id),
                and_(Block.blocker_id == other_id, Block.blocked_id == user_id),
            )
        )
    )
    if result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interaction blocked between these users",
        )


async def _last_messages_by_chat(
    db: AsyncSession, user: User
) -> dict[uuid.UUID, tuple[str, object, str]]:
    """Ultimul mesaj (body, created_at, kind) din FIECARE chat al userului — O(1) query.

    `LATERAL (SELECT ... WHERE chat_id = c.id ORDER BY created_at DESC, id DESC
    LIMIT 1)` per chat: Postgres coboară în indexul `ix_messages_chat_created`
    (chat_id, created_at) și citește UN rând per chat. Varianta anterioară
    (`ROW_NUMBER() OVER (PARTITION BY chat_id)`) numerota TOATE mesajele din
    toate chat-urile userului la fiecare polling (12s în Mini App) — cost
    proporțional cu istoricul, nu cu numărul de chat-uri.

    Chat-urile fără mesaje lipsesc din dict (JOIN interior) → apelantul pune
    `None`. Cheia de sortare (created_at DESC, id DESC) e aceeași ca înainte.
    """
    last_msg = (
        select(
            Message.body.label("body"),
            Message.created_at.label("created_at"),
            Message.kind.label("kind"),
        )
        .where(Message.chat_id == Chat.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .correlate(Chat)
        .lateral("last_msg")
    )
    result = await db.execute(
        select(
            Chat.id.label("chat_id"),
            last_msg.c.body,
            last_msg.c.created_at,
            last_msg.c.kind,
        )
        .join(last_msg, true())
        .where(or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id))
    )
    return {
        row.chat_id: (row.body, row.created_at, row.kind) for row in result.all()
    }


async def _unread_counts_by_chat(
    db: AsyncSession, user: User
) -> dict[uuid.UUID, int]:
    """Numărul de necitite în FIECARE chat al userului — O(1) query (GROUP BY).

    Înlocuiește un `SELECT COUNT(*)` per chat (N+1). Citește DOAR mesajele
    necitite, prin indexul parțial `ix_messages_unread_chat_sender`
    (chat_id, sender_id) WHERE is_read = false — mesajele citite (marea
    majoritate) nici nu sunt în index. Chat-urile fără necitite
    lipsesc din dict → apelantul folosește 0 ca default.
    """
    result = await db.execute(
        select(Message.chat_id, func.count())
        .join(Chat, Chat.id == Message.chat_id)
        .where(
            or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id),
            Message.sender_id != user.id,
            Message.is_read.is_(False),
        )
        .group_by(Message.chat_id)
    )
    return {chat_id: int(count) for chat_id, count in result.all()}


async def list_chats(db: AsyncSession, user: User) -> list[ChatSummary]:
    """Lista dialogurilor userului (TZ 5.1).

    Pentru fiecare match care îl conține pe user asigură un chat (idempotent),
    apoi compune rezumatul cu datele celuilalt + ultimul mesaj + necitite.

    NUMĂR CONSTANT DE QUERY-URI (endpointul e cel mai *polled* al aplicației —
    mobilul face polling, nu WebSocket): 6 interogări, indiferent dacă userul are
    1 sau 200 de chat-uri. Varianta anterioară făcea 3 query-uri PER CHAT
    (chat-ul match-ului + ultimul mesaj + necitite) — ~600 la 200 de match-uri.
    """
    # 1. Toate match-urile userului.
    matches_result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(matches_result.scalars().all())
    if not matches:
        return []

    # 2. Chat-urile existente ale userului, într-o singură interogare.
    #    (`chats.user_a_id`/`user_b_id` oglindesc participanții match-ului, deci
    #    orice chat al unui match care îl conține pe user apare aici.)
    chats_result = await db.execute(
        select(Chat).where(
            or_(Chat.user_a_id == user.id, Chat.user_b_id == user.id)
        )
    )
    chats = list(chats_result.scalars().all())

    # 3. Creează în BULK chat-urile lipsă (normal: niciunul — chat-ul se creează
    #    odată cu match-ul, în feed_service). Un singur INSERT (executemany).
    existing_match_ids = {c.match_id for c in chats}
    missing = [m for m in matches if m.id not in existing_match_ids]
    if missing:
        new_chats = [
            Chat(
                match_id=m.id,
                user_a_id=m.user_a_id,
                user_b_id=m.user_b_id,
            )
            for m in missing
        ]
        db.add_all(new_chats)
        await db.commit()
        chats.extend(new_chats)

    # 4. Profilurile celorlalți participanți + propriul profil, într-un singur
    #    SELECT (compatibilitatea are nevoie de ambele, TZ 5.2 / 4.6).
    #    Tot aici (JOIN, fără query în plus) vine și poza Telegram — avatarul de
    #    rezervă al celor fără poze proprii.
    other_ids = [_other_id(c, user.id) for c in chats]
    profiles_result = await db.execute(
        select(Profile, User.telegram_photo_url)
        .join(User, User.id == Profile.user_id)
        .where(Profile.user_id.in_([*other_ids, user.id]))
    )
    profiles_by_user: dict[uuid.UUID, Profile] = {}
    tg_photo_by_user: dict[uuid.UUID, str | None] = {}
    for profile_row, tg_photo in profiles_result.all():
        profiles_by_user[profile_row.user_id] = profile_row
        tg_photo_by_user[profile_row.user_id] = tg_photo
    my_profile = profiles_by_user.get(user.id)

    # 5. Interesele mele + ale celorlalți (o singură interogare batch, ca în feed).
    interests_map = await _interests_by_profile(
        db, [p.id for p in profiles_by_user.values()]
    )
    my_interests = (
        interests_map.get(my_profile.id, set()) if my_profile is not None else set()
    )

    # 6. + 7. Ultimul mesaj și necititele pentru TOATE chat-urile — 2 agregate.
    last_by_chat = await _last_messages_by_chat(db, user)
    unread_by_chat = await _unread_counts_by_chat(db, user)

    summaries: list[ChatSummary] = []
    for chat in chats:
        other_id = _other_id(chat, user.id)
        profile = profiles_by_user.get(other_id)

        # Compatibilitatea cu celălalt user (0 dacă lipsește vreun profil).
        if my_profile is not None and profile is not None:
            compatibility = compute_compatibility(
                my_profile, profile, my_interests, interests_map.get(profile.id, set())
            )
        else:
            compatibility = 0

        last_body, last_at, last_kind = last_by_chat.get(chat.id, (None, None, None))

        summaries.append(
            ChatSummary(
                chat_id=chat.id,
                other_user_id=other_id,
                other_name=profile.name if profile else "",
                other_age=_calc_age(profile.birth_date) if profile else None,
                other_city=profile.city if profile else None,
                other_photo_url=(
                    avatar_url_for(profile.photos, tg_photo_by_user.get(other_id))
                    if profile
                    else None
                ),
                last_message=last_body,
                last_message_at=last_at,
                last_message_kind=last_kind,
                unread_count=unread_by_chat.get(chat.id, 0),
                compatibility=compatibility,
            )
        )

    # Cele mai recente dialoguri primele (ultimul mesaj / creare chat).
    summaries.sort(
        key=lambda s: (s.last_message_at is not None, s.last_message_at),
        reverse=True,
    )
    return summaries


async def get_partner_profile(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> PartnerProfileOut:
    """Profilul celuilalt participant, pentru ecranul „profilul partenerului".

    Autorizarea e chiar conversația: doar un participant îl poate cere (altfel
    404, fără a divulga existența chat-ului); un block în ORICARE direcție → 403
    (cine a blocat / a fost blocat nu mai vede pozele celuilalt). Cont banat,
    purjat GDPR sau fără anketă → 404.
    """
    chat = await _get_participant_chat(db, user, chat_id)
    other_id = _other_id(chat, user.id)
    await _ensure_not_blocked(db, user.id, other_id)

    other = await db.get(User, other_id)
    result = await db.execute(
        select(Profile).where(Profile.user_id.in_([other_id, user.id]))
    )
    profiles = {p.user_id: p for p in result.scalars().all()}
    profile = profiles.get(other_id)
    if other is None or other.is_banned or other.is_deleted or profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found"
        )

    my_profile = profiles.get(user.id)
    interests_map = await _interests_by_profile(
        db, [p.id for p in profiles.values()]
    )
    their_interests = interests_map.get(profile.id, set())
    compatibility = (
        compute_compatibility(
            my_profile,
            profile,
            interests_map.get(my_profile.id, set()),
            their_interests,
        )
        if my_profile is not None
        else 0
    )

    own_photos = [p for p in (profile.photos or []) if isinstance(p, str) and p]
    avatar = avatar_url_for(own_photos, other.telegram_photo_url)
    return PartnerProfileOut(
        user_id=other_id,
        name=profile.name,
        age=_calc_age(profile.birth_date),
        gender=profile.gender,
        city=profile.city,
        height_cm=profile.height_cm,
        nationality=profile.nationality,
        languages=list(profile.languages or []),
        about=profile.about,
        dating_statuses=list(profile.dating_statuses or []),
        interests=sorted(their_interests),
        photos=own_photos or ([avatar] if avatar else []),
        avatar_url=avatar,
        verified=bool(profile.verified),
        compatibility=compatibility,
    )


async def get_messages(
    db: AsyncSession,
    user: User,
    chat_id: uuid.UUID,
    limit: int | None = None,
    cursor: str | None = None,
) -> MessagePage:
    """O PAGINĂ de mesaje dintr-un chat, cea mai recentă fereastră prima.

    Înainte întorcea TOATE mesajele chat-ului, fără limită: un chat cu 50.000 de
    mesaje însemna 50.000 de rânduri materializate în RAM + serializate în JSON
    la fiecare deschidere a conversației (OOM garantat pe server).

    Semantica paginării (ca în orice client de chat): pagina 1 conține cele mai
    NOI `limit` mesaje — exact ce vedea userul și înainte, când derula la capătul
    de jos. `next_cursor` duce spre mesaje mai VECHI (scroll în istoric).
    În interiorul paginii mesajele rămân în ordine cronologică crescătoare, ca
    până acum.

    NU MAI MARCHEAZĂ CITIT: un GET nu are voie să mute stare (nu e idempotent,
    strică orice cache/retry HTTP și orice prefetch al clientului). Marcarea se
    face explicit prin `POST /chats/{id}/read`.
    """
    chat = await _get_participant_chat(db, user, chat_id)

    limit = clamp_limit(limit, MESSAGES_PAGE_LIMIT, MESSAGES_MAX_LIMIT)

    stmt = select(Message).where(Message.chat_id == chat.id)
    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul mesajului-ancoră citit DB-side (vezi pagination.py: evită
        # nepotrivirea de format a datetime-urilor între bind și stocare).
        anchor_at = (
            select(Message.created_at)
            .where(Message.id == anchor_id, Message.chat_id == chat.id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Message.created_at < anchor_at,
                and_(
                    Message.created_at == anchor_at,
                    Message.id < anchor_id,
                ),
            )
        )

    # Ordonare TOTALĂ (created_at, id) — `id` e unic, deci nu există egalități
    # ambigue: paginarea nu poate întoarce duplicate și nu poate sări mesaje,
    # chiar dacă mai multe mesaje au același `created_at` (pe SQLite timestampul
    # are rezoluție de o secundă). `limit + 1` = sondă pentru „mai există".
    result = await db.execute(
        stmt.order_by(Message.created_at.desc(), Message.id.desc()).limit(limit + 1)
    )
    rows = list(result.scalars().all())

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].id) if (has_more and rows) else None

    rows.reverse()  # cronologic crescător în interiorul paginii
    return MessagePage(
        items=[MessageOut.model_validate(m) for m in rows],
        next_cursor=next_cursor,
    )


async def send_message(
    db: AsyncSession, user: User, chat_id: uuid.UUID, body: str
) -> MessageOut:
    """Trimite un mesaj: aplică mascarea contactelor și persistă (TZ 5.5)."""
    chat = await _get_participant_chat(db, user, chat_id)
    # Breșă CHAT-BLOCK: un user blocat (oricare direcție) nu poate scrie.
    await _ensure_not_blocked(db, user.id, _other_id(chat, user.id))

    masked_body, was_masked = mask_contacts(body)
    message = Message(
        chat_id=chat.id,
        sender_id=user.id,
        body=masked_body,
        was_masked=was_masked,
        is_read=False,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    _notify_recipient(chat, user, message)
    return MessageOut.model_validate(message)


def _notify_recipient(chat: Chat, sender: User, message: Message) -> None:
    """Notificarea din botul Telegram către celălalt participant — DUPĂ commit.

    Doar programează trimiterea în fundal (`tg_notify`), cu date simple: cererea
    nu așteaptă și nu poate pica din cauza ei. `body` e deja mascat de contacte.
    """
    tg_notify.notify_message(
        chat_id=chat.id,
        sender_id=sender.id,
        recipient_id=_other_id(chat, sender.id),
        kind=message.kind or "text",
        body=message.body,
    )


async def get_writable_chat(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> Chat:
    """Chat-ul în care `user` poate scrie: participant (altfel 404) și neblocat (403).

    Folosit de ruta de atașamente ÎNAINTE de a citi fișierul — un străin sau un
    user blocat nu ne poate umple storage-ul.
    """
    chat = await _get_participant_chat(db, user, chat_id)
    await _ensure_not_blocked(db, user.id, _other_id(chat, user.id))
    return chat


async def send_attachment(
    db: AsyncSession,
    user: User,
    chat: Chat,
    media: ChatMedia,
    caption: str,
) -> MessageOut:
    """Trimite un mesaj media (poză / video / vocal) cu legendă opțională.

    Legenda trece prin aceeași mascare de contacte ca un mesaj text (TZ 5.5);
    fără legendă `body` e "" (coloana rămâne NOT NULL pentru clienții vechi).
    Fișierul se salvează în storage sub o cheie aleatoare; dacă persistarea
    mesajului pică, îl ștergem (best-effort) ca să nu rămână orfan.
    """
    masked_body, was_masked = mask_contacts(caption) if caption else ("", False)

    storage = get_storage()
    key = build_attachment_key(chat.id, media.mime)
    url = await storage.save(key, media.content, media.mime)

    message = Message(
        chat_id=chat.id,
        sender_id=user.id,
        body=masked_body,
        was_masked=was_masked,
        is_read=False,
        kind=media.kind,
        attachment_url=url,
        attachment_mime=media.mime,
        attachment_size=len(media.content),
        attachment_duration_ms=media.duration_ms,
        attachment_width=media.width,
        attachment_height=media.height,
    )
    db.add(message)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        try:
            await storage.delete(url)
        except Exception:  # noqa: BLE001 — curățenia nu maschează eroarea reală
            logger.warning("Atașament orfan neșters: %s", url, exc_info=True)
        raise
    await db.refresh(message)
    _notify_recipient(chat, user, message)
    return MessageOut.model_validate(message)


async def react_to_message(
    db: AsyncSession,
    user: User,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    reaction: str | None,
) -> MessageOut:
    """Setează (sau scoate cu None) reacția la un mesaj din chat (TZ 5.2).

    Poți reacționa la orice mesaj din chatul tău. 404 dacă userul nu e
    participant la chat sau dacă mesajul nu aparține acelui chat.
    """
    chat = await _get_participant_chat(db, user, chat_id)
    # Breșă CHAT-BLOCK: un user blocat (oricare direcție) nu poate reacționa.
    await _ensure_not_blocked(db, user.id, _other_id(chat, user.id))

    result = await db.execute(
        select(Message).where(
            Message.id == message_id, Message.chat_id == chat.id
        )
    )
    message = result.scalar_one_or_none()
    if message is None:
        # Mesaj inexistent sau din alt chat → nu divulgăm → 404.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        )

    message.reaction = reaction  # None scoate reacția
    await db.commit()
    await db.refresh(message)
    return MessageOut.model_validate(message)


async def mark_read(db: AsyncSession, user: User, chat_id: uuid.UUID) -> None:
    """Marchează citite toate mesajele primite din chat (endpoint dedicat)."""
    chat = await _get_participant_chat(db, user, chat_id)
    await _mark_read(db, chat, user)


async def _mark_read(db: AsyncSession, chat: Chat, user: User) -> None:
    """Setează `is_read=True` pe mesajele primite de la celălalt participant.

    UN SINGUR `UPDATE ... WHERE` — varianta anterioară SELECTA toate mesajele
    necitite, le încărca în Python și le muta una câte una (un chat cu 5.000 de
    necitite = 5.000 de obiecte în RAM + 5.000 de UPDATE-uri la flush).
    """
    await db.execute(
        update(Message)
        .where(
            Message.chat_id == chat.id,
            Message.sender_id != user.id,
            Message.is_read.is_(False),
        )
        .values(is_read=True)
        # Nu sincronizăm sesiunea: nu ținem mesajele încărcate în identity map.
        .execution_options(synchronize_session=False)
    )
    # Comitem necondiționat: statement-ul a deschis oricum o tranzacție, iar un
    # UPDATE care nu a atins niciun rând nu schimbă nimic.
    await db.commit()
