"""SCANAREA biletelor la intrarea în eveniment (staff cu telefonul, fără aplicație).

CE CODURI EXISTĂ (și ce conține QR-ul): QR-ul unui BILET conține codul BRUT,
32 de caractere hex (uuid4().hex), fără prefix sau URL:
  * `TicketOrder.ticket_code` — biletul plătit la UN eveniment (emis la aprobare);
                                tastat de mână: prefix SAU sufix unic ≥ 8 caractere
                                (Mini App-ul afișează ultimele 8 drept cod scurt);
  * `Ticket.code`             — biletul one-time Flirt Party al userului, NELEGAT
                                de un eveniment; e consumat la prima scanare
                                reușită la un eveniment de tip `flirt_party`.
QR-ul FLIRT PASSPORT (personal, nu un bilet) e `FLIRTP-<32 hex>` (`users.passport_token`);
normalizat devine `flirtp<32 hex>` — prefixul nu e hex, deci nu se ciocnește cu
codurile de bilet. Scanarea lui caută biletul PLĂTIT al omului la evenimentul ales
(→ fluxul de bilet, `via="passport"`); fără bilet → `no_ticket`, iar staff-ul poate
înregistra intrarea plătită CASH la ușă (`door_admit`, tabela `event_door_admissions`).

REZULTATE (în ordinea verificărilor — primul care se potrivește câștigă):
  not_found        codul nu există (sau e prea scurt/ambiguu);
  no_ticket        pașaport valid, dar omul n-are bilet plătit la eveniment;
  wrong_event      biletul e pentru alt eveniment (Flirt Party: evenimentul
                   scanat nu e de tip `flirt_party`);
  cancelled        comanda a fost respinsă/anulată;
  not_paid         comanda nu e (încă) aprobată;
  already_admitted biletul a fost deja scanat (cu ora + cine l-a scanat);
  event_over       evenimentul s-a terminat (vezi `ticket_lifecycle`);
  admitted         intrare permisă ACUM.

ATOMICITATE: admiterea e un UPDATE CONDIȚIONAT (`… WHERE admitted_at IS NULL`).
Două scanări simultane ale aceluiași bilet (doi oameni la două uși): Postgres
serializează UPDATE-urile pe rând, al doilea re-evaluează condiția după commit-ul
primului și nu mai găsește rândul → `already_admitted` cu ora ORIGINALĂ.

După admitere emitem și ștampila Flirt Passport pentru eveniment, refolosind
`event_service.checkin` (idempotent: unic per (event, user)).
"""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.account import Ticket
from app.models.admin import ACTION_TICKET_ADMIT
from app.models.event import (
    DOOR_PAYMENT_CASH,
    Event,
    EventDoorAdmission,
    FlirtPassportStamp,
)
from app.models.profile import Profile
from app.models.ticket_order import (
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_REJECTED,
    TicketOrder,
)
from app.models.user import User
from app.schemas.ticket_scan import (
    AdmissionOut,
    ScannedTicketOut,
    ScanStatsOut,
    TicketScanOut,
)
from app.services import event_service, loyalty
from app.services.admin_service import audit
from app.services.ticket_lifecycle import event_is_over

log = logging.getLogger("app.ticket_scan")

# Tipul de eveniment la care e valabil biletul one-time Flirt Party.
FLIRT_PARTY_KIND = "flirt_party"

# Codul tastat de mână: minim atâtea caractere ca prefix (în cadrul evenimentului
# scanat), ca staff-ul să nu tasteze 32 de caractere. 8 hex = 4 miliarde de
# combinații per eveniment — ghicirea e impracticabilă, mai ales cu rate limit.
MIN_PREFIX_LENGTH = 8
FULL_CODE_LENGTH = 32
# Limita listei de intrări recente.
ADMISSIONS_DEFAULT_LIMIT = 50

_SEPARATORS = re.compile(r"[\s\-_]+")
_VALID_CODE = re.compile(r"[0-9a-z]{1,64}")
_HEX = re.compile(r"[0-9a-f]+")
# QR-ul Flirt Passport după `normalize_code`: `flirtp` + tokenul de 32 hex.
_PASSPORT_CODE = re.compile(r"flirtp([0-9a-f]{32})")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_code(raw: str) -> str | None:
    """Textul scanat/tastat → codul canonic (litere mici, fără separatori).

    Acceptă și un URL (dacă în viitor QR-ul va conține un link): ia `?code=` sau
    ultimul segment al căii. Întoarce None dacă rezultatul nu arată a cod.
    """
    s = (raw or "").strip()
    if "/" in s or "?" in s:
        parts = urlsplit(s)
        query_code = parse_qs(parts.query).get("code")
        if query_code:
            s = query_code[0]
        else:
            s = (parts.path or s).rstrip("/").rsplit("/", 1)[-1]
    s = _SEPARATORS.sub("", s).lower()
    if not _VALID_CODE.fullmatch(s):
        return None
    return s


def _calc_age(birth_date: date | None, today: date | None = None) -> int | None:
    if birth_date is None:
        return None
    today = today or date.today()
    return today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )


def _first_name(name: str | None) -> str | None:
    if not name:
        return None
    return name.strip().split()[0] if name.strip() else None


@dataclass
class _Holder:
    first_name: str | None
    age: int | None
    photo_url: str | None


async def _holder(db: AsyncSession, user_id: uuid.UUID) -> _Holder:
    profile = await db.scalar(select(Profile).where(Profile.user_id == user_id))
    if profile is None:
        return _Holder(None, None, None)
    photos = profile.photos or []
    return _Holder(
        first_name=_first_name(profile.name),
        age=_calc_age(profile.birth_date),
        photo_url=photos[0] if photos else None,
    )


async def _email(db: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    return await db.scalar(select(User.email).where(User.id == user_id))


async def _get_event_or_404(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return event


async def _find_order(
    db: AsyncSession, code: str, event: Event
) -> TicketOrder | None:
    """Comanda după cod exact; altfel după PREFIX sau SUFIX unic în evenimentul
    scanat (codul scurt din Mini App = ultimele 8 caractere ale `ticket_code`)."""
    order = await db.scalar(select(TicketOrder).where(TicketOrder.ticket_code == code))
    if order is not None:
        return order
    if MIN_PREFIX_LENGTH <= len(code) < FULL_CODE_LENGTH and _HEX.fullmatch(code):
        # `code` e doar hex (verificat mai sus) → fără caractere speciale LIKE.
        candidates = (
            await db.scalars(
                select(TicketOrder)
                .where(
                    TicketOrder.event_id == event.id,
                    or_(
                        TicketOrder.ticket_code.like(f"{code}%"),
                        TicketOrder.ticket_code.like(f"%{code}"),
                    ),
                )
                .limit(2)
            )
        ).all()
        if len(candidates) == 1:
            return candidates[0]
    return None


async def _stamp_passport(db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID) -> bool:
    """Ștampila Flirt Passport pentru eveniment — best effort, idempotentă.

    Admiterea e deja commit-uită; o ștampilă eșuată (ex. cursă cu check-in-ul
    făcut chiar de user) nu are voie să transforme intrarea într-o eroare.
    Întoarce True dacă a făcut rollback (apelantul își reîncarcă obiectele:
    rollback-ul le expiră, iar în async un acces leneș ar exploda).
    """
    holder = await db.get(User, user_id)
    if holder is None:
        return False
    try:
        await event_service.checkin(db, holder, event_id)
    except IntegrityError:
        # Ștampila a fost creată în paralel (unicitate pe pereche) — e deja acolo.
        await db.rollback()
        return True
    except Exception:  # noqa: BLE001 — nu stricăm intrarea pentru o ștampilă
        await db.rollback()
        log.exception("passport stamp failed after admission")
        return True
    return False


def _ticket_out(
    *,
    ticket_type: str,
    holder: _Holder,
    event: Event | None,
    quantity: int,
    admitted_at: datetime | None,
    admitted_by_email: str | None,
    stamps: int | None = None,
    discount_percent: int | None = None,
) -> ScannedTicketOut:
    return ScannedTicketOut(
        ticket_type=ticket_type,
        first_name=holder.first_name,
        age=holder.age,
        photo_url=holder.photo_url,
        event_id=event.id if event else None,
        event_title=event.title if event else None,
        starts_at=event.starts_at if event else None,
        ticket_quantity=quantity,
        admitted_at=admitted_at,
        admitted_by_email=admitted_by_email,
        stamps=stamps,
        discount_percent=discount_percent,
    )


async def _scan_order(
    db: AsyncSession, actor: User, order: TicketOrder, event: Event, ip: str | None
) -> TicketScanOut:
    holder = await _holder(db, order.user_id)
    quantity = order.ticket_quantity or 1

    async def out(result: str, ticket_event: Event) -> TicketScanOut:
        return TicketScanOut(
            result=result,
            ticket=_ticket_out(
                ticket_type="event_ticket",
                holder=holder,
                event=ticket_event,
                quantity=quantity,
                admitted_at=order.admitted_at,
                admitted_by_email=await _email(db, order.admitted_by),
            ),
        )

    if order.event_id != event.id:
        return await out("wrong_event", await db.get(Event, order.event_id))
    if order.status in (STATUS_REJECTED, STATUS_CANCELLED):
        return await out("cancelled", event)
    if order.status != STATUS_APPROVED:
        return await out("not_paid", event)
    if order.admitted_at is not None:
        return await out("already_admitted", event)
    if event_is_over(event):
        return await out("event_over", event)

    now = _now()
    res = await db.execute(
        update(TicketOrder)
        .where(
            TicketOrder.id == order.id,
            TicketOrder.admitted_at.is_(None),
            TicketOrder.status == STATUS_APPROVED,
        )
        .values(admitted_at=now, admitted_by=actor.id)
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        # Altă scanare a câștigat cursa: citim ora ORIGINALĂ a intrării.
        await db.rollback()
        await db.refresh(order)
        await db.refresh(event)
        return await out("already_admitted", event)

    audit(
        db,
        actor,
        ACTION_TICKET_ADMIT,
        target_type="ticket_order",
        target_id=order.id,
        meta={"event_id": str(event.id), "quantity": quantity},
        ip=ip,
    )
    await db.commit()
    await db.refresh(order)
    if await _stamp_passport(db, order.user_id, event.id):
        await db.refresh(order)
        await db.refresh(event)
    return await out("admitted", event)


async def _scan_party_ticket(
    db: AsyncSession, actor: User, ticket: Ticket, event: Event, ip: str | None
) -> TicketScanOut:
    holder = await _holder(db, ticket.user_id)

    async def out(result: str, ticket_event: Event | None) -> TicketScanOut:
        return TicketScanOut(
            result=result,
            ticket=_ticket_out(
                ticket_type="flirt_party",
                holder=holder,
                event=ticket_event,
                quantity=1,
                admitted_at=ticket.admitted_at,
                admitted_by_email=await _email(db, ticket.admitted_by),
            ),
        )

    if ticket.admitted_at is not None or ticket.used:
        admitted_event = (
            await db.get(Event, ticket.admitted_event_id)
            if ticket.admitted_event_id
            else None
        )
        return await out("already_admitted", admitted_event)
    if event.kind != FLIRT_PARTY_KIND:
        return await out("wrong_event", None)
    if event_is_over(event):
        return await out("event_over", event)

    now = _now()
    res = await db.execute(
        update(Ticket)
        .where(
            Ticket.id == ticket.id,
            Ticket.admitted_at.is_(None),
            Ticket.used.is_(False),
        )
        .values(
            admitted_at=now,
            admitted_by=actor.id,
            admitted_event_id=event.id,
            used=True,
        )
        .execution_options(synchronize_session=False)
    )
    if res.rowcount != 1:
        await db.rollback()
        await db.refresh(ticket)
        await db.refresh(event)
        admitted_event = (
            await db.get(Event, ticket.admitted_event_id)
            if ticket.admitted_event_id
            else None
        )
        return await out("already_admitted", admitted_event)

    audit(
        db,
        actor,
        ACTION_TICKET_ADMIT,
        target_type="flirt_party_ticket",
        target_id=ticket.id,
        meta={"event_id": str(event.id)},
        ip=ip,
    )
    await db.commit()
    await db.refresh(ticket)
    if await _stamp_passport(db, ticket.user_id, event.id):
        await db.refresh(ticket)
        await db.refresh(event)
    return await out("admitted", event)


async def scan(
    db: AsyncSession,
    actor: User,
    raw_code: str,
    event_id: uuid.UUID,
    ip: str | None = None,
) -> TicketScanOut:
    """Verifică un bilet la intrarea în `event_id` și, dacă e în regulă, îl admite."""
    event = await _get_event_or_404(db, event_id)
    code = normalize_code(raw_code)
    if code is None:
        return TicketScanOut(result="not_found")

    passport = _PASSPORT_CODE.fullmatch(code)
    if passport is not None:
        return await _scan_passport(db, actor, passport.group(1), event, ip)

    order = await _find_order(db, code, event)
    if order is not None:
        return await _scan_order(db, actor, order, event, ip)

    ticket = await db.scalar(select(Ticket).where(Ticket.code == code))
    if ticket is not None:
        return await _scan_party_ticket(db, actor, ticket, event, ip)

    return TicketScanOut(result="not_found")


# --------------------------------------------------------------------------- #
# Flirt Passport: identificarea omului + intrarea cash la ușă
# --------------------------------------------------------------------------- #
async def _passport_user(db: AsyncSession, code: str | None) -> User | None:
    """Userul după QR-ul Flirt Passport normalizat; None = nu e un QR de pașaport
    sau tokenul nu există."""
    match = _PASSPORT_CODE.fullmatch(code or "")
    if match is None:
        return None
    return await db.scalar(select(User).where(User.passport_token == match.group(1)))


async def _paid_order(db: AsyncSession, user: User, event: Event) -> TicketOrder | None:
    """Comanda APROBATĂ a userului la eveniment — întâi una încă neadmisă (un om
    poate avea mai multe cereri aprobate), altfel una deja admisă."""
    return await db.scalar(
        select(TicketOrder)
        .where(
            TicketOrder.user_id == user.id,
            TicketOrder.event_id == event.id,
            TicketOrder.status == STATUS_APPROVED,
        )
        .order_by(TicketOrder.admitted_at.is_not(None), TicketOrder.created_at.desc())
        .limit(1)
    )


async def _with_loyalty(db: AsyncSession, user: User, out: TicketScanOut) -> TicketScanOut:
    """Marchează rezultatul ca venit din pașaport și adaugă ștampilele + reducerea
    treptei curente de fidelitate (citite DUPĂ o eventuală ștampilă nouă)."""
    out.via = "passport"
    if out.ticket is not None:
        # Un rollback din fluxul de bilet (cursă la ștampilă) expiră obiectele —
        # în async un acces leneș ar exploda, deci reîncărcăm explicit.
        await db.refresh(user)
        status_ = await loyalty.get_status(db, user)
        out.ticket.stamps = status_.stamps
        out.ticket.discount_percent = status_.discount_percent
    return out


async def _door_out(
    db: AsyncSession,
    result: str,
    user: User,
    event: Event,
    row: EventDoorAdmission | None,
) -> TicketScanOut:
    holder = await _holder(db, user.id)
    out = TicketScanOut(
        result=result,
        ticket=_ticket_out(
            ticket_type="door_cash",
            holder=holder,
            event=event,
            quantity=1,
            admitted_at=row.admitted_at if row else None,
            admitted_by_email=await _email(db, row.admitted_by) if row else None,
        ),
    )
    return await _with_loyalty(db, user, out)


async def _door_row(
    db: AsyncSession, user: User, event: Event
) -> EventDoorAdmission | None:
    return await db.scalar(
        select(EventDoorAdmission).where(
            EventDoorAdmission.event_id == event.id,
            EventDoorAdmission.user_id == user.id,
        )
    )


async def _scan_passport(
    db: AsyncSession, actor: User, token: str, event: Event, ip: str | None
) -> TicketScanOut:
    """QR-ul Flirt Passport: biletul plătit al omului → fluxul de bilet; altfel
    intrarea cash deja înregistrată → `already_admitted`; altfel `no_ticket`."""
    user = await db.scalar(select(User).where(User.passport_token == token))
    if user is None:
        return TicketScanOut(result="not_found", via="passport")
    order = await _paid_order(db, user, event)
    if order is not None:
        return await _with_loyalty(db, user, await _scan_order(db, actor, order, event, ip))
    row = await _door_row(db, user, event)
    if row is not None:
        return await _door_out(db, "already_admitted", user, event, row)
    return await _door_out(db, "no_ticket", user, event, None)


async def _stamp_passport_door(db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID) -> None:
    """Ștampila pentru intrarea cash — FĂRĂ `billing.consume_event_entry`.

    `event_service.checkin` consumă o intrare din cardul de reduceri al omului;
    la plata cash la ușă omul n-a folosit cardul, deci emitem ștampila direct.
    Idempotentă (ON CONFLICT pe perechea unică) și best effort, ca la bilet.
    """
    try:
        await db.execute(
            pg_insert(FlirtPassportStamp)
            .values(id=uuid.uuid4(), event_id=event_id, user_id=user_id, stamped_at=_now())
            .on_conflict_do_nothing(index_elements=["event_id", "user_id"])
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — nu stricăm intrarea pentru o ștampilă
        await db.rollback()
        log.exception("passport stamp failed after door admission")


async def door_admit(
    db: AsyncSession,
    actor: User,
    raw_code: str,
    event_id: uuid.UUID,
    ip: str | None = None,
) -> TicketScanOut:
    """„Achitat cash": înregistrează intrarea la ușă a omului cu QR-ul Flirt Passport.

    Dacă omul are totuși bilet online plătit, se admite BILETUL (fluxul normal de
    scanare) — fără dublă evidență. Unicitatea (event, user) e impusă de DB:
    două apăsări simultane → o singură intrare, a doua vede `already_admitted`.
    """
    event = await _get_event_or_404(db, event_id)
    user = await _passport_user(db, normalize_code(raw_code))
    if user is None:
        return TicketScanOut(result="not_found", via="passport")

    order = await _paid_order(db, user, event)
    if order is not None:
        return await _with_loyalty(db, user, await _scan_order(db, actor, order, event, ip))

    row = await _door_row(db, user, event)
    if row is not None:
        return await _door_out(db, "already_admitted", user, event, row)
    if event_is_over(event):
        return await _door_out(db, "event_over", user, event, None)

    inserted = await db.scalar(
        pg_insert(EventDoorAdmission)
        .values(
            id=uuid.uuid4(),
            event_id=event.id,
            user_id=user.id,
            payment_method=DOOR_PAYMENT_CASH,
            admitted_at=_now(),
            admitted_by=actor.id,
        )
        .on_conflict_do_nothing(index_elements=["event_id", "user_id"])
        .returning(EventDoorAdmission.id)
    )
    if inserted is None:
        # Altă apăsare a câștigat cursa: arătăm intrarea ORIGINALĂ.
        await db.commit()
        return await _door_out(db, "already_admitted", user, event, await _door_row(db, user, event))

    audit(
        db,
        actor,
        ACTION_TICKET_ADMIT,
        target_type="event_door_admission",
        target_id=inserted,
        meta={
            "event_id": str(event.id),
            "user_id": str(user.id),
            "payment_method": DOOR_PAYMENT_CASH,
        },
        ip=ip,
    )
    await db.commit()
    await _stamp_passport_door(db, user.id, event.id)
    return await _door_out(db, "admitted", user, event, await _door_row(db, user, event))


async def scan_stats(db: AsyncSession, event_id: uuid.UUID) -> ScanStatsOut:
    """Contorul live „intrați / vânduți" pentru evenimentul scanat."""
    event = await _get_event_or_404(db, event_id)
    quantity = func.coalesce(func.sum(TicketOrder.ticket_quantity), 0)
    approved = (TicketOrder.event_id == event.id, TicketOrder.status == STATUS_APPROVED)
    sold = await db.scalar(select(quantity).where(*approved)) or 0
    admitted_orders = (
        await db.scalar(select(quantity).where(*approved, TicketOrder.admitted_at.is_not(None)))
        or 0
    )
    party = (
        await db.scalar(
            select(func.count()).select_from(Ticket).where(Ticket.admitted_event_id == event.id)
        )
        or 0
    )
    door = (
        await db.scalar(
            select(func.count())
            .select_from(EventDoorAdmission)
            .where(EventDoorAdmission.event_id == event.id)
        )
        or 0
    )
    return ScanStatsOut(
        event_id=event.id,
        sold=int(sold),
        admitted=int(admitted_orders) + int(party) + int(door),
        flirt_party_admitted=int(party),
        door_admitted=int(door),
    )


async def list_admissions(
    db: AsyncSession, event_id: uuid.UUID, limit: int = ADMISSIONS_DEFAULT_LIMIT
) -> list[AdmissionOut]:
    """Intrările recente la eveniment (cele mai noi primele)."""
    event = await _get_event_or_404(db, event_id)
    admin = aliased(User)

    order_rows = (
        await db.execute(
            select(TicketOrder, Profile, admin.email)
            .outerjoin(Profile, Profile.user_id == TicketOrder.user_id)
            .outerjoin(admin, admin.id == TicketOrder.admitted_by)
            .where(TicketOrder.event_id == event.id, TicketOrder.admitted_at.is_not(None))
            .order_by(TicketOrder.admitted_at.desc())
            .limit(limit)
        )
    ).all()
    party_rows = (
        await db.execute(
            select(Ticket, Profile, admin.email)
            .outerjoin(Profile, Profile.user_id == Ticket.user_id)
            .outerjoin(admin, admin.id == Ticket.admitted_by)
            .where(Ticket.admitted_event_id == event.id, Ticket.admitted_at.is_not(None))
            .order_by(Ticket.admitted_at.desc())
            .limit(limit)
        )
    ).all()
    door_rows = (
        await db.execute(
            select(EventDoorAdmission, Profile, admin.email)
            .outerjoin(Profile, Profile.user_id == EventDoorAdmission.user_id)
            .outerjoin(admin, admin.id == EventDoorAdmission.admitted_by)
            .where(EventDoorAdmission.event_id == event.id)
            .order_by(EventDoorAdmission.admitted_at.desc())
            .limit(limit)
        )
    ).all()

    def row(ticket_type: str, profile: Profile | None, quantity: int, at: datetime, by: str | None) -> AdmissionOut:
        photos = (profile.photos or []) if profile else []
        return AdmissionOut(
            ticket_type=ticket_type,
            first_name=_first_name(profile.name) if profile else None,
            age=_calc_age(profile.birth_date) if profile else None,
            photo_url=photos[0] if photos else None,
            ticket_quantity=quantity,
            admitted_at=at,
            admitted_by_email=by,
        )

    items = [
        row("event_ticket", p, o.ticket_quantity or 1, o.admitted_at, email)
        for o, p, email in order_rows
    ] + [row("flirt_party", p, 1, t.admitted_at, email) for t, p, email in party_rows] + [
        row("door_cash", p, 1, d.admitted_at, email) for d, p, email in door_rows
    ]
    items.sort(key=lambda a: a.admitted_at, reverse=True)
    return items[:limit]
