"""Logica de CUMPĂRARE BILET ONLINE prin transfer bancar cu verificare manuală.

Concentrat aici (nu în rute) după convenția proiectului: rutele rămân subțiri,
serviciul deține accesul la DB, commit-urile și regulile de tranziție de stare.

SINGLETON `PaymentSettings`
---------------------------
Datele bancare globale stau într-un singur rând, `id == 1`. `_get_or_create_settings`
îl citește și îl creează LENEȘ cu placeholder-uri goale dacă lipsește — exact ca
`ad_service` cu `AdSettings`.

TRANZIȚII DE STARE (impuse strict; un client nu poate „sări" pași)
  awaiting_payment → payment_declared   (userul: `declare`)
  awaiting_payment | payment_declared → approved   (adminul: `approve`)
  awaiting_payment | payment_declared → rejected   (adminul: `reject`)
O comandă deja `approved`/`rejected` e finală → orice nouă decizie dă 409.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import (
    ACTION_PAYMENT_SETTINGS_UPDATE,
    ACTION_TICKET_ORDER_APPROVE,
    ACTION_TICKET_ORDER_REJECT,
)
from app.models.event import Event
from app.models.ticket_order import (
    DEFAULT_CURRENCY,
    PAYMENT_SETTINGS_ID,
    STATUS_APPROVED,
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_REJECTED,
    PaymentSettings,
    TicketOrder,
    user_payment_ref,
)
from app.models.user import User
from app.schemas.ticket_order import (
    AdminTicketOrderOut,
    PaymentInstructions,
    PaymentSettingsIn,
    PaymentSettingsOut,
    TicketOrderCreateOut,
    TicketOrderEventOut,
    TicketOrderOut,
    TicketOrderUserOut,
)
from app.services.admin_service import audit
from app.services.pagination import (
    ADMIN_MAX_LIMIT,
    ADMIN_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)

# Stările din care o comandă mai poate primi o decizie de admin.
_DECIDABLE_STATUSES = (STATUS_AWAITING_PAYMENT, STATUS_PAYMENT_DECLARED)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Singleton PaymentSettings
# --------------------------------------------------------------------------- #
async def _get_or_create_settings(db: AsyncSession) -> PaymentSettings:
    """Rândul singleton `id=1`, creat leneș cu placeholder-uri goale dacă lipsește."""
    s = await db.get(PaymentSettings, PAYMENT_SETTINGS_ID)
    if s is not None:
        return s
    s = PaymentSettings(
        id=PAYMENT_SETTINGS_ID,
        bank_beneficiary="",
        bank_iban="",
        bank_name=None,
        instructions=None,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


def _to_settings_out(s: PaymentSettings) -> PaymentSettingsOut:
    return PaymentSettingsOut(
        bank_beneficiary=s.bank_beneficiary,
        bank_iban=s.bank_iban,
        bank_name=s.bank_name,
        instructions=s.instructions,
        updated_at=s.updated_at,
    )


async def get_payment_settings(db: AsyncSession) -> PaymentSettingsOut:
    return _to_settings_out(await _get_or_create_settings(db))


async def update_payment_settings(
    db: AsyncSession,
    data: PaymentSettingsIn,
    actor: User,
    ip: str | None = None,
) -> PaymentSettingsOut:
    s = await _get_or_create_settings(db)
    s.bank_beneficiary = data.bank_beneficiary
    s.bank_iban = data.bank_iban
    s.bank_name = data.bank_name
    s.instructions = data.instructions
    audit(
        db,
        actor,
        ACTION_PAYMENT_SETTINGS_UPDATE,
        target_type="payment_settings",
        meta={"bank_iban": s.bank_iban, "bank_beneficiary": s.bank_beneficiary},
        ip=ip,
    )
    await db.commit()
    await db.refresh(s)
    return _to_settings_out(s)


# --------------------------------------------------------------------------- #
# Mapări ORM → schemă
# --------------------------------------------------------------------------- #
def _comment_template(event: Event, reference: str) -> str:
    """Comentariul structurat recomandat pentru transfer, ex.
    „Bilet Petrecere Flirt 2026-08-01 Ref:U-1A2B3C4D"."""
    return f"Bilet {event.title} {event.starts_at:%Y-%m-%d} Ref:{reference}"


def _payment_instructions(
    order: TicketOrder, event: Event, settings: PaymentSettings
) -> PaymentInstructions:
    return PaymentInstructions(
        beneficiary=settings.bank_beneficiary,
        iban=settings.bank_iban,
        bank_name=settings.bank_name,
        amount=order.price,
        currency=order.currency,
        reference=order.reference,
        comment_template=_comment_template(event, order.reference),
        instructions=settings.instructions,
    )


def _to_order_out(order: TicketOrder, event: Event) -> TicketOrderOut:
    """Serializează o comandă. `ticket_code` e expus DOAR când e aprobată."""
    return TicketOrderOut(
        id=order.id,
        event_id=order.event_id,
        event_title=event.title,
        event_starts_at=event.starts_at,
        price=order.price,
        currency=order.currency,
        reference=order.reference,
        status=order.status,
        user_note=order.user_note,
        admin_note=order.admin_note,
        ticket_code=order.ticket_code if order.status == STATUS_APPROVED else None,
        created_at=order.created_at,
        decided_at=order.decided_at,
    )


# --------------------------------------------------------------------------- #
# Public (user)
# --------------------------------------------------------------------------- #
async def _get_event_or_404(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    return event


async def create_order(
    db: AsyncSession, user: User, event_id: uuid.UUID
) -> TicketOrderCreateOut:
    """Creează o comandă `awaiting_payment` + întoarce instrucțiunile de plată.

    400 dacă evenimentul nu are `ticket_price` setat (biletul online nu e disponibil).
    """
    event = await _get_event_or_404(db, event_id)
    if event.ticket_price is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Biletul online nu este disponibil pentru acest eveniment.",
        )

    reference = user_payment_ref(user)
    currency = event.ticket_currency or DEFAULT_CURRENCY
    order = TicketOrder(
        user_id=user.id,
        event_id=event.id,
        price=event.ticket_price,
        currency=currency,
        reference=reference,
        status=STATUS_AWAITING_PAYMENT,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)

    settings = await _get_or_create_settings(db)
    return TicketOrderCreateOut(
        order=_to_order_out(order, event),
        payment=_payment_instructions(order, event, settings),
    )


async def _get_own_order_or_404(
    db: AsyncSession, user: User, order_id: uuid.UUID
) -> TicketOrder:
    order = await db.get(TicketOrder, order_id)
    # 404 (nu 403) și când comanda e a altcuiva: nu confirmăm existența unei
    # comenzi străine unui user care nu are ce căuta la ea.
    if order is None or order.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket order not found"
        )
    return order


async def declare(
    db: AsyncSession, user: User, order_id: uuid.UUID, note: str | None
) -> TicketOrderOut:
    """Userul declară „am plătit": `awaiting_payment` → `payment_declared`.

    Doar proprietarul. Dacă comanda nu e în `awaiting_payment` (deja declarată,
    aprobată sau respinsă) → 409: nu re-declarăm o plată deja procesată.
    """
    order = await _get_own_order_or_404(db, user, order_id)
    if order.status != STATUS_AWAITING_PAYMENT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comanda nu mai poate fi declarată în starea curentă.",
        )
    order.status = STATUS_PAYMENT_DECLARED
    order.user_note = note
    await db.commit()
    await db.refresh(order)
    event = await _get_event_or_404(db, order.event_id)
    return _to_order_out(order, event)


async def list_mine(db: AsyncSession, user: User) -> list[TicketOrderOut]:
    """Comenzile userului, cele mai recente primele (cu evenimentul alăturat)."""
    rows = (
        await db.execute(
            select(TicketOrder, Event)
            .join(Event, Event.id == TicketOrder.event_id)
            .where(TicketOrder.user_id == user.id)
            .order_by(TicketOrder.created_at.desc(), TicketOrder.id.desc())
        )
    ).all()
    return [_to_order_out(row.TicketOrder, row.Event) for row in rows]


async def get_mine(
    db: AsyncSession, user: User, order_id: uuid.UUID
) -> TicketOrderCreateOut:
    """O comandă a userului + instrucțiunile de plată cât timp e neplătită.

    `payment` e prezent doar în `awaiting_payment` (userul are încă de făcut
    transferul); în verificare/aprobat/respins e `None` — nu mai are ce plăti.
    """
    order = await _get_own_order_or_404(db, user, order_id)
    event = await _get_event_or_404(db, order.event_id)
    payment: PaymentInstructions | None = None
    if order.status == STATUS_AWAITING_PAYMENT:
        settings = await _get_or_create_settings(db)
        payment = _payment_instructions(order, event, settings)
    return TicketOrderCreateOut(order=_to_order_out(order, event), payment=payment)


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
# Prioritatea de coadă: comenzile DECLARATE primele (adminul are de verificat un
# transfer real), apoi cele în așteptare, apoi cele deja decise. O expresie SQL,
# nu sortare în Python — ca să rămână cheie de paginare stabilă.
_STATUS_PRIORITY = case(
    (TicketOrder.status == STATUS_PAYMENT_DECLARED, 0),
    (TicketOrder.status == STATUS_AWAITING_PAYMENT, 1),
    (TicketOrder.status == STATUS_APPROVED, 2),
    else_=3,
)


def _to_admin_out(order: TicketOrder, user: User, event: Event) -> AdminTicketOrderOut:
    return AdminTicketOrderOut(
        id=order.id,
        user=TicketOrderUserOut(
            id=user.id, email=user.email, payment_ref=user_payment_ref(user)
        ),
        event=TicketOrderEventOut(
            id=event.id, title=event.title, starts_at=event.starts_at
        ),
        price=order.price,
        currency=order.currency,
        reference=order.reference,
        status=order.status,
        user_note=order.user_note,
        admin_note=order.admin_note,
        ticket_code=order.ticket_code,
        created_at=order.created_at,
        decided_at=order.decided_at,
    )


async def list_orders(
    db: AsyncSession, *, limit: int | None = None, cursor: str | None = None
) -> tuple[list[AdminTicketOrderOut], str | None]:
    """Coada de comenzi — DECLARATE primele, apoi cele mai recente.

    Cheia de sortare e TOTALĂ — `(status_priority, created_at, id)` — deci
    paginarea pe cursor nu poate nici duplica, nici sări rânduri. `status_priority`
    fiind o expresie, valoarea ei pentru rândul-ancoră se recalculează DB-side
    printr-un subquery scalar (aceeași tehnică ca `list_reports`).

    Userul și evenimentul se aduc prin JOIN o singură dată pe pagină (fără N+1).
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(TicketOrder, User, Event).join(
        User, User.id == TicketOrder.user_id
    ).join(Event, Event.id == TicketOrder.event_id)

    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_priority = (
            select(_STATUS_PRIORITY)
            .where(TicketOrder.id == anchor_id)
            .scalar_subquery()
        )
        anchor_at = (
            select(TicketOrder.created_at)
            .where(TicketOrder.id == anchor_id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                _STATUS_PRIORITY > anchor_priority,
                and_(
                    _STATUS_PRIORITY == anchor_priority,
                    or_(
                        TicketOrder.created_at < anchor_at,
                        and_(
                            TicketOrder.created_at == anchor_at,
                            TicketOrder.id < anchor_id,
                        ),
                    ),
                ),
            )
        )

    rows = (
        await db.execute(
            stmt.order_by(
                _STATUS_PRIORITY.asc(),
                TicketOrder.created_at.desc(),
                TicketOrder.id.desc(),
            ).limit(limit + 1)
        )
    ).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return [], None

    items = [_to_admin_out(row.TicketOrder, row.User, row.Event) for row in rows]
    next_cursor = encode_cursor(rows[-1].TicketOrder.id) if has_more else None
    return items, next_cursor


async def _get_order_or_404(db: AsyncSession, order_id: uuid.UUID) -> TicketOrder:
    order = await db.get(TicketOrder, order_id)
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ticket order not found"
        )
    return order


def _ensure_decidable(order: TicketOrder) -> None:
    """O comandă deja aprobată/respinsă e finală → 409 la orice nouă decizie."""
    if order.status not in _DECIDABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comanda a fost deja procesată.",
        )


async def approve(
    db: AsyncSession, actor: User, order_id: uuid.UUID, ip: str | None = None
) -> AdminTicketOrderOut:
    """Aprobă o comandă → generează un `ticket_code` UNIC + audit `ticket_order.approve`."""
    order = await _get_order_or_404(db, order_id)
    _ensure_decidable(order)

    order.status = STATUS_APPROVED
    order.ticket_code = uuid.uuid4().hex
    order.decided_at = _now()
    order.decided_by = actor.id

    audit(
        db,
        actor,
        ACTION_TICKET_ORDER_APPROVE,
        target_type="ticket_order",
        target_id=order.id,
        meta={"reference": order.reference, "event_id": order.event_id},
        ip=ip,
    )
    await db.commit()
    await db.refresh(order)

    user = await db.get(User, order.user_id)
    event = await _get_event_or_404(db, order.event_id)
    return _to_admin_out(order, user, event)


async def reject(
    db: AsyncSession,
    actor: User,
    order_id: uuid.UUID,
    reason: str | None,
    ip: str | None = None,
) -> AdminTicketOrderOut:
    """Respinge o comandă → `admin_note=reason` + audit `ticket_order.reject`."""
    order = await _get_order_or_404(db, order_id)
    _ensure_decidable(order)

    order.status = STATUS_REJECTED
    order.admin_note = reason
    order.decided_at = _now()
    order.decided_by = actor.id

    audit(
        db,
        actor,
        ACTION_TICKET_ORDER_REJECT,
        target_type="ticket_order",
        target_id=order.id,
        meta={"reference": order.reference, "reason": reason or ""},
        ip=ip,
    )
    await db.commit()
    await db.refresh(order)

    user = await db.get(User, order.user_id)
    event = await _get_event_or_404(db, order.event_id)
    return _to_admin_out(order, user, event)


async def count_pending(db: AsyncSession) -> int:
    """Numărul de comenzi cu plata DECLARATĂ (coada care așteaptă verificare)."""
    return (
        await db.scalar(
            select(func.count())
            .select_from(TicketOrder)
            .where(TicketOrder.status == STATUS_PAYMENT_DECLARED)
        )
    ) or 0
