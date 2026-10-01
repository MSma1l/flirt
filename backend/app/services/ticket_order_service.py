"""Logica de CUMPĂRARE BILET ONLINE prin transfer bancar cu verificare manuală.

Concentrat aici (nu în rute) după convenția proiectului: rutele rămân subțiri,
serviciul deține accesul la DB, commit-urile și regulile de tranziție de stare.

SINGLETON `PaymentSettings`
---------------------------
Datele bancare globale stau într-un singur rând, `id == 1`. `_get_or_create_settings`
îl citește și îl creează LENEȘ cu placeholder-uri goale dacă lipsește — exact ca
`ad_service` cu `AdSettings`.

TRANZIȚII DE STARE (impuse strict; un client nu poate „sări" pași)
  awaiting_payment → payment_declared   (userul: dovada plății sau `declare`)
  awaiting_payment | payment_declared | additional_information_required
      → approved / rejected   (adminul: `approve` / `reject`)
O comandă deja `approved`/`rejected` e finală pentru `approve`/`reject` (409).
Corecțiile manuale de admin trec prin `change_status`, cu tabelul explicit
`_ADMIN_TRANSITIONS` (409 cu mesaj clar pe o tranziție nepermisă).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from app.core.errors import CodedHTTPException, ErrorCode
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import (
    ACTION_PAYMENT_SETTINGS_UPDATE,
    ACTION_TICKET_ORDER_APPROVE,
    ACTION_TICKET_ORDER_REJECT,
    ACTION_TICKET_ORDER_STATUS,
)
from app.models.event import Event
from app.models.ticket_order import (
    DEFAULT_CURRENCY,
    PAYMENT_SETTINGS_ID,
    STATUS_APPROVED,
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_REJECTED,
    STATUS_PENDING_PAYMENT,
    STATUS_PROOF_SUBMITTED,
    STATUS_UNDER_REVIEW,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
    STATUS_CANCELLED,
    PaymentSettings,
    TicketOrder,
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
    TicketRequestCreateIn,
    TicketRequestCreateOut,
    TicketRequestOut,
    payment_methods_for,
)
from app.services import loyalty
from app.services.user_codes import ensure_payment_code
from app.services.admin_service import audit
from app.services.ticket_lifecycle import order_ticket_status
from app.services.push import send_to_user
from app.services.storage import get_storage
from app.services.pagination import (
    ADMIN_MAX_LIMIT,
    ADMIN_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)

# Stările din care o comandă mai poate primi o decizie de admin.
_DECIDABLE_STATUSES = (
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
)

# Stările în care userul își poate (re)încărca dovada plății pe o comandă DIRECTĂ.
_ORDER_PROOF_STATUSES = (
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
)

# Metodele de plată pe care userul le poate declara la încărcarea dovezii.
_PAYMENT_METHODS = ("mia", "iban")


def _proof_kind(url: str | None) -> str | None:
    """`pdf` | `image` | None — după extensia cheii (generată server-side)."""
    if not url:
        return None
    return "pdf" if url.lower().endswith(".pdf") else "image"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Mesajele sunt pentru oameni; contractul pentru clienți e `code` (vezi
# `app/core/errors.py`).
_SALES_CLOSED_DETAIL = (
    "Vânzarea online de bilete s-a închis pentru acest eveniment. "
    "Biletele se mai pot cumpăra doar la intrare."
)
_EVENT_STARTED_DETAIL = (
    "Evenimentul a început — dovada de plată nu mai poate fi trimisă online."
)


def _ensure_sales_open(event: Event) -> None:
    """409 `ticket_sales_closed` dacă a trecut ora de închidere a vânzării.

    Se aplică DOAR la crearea unei comenzi NOI. Regula pentru comenzile deja
    create (pot fi finalizate după închidere, dar doar până la start) e în
    `_ensure_event_not_started`. Aprobarea de admin nu e limitată deloc.
    """
    if _now() >= event.effective_ticket_sales_end:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_SALES_CLOSED_DETAIL,
            code=ErrorCode.TICKET_SALES_CLOSED,
        )


def _ensure_event_not_started(event: Event) -> None:
    """409 `event_started` pentru pașii userului pe o comandă EXISTENTĂ.

    Decizie: cine a comandat la timp își poate termina plata și după ce s-a închis
    vânzarea (altfel l-am pedepsi pentru o comandă legitimă), dar NU și după ce
    evenimentul a început — atunci verificarea se face la intrare.
    """
    if _now() >= _as_utc(event.starts_at):
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_EVENT_STARTED_DETAIL,
            code=ErrorCode.EVENT_STARTED,
        )


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
        mia_phone=s.mia_phone,
        mia_recipient_name=s.mia_recipient_name,
        mia_qr_url=s.mia_qr_url,
        mia_enabled=bool(s.mia_phone or s.mia_qr_url),
        payment_methods=payment_methods_for(s.mia_phone, s.bank_iban, s.mia_qr_url),
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
    if not data.mia_phone and not s.mia_qr_url and not data.has_iban:
        raise HTTPException(
            status_code=422,
            detail="Configurați cel puțin o metodă de plată: MIA (telefon sau cod QR) sau beneficiar + IBAN.",
        )
    s.bank_beneficiary = data.bank_beneficiary
    s.bank_iban = data.bank_iban
    s.bank_name = data.bank_name
    s.instructions = data.instructions
    s.mia_phone = data.mia_phone
    s.mia_recipient_name = data.mia_recipient_name
    audit(
        db,
        actor,
        ACTION_PAYMENT_SETTINGS_UPDATE,
        target_type="payment_settings",
        meta={
            "bank_iban": s.bank_iban,
            "bank_beneficiary": s.bank_beneficiary,
            "mia_phone": s.mia_phone or "",
        },
        ip=ip,
    )
    await db.commit()
    await db.refresh(s)
    return _to_settings_out(s)


async def set_mia_qr(
    db: AsyncSession, url: str, actor: User, ip: str | None = None
) -> PaymentSettingsOut:
    """Salvează URL-ul noului QR MIA (deja curățat și stocat) + audit; vechiul
    fișier se șterge best-effort după commit."""
    s = await _get_or_create_settings(db)
    old = s.mia_qr_url
    s.mia_qr_url = url
    audit(
        db, actor, ACTION_PAYMENT_SETTINGS_UPDATE, target_type="payment_settings",
        meta={"mia_qr": "upload"}, ip=ip,
    )
    await db.commit()
    await db.refresh(s)
    if old and old != url:
        await _delete_file_quietly(old)
    return _to_settings_out(s)


async def remove_mia_qr(
    db: AsyncSession, actor: User, ip: str | None = None
) -> PaymentSettingsOut:
    """Scoate QR-ul MIA. 409 dacă ar rămâne fără nicio metodă de plată."""
    s = await _get_or_create_settings(db)
    if s.mia_qr_url is None:
        return _to_settings_out(s)
    if not s.mia_phone and not (s.bank_beneficiary and s.bank_iban):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Codul QR e singura metodă de plată — adăugați întâi telefonul MIA sau IBAN-ul.",
        )
    old = s.mia_qr_url
    s.mia_qr_url = None
    audit(
        db, actor, ACTION_PAYMENT_SETTINGS_UPDATE, target_type="payment_settings",
        meta={"mia_qr": "remove"}, ip=ip,
    )
    await db.commit()
    await db.refresh(s)
    await _delete_file_quietly(old)
    return _to_settings_out(s)


async def _delete_file_quietly(url: str) -> None:
    """Ștergerea unui fișier vechi nu are voie să strice operația reușită."""
    try:
        await get_storage().delete(url)
    except Exception:  # noqa: BLE001 — best-effort, fișierul orfan e inofensiv
        pass


# --------------------------------------------------------------------------- #
# Mapări ORM → schemă
# --------------------------------------------------------------------------- #
def _comment_template(event: Event, reference: str) -> str:
    """Comentariul transferului = DOAR codul de plată (ex. „482719").

    Simplu de tastat în aplicația băncii și de găsit în extras; evenimentul nu mai
    intră în comentariu (adminul îl vede pe comandă). `event` rămâne în semnătură
    pentru apelanți."""
    return reference


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
        mia_phone=settings.mia_phone,
        mia_recipient_name=settings.mia_recipient_name,
        mia_qr_url=settings.mia_qr_url,
        payment_methods=payment_methods_for(
            settings.mia_phone, settings.bank_iban, settings.mia_qr_url
        ),
    )


def _request_payment_instructions(
    order: TicketOrder, event: Event, settings: PaymentSettings
) -> PaymentInstructions:
    """Ca `_payment_instructions`, dar pentru o CERERE: suma = totalul cererii
    (preț × cantitate), iar comentariul = descrierea plății salvată pe cerere."""
    payment = _payment_instructions(order, event, settings)
    if order.total_amount:
        payment.amount = order.total_amount
    if order.payment_description:
        payment.comment_template = order.payment_description
    return payment


# Stările în care o cerere mai așteaptă plata/dovada → userul vede datele de plată.
_REQUEST_AWAITING_PAYMENT_STATUSES = (
    STATUS_PENDING_PAYMENT,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
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
        ticket_status=order_ticket_status(order, event),
        admitted_at=order.admitted_at,
        payment_proof_uploaded=bool(order.payment_proof_url),
        payment_method=order.payment_method,
        payment_declared_at=order.payment_declared_at,
    )


def _to_request_out(order: TicketOrder, event: Event) -> TicketRequestOut:
    """Forma publică a unei cereri; URL-ul intern al dovezii nu iese niciodată."""
    return TicketRequestOut(
        id=order.id, event_id=event.id, event_title=event.title,
        event_starts_at=event.starts_at, event_venue=event.venue,
        full_name=order.full_name, phone=order.phone, email=order.email,
        ticket_quantity=order.ticket_quantity, ticket_price=order.price,
        total_amount=order.total_amount, currency=order.currency,
        payment_description=order.payment_description,
        payment_proof_uploaded=bool(order.payment_proof_url), status=order.status,
        client_message=order.client_message, admin_comment=order.admin_note,
        created_at=order.created_at, reviewed_at=order.decided_at,
        ticket_code=order.ticket_code if order.status == STATUS_APPROVED else None,
        ticket_status=order_ticket_status(order, event), admitted_at=order.admitted_at,
    )


async def create_request(
    db: AsyncSession, user: User, event_id: uuid.UUID, data: TicketRequestCreateIn
) -> TicketRequestCreateOut:
    """Creează cererea manuală cu preț server-side și rezervare doar la aprobare."""
    event = await _get_event_or_404(db, event_id)
    if event.ticket_price is None:
        raise HTTPException(status_code=400, detail="Biletele nu sunt disponibile pentru acest eveniment.")
    if _as_utc(event.starts_at) < _now():
        # 400 + text păstrate (clienți existenți); `code` e adăugat pentru cei noi.
        raise CodedHTTPException(status_code=400, detail="Biletele nu sunt disponibile pentru acest eveniment.", code=ErrorCode.TICKET_SALES_CLOSED)
    if event.ticket_capacity is not None and event.tickets_sold + data.ticket_quantity > event.ticket_capacity:
        raise HTTPException(status_code=409, detail="Nu mai sunt suficiente bilete disponibile.")
    existing = (await db.execute(select(TicketOrder).where(
        TicketOrder.user_id == user.id, TicketOrder.event_id == event.id,
        TicketOrder.status.in_((STATUS_PENDING_PAYMENT, STATUS_PROOF_SUBMITTED, STATUS_UNDER_REVIEW, STATUS_ADDITIONAL_INFORMATION_REQUIRED)),
    ).order_by(TicketOrder.created_at.desc()))).scalars().first()
    if existing:
        settings = await _get_or_create_settings(db)
        return TicketRequestCreateOut(request=_to_request_out(existing, event), payment=_request_payment_instructions(existing, event, settings))
    # Cererea existentă (făcută la timp) se întoarce și după închidere; doar una
    # NOUĂ e refuzată.
    _ensure_sales_open(event)
    price = event.ticket_price
    total = round(price * data.ticket_quantity, 2)
    reference = await ensure_payment_code(db, user)
    # Comentariul transferului = DOAR codul de plată (vezi `_comment_template`).
    description = reference
    order = TicketOrder(user_id=user.id, event_id=event.id, price=price,
        total_amount=total, ticket_quantity=data.ticket_quantity, currency=event.ticket_currency or DEFAULT_CURRENCY,
        reference=reference, status=STATUS_PENDING_PAYMENT, full_name=data.full_name,
        phone=data.phone, email=data.email or user.email, client_message=data.client_message,
        payment_description=description)
    db.add(order)
    await db.commit(); await db.refresh(order)
    settings = await _get_or_create_settings(db)
    payment = _request_payment_instructions(order, event, settings)
    return TicketRequestCreateOut(request=_to_request_out(order, event), payment=payment)


async def list_my_requests(db: AsyncSession, user: User) -> list[TicketRequestOut]:
    rows = (await db.execute(select(TicketOrder, Event).join(Event, Event.id == TicketOrder.event_id).where(
        TicketOrder.user_id == user.id, TicketOrder.full_name.is_not(None)
    ).order_by(TicketOrder.created_at.desc()))).all()
    return [_to_request_out(row.TicketOrder, row.Event) for row in rows]


async def get_my_request(db: AsyncSession, user: User, order_id: uuid.UUID) -> TicketRequestOut:
    order = await _get_own_order_or_404(db, user, order_id)
    if order.full_name is None:
        raise HTTPException(status_code=404, detail="Ticket request not found")
    event = await _get_event_or_404(db, order.event_id)
    out = _to_request_out(order, event)
    # Aditiv: cât timp cererea așteaptă plata, userul își poate revedea datele.
    if order.status in _REQUEST_AWAITING_PAYMENT_STATUSES:
        settings = await _get_or_create_settings(db)
        out.payment = _request_payment_instructions(order, event, settings)
    return out


async def submit_payment_proof(db: AsyncSession, user: User, order_id: uuid.UUID, proof_url: str) -> TicketRequestOut:
    order = await _get_own_order_or_404(db, user, order_id)
    if order.full_name is None or order.status in (STATUS_APPROVED, STATUS_CANCELLED):
        raise HTTPException(status_code=409, detail="Cererea nu mai acceptă o dovadă nouă.")
    _ensure_event_not_started(await _get_event_or_404(db, order.event_id))
    order.payment_proof_url = proof_url
    order.status = STATUS_PROOF_SUBMITTED
    order.payment_declared_at = _now()
    await db.commit(); await db.refresh(order)
    # Notification is intentionally best-effort; it never changes the payment state.
    admins = (await db.execute(select(User.id).where(User.role == "admin"))).scalars().all()
    for admin_id in admins:
        await send_to_user(db, admin_id, "Dovadă de plată nouă", f"Cererea {order.id} așteaptă verificarea.")
    return _to_request_out(order, await _get_event_or_404(db, order.event_id))


async def review_request(db: AsyncSession, actor: User, order_id: uuid.UUID, new_status: str, comment: str | None, ip: str | None = None) -> TicketRequestOut:
    order = await _get_order_or_404(db, order_id)
    if order.full_name is None:
        raise HTTPException(status_code=404, detail="Ticket request not found")
    previous = order.status
    if previous in (STATUS_APPROVED, STATUS_CANCELLED):
        raise HTTPException(status_code=409, detail="Cererea a fost închisă definitiv.")
    if new_status == STATUS_APPROVED:
        if not order.payment_proof_url:
            raise HTTPException(status_code=409, detail="Nu se poate confirma plata fără dovadă.")
        # Lock the event row: concurrent approvals cannot oversell capacity.
        event = (await db.execute(select(Event).where(Event.id == order.event_id).with_for_update())).scalars().one()
        if event.ticket_capacity is not None and event.tickets_sold + order.ticket_quantity > event.ticket_capacity:
            raise HTTPException(status_code=409, detail="Capacitatea evenimentului a fost epuizată.")
        event.tickets_sold += order.ticket_quantity
        order.ticket_code = order.ticket_code or uuid.uuid4().hex
    else:
        event = await _get_event_or_404(db, order.event_id)
    order.status = new_status; order.admin_note = comment; order.decided_by = actor.id; order.decided_at = _now()
    audit(db, actor, ACTION_TICKET_ORDER_APPROVE if new_status == STATUS_APPROVED else ACTION_TICKET_ORDER_REJECT,
          target_type="ticket_request", target_id=order.id,
          meta={"previous_status": previous, "new_status": new_status, "comment": comment or ""}, ip=ip)
    await db.commit(); await db.refresh(order)
    bodies = {STATUS_APPROVED: "Plata a fost confirmată. Cererea ta pentru bilet a fost acceptată.", STATUS_REJECTED: comment or "Cererea a fost refuzată.", STATUS_ADDITIONAL_INFORMATION_REQUIRED: comment or "Sunt necesare informații suplimentare."}
    await send_to_user(db, order.user_id, "Actualizare cerere bilet", bodies.get(new_status, comment or "Cererea ta este în verificare."))
    return _to_request_out(order, event)


async def list_requests(db: AsyncSession, *, status_filter: str | None = None, event_id: uuid.UUID | None = None, created_from: datetime | None = None, created_to: datetime | None = None) -> list[TicketRequestOut]:
    stmt = select(TicketOrder, Event).join(Event, Event.id == TicketOrder.event_id).where(TicketOrder.full_name.is_not(None))
    if status_filter: stmt = stmt.where(TicketOrder.status == status_filter)
    if event_id: stmt = stmt.where(TicketOrder.event_id == event_id)
    if created_from: stmt = stmt.where(TicketOrder.created_at >= created_from)
    if created_to: stmt = stmt.where(TicketOrder.created_at <= created_to)
    rows = (await db.execute(stmt.order_by(TicketOrder.created_at.desc()))).all()
    return [_to_request_out(row.TicketOrder, row.Event) for row in rows]


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


def _as_utc(value: datetime) -> datetime:
    """Normalizează un datetime la UTC (naive → atașează UTC), pentru comparații sigure.

    Coloana `Event.starts_at` e `DateTime(timezone=True)` (Postgres întoarce
    tz-aware), dar un motor fără timezone (SQLite) ar întoarce naive — atunci
    `naive < aware` ar arunca `TypeError`. Atașăm UTC ca să comparăm mereu apples-to-apples.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def create_order(
    db: AsyncSession, user: User, event_id: uuid.UUID
) -> TicketOrderCreateOut:
    """Creează o comandă `awaiting_payment` + întoarce instrucțiunile de plată.

    IDEMPOTENT (anti-spam): dacă userul are deja o comandă ACTIVĂ pentru același
    eveniment (`awaiting_payment` sau `payment_declared`), o întoarce pe aceea în
    loc să creeze una nouă — exact ca `account_service.get_or_issue_ticket`. O
    comandă `rejected` anterioară NU blochează crearea uneia noi (userul are voie
    să reîncerce după un refuz).

    400 dacă evenimentul nu are `ticket_price` setat (biletul online nu e
    disponibil) sau dacă evenimentul e deja TRECUT (`starts_at < now`).
    """
    event = await _get_event_or_404(db, event_id)
    if event.ticket_price is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Biletul online nu este disponibil pentru acest eveniment.",
        )
    if _as_utc(event.starts_at) < _now():
        # 400 + text păstrate pentru clienții existenți; `code` e nou.
        raise CodedHTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Evenimentul a trecut deja — nu mai poți comanda bilet.",
            code=ErrorCode.TICKET_SALES_CLOSED,
        )

    # Idempotență: reutilizăm o comandă activă (neterminată) a aceluiași user pt
    # același eveniment. Cea mai recentă câștigă (deși, în practică, tot fixul
    # garantează că e cel mult una).
    existing = (
        await db.execute(
            select(TicketOrder)
            .where(
                TicketOrder.user_id == user.id,
                TicketOrder.event_id == event.id,
                TicketOrder.status.in_(_DECIDABLE_STATUSES),
            )
            .order_by(TicketOrder.created_at.desc(), TicketOrder.id.desc())
        )
    ).scalars().first()
    if existing is not None:
        # Instrucțiunile de plată doar cât timp mai e ceva de plătit (awaiting) —
        # aceeași semantică precum `get_mine`; o comandă deja declarată nu le mai are.
        payment: PaymentInstructions | None = None
        if existing.status == STATUS_AWAITING_PAYMENT:
            settings = await _get_or_create_settings(db)
            payment = _payment_instructions(existing, event, settings)
        return TicketOrderCreateOut(
            order=_to_order_out(existing, event), payment=payment
        )

    # Doar o comandă NOUĂ e refuzată după închiderea vânzării; cea existentă
    # (făcută la timp) s-a întors mai sus, ca userul să-și poată termina plata.
    _ensure_sales_open(event)

    reference = await ensure_payment_code(db, user)
    currency = event.ticket_currency or DEFAULT_CURRENCY
    # Prețul SNAPSHOT-uit e cel FINAL, după reducerea la care userul are dreptul:
    # treapta lui de fidelitate, promo-ul evenimentului sau o invitație folosită —
    # cea mai mare dintre ele, plafonată, niciodată sub zero. Regula completă și
    # motivarea ei stau în `services/loyalty.py`; aici e singurul punct în care
    # intră în fluxul de comandă, ca prețul cotat userului (`GET
    # /loyalty/events/{id}/ticket-quote`) și cel înscris pe comandă să iasă din
    # ACEEAȘI funcție. Clientul nu trimite nici preț, nici procent.
    breakdown = await loyalty.price_breakdown(db, user, event)
    order = TicketOrder(
        user_id=user.id,
        event_id=event.id,
        price=breakdown.final_price,
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
    event = await _get_event_or_404(db, order.event_id)
    _ensure_event_not_started(event)
    order.status = STATUS_PAYMENT_DECLARED
    order.user_note = note
    order.payment_declared_at = _now()
    await db.commit()
    await db.refresh(order)
    return _to_order_out(order, event)


async def ensure_can_upload_order_proof(
    db: AsyncSession, user: User, order_id: uuid.UUID
) -> TicketOrder:
    """Autorizarea ÎNAINTE de a primi bytes: proprietar (404 altfel), stare care
    mai acceptă o dovadă (409) și eveniment neînceput (409 `event_started`)."""
    order = await _get_own_order_or_404(db, user, order_id)
    if order.full_name is not None:
        # Cerere manuală: regulile ei (vezi `submit_payment_proof`).
        if order.status in (STATUS_APPROVED, STATUS_CANCELLED):
            raise HTTPException(status_code=409, detail="Cererea nu mai acceptă o dovadă nouă.")
    elif order.status not in _ORDER_PROOF_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comanda nu mai acceptă o dovadă de plată în starea curentă.",
        )
    _ensure_event_not_started(await _get_event_or_404(db, order.event_id))
    return order


async def submit_order_proof(
    db: AsyncSession,
    user: User,
    order_id: uuid.UUID,
    proof_url: str,
    method: str | None = None,
) -> TicketOrderOut:
    """Dovada plății (chitanța MIA / bancară) pe o comandă → `payment_declared`.

    Pe o comandă DIRECTĂ: `awaiting_payment` | `payment_declared` |
    `additional_information_required` → `payment_declared` (în verificare); o
    dovadă nouă o înlocuiește pe cea veche. Pe o cerere manuală se aplică fluxul
    ei (`payment_proof_submitted`). Adminii primesc o notificare best-effort.
    """
    order = await ensure_can_upload_order_proof(db, user, order_id)
    if order.full_name is not None:
        await submit_payment_proof(db, user, order_id, proof_url)
        if method in _PAYMENT_METHODS:
            order.payment_method = method
            await db.commit()
            await db.refresh(order)
        return _to_order_out(order, await _get_event_or_404(db, order.event_id))
    order.payment_proof_url = proof_url
    order.status = STATUS_PAYMENT_DECLARED
    order.payment_declared_at = _now()
    if method in _PAYMENT_METHODS:
        order.payment_method = method
    await db.commit()
    await db.refresh(order)
    admins = (await db.execute(select(User.id).where(User.role == "admin"))).scalars().all()
    for admin_id in admins:
        await send_to_user(
            db, admin_id, "Dovadă de plată nouă", f"Comanda {order.reference} așteaptă verificarea."
        )
    return _to_order_out(order, await _get_event_or_404(db, order.event_id))


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
    transferul) — sau, pentru o cerere manuală, în `pending_payment` /
    `additional_information_required`; altfel e `None` — nu mai are ce plăti.
    """
    order = await _get_own_order_or_404(db, user, order_id)
    event = await _get_event_or_404(db, order.event_id)
    payment: PaymentInstructions | None = None
    if order.status == STATUS_AWAITING_PAYMENT:
        settings = await _get_or_create_settings(db)
        payment = _payment_instructions(order, event, settings)
    elif order.full_name is not None and order.status in _REQUEST_AWAITING_PAYMENT_STATUSES:
        # Aditiv: și o CERERE (aceeași tabelă) care așteaptă plata își primește
        # datele de plată (totalul cererii), ca ecranul de bilete să le poată arăta.
        settings = await _get_or_create_settings(db)
        payment = _request_payment_instructions(order, event, settings)
    return TicketOrderCreateOut(order=_to_order_out(order, event), payment=payment)


# --------------------------------------------------------------------------- #
# Admin
# --------------------------------------------------------------------------- #
# Prioritatea de coadă: comenzile DECLARATE primele (adminul are de verificat un
# transfer real), apoi cele în așteptare, apoi cele deja decise. O expresie SQL,
# nu sortare în Python — ca să rămână cheie de paginare stabilă.
_STATUS_PRIORITY = case(
    # „De verificat": dovadă încărcată / plată declarată / luată în verificare.
    (TicketOrder.status.in_((STATUS_PAYMENT_DECLARED, STATUS_PROOF_SUBMITTED, STATUS_UNDER_REVIEW)), 0),
    (TicketOrder.status.in_((STATUS_AWAITING_PAYMENT, STATUS_PENDING_PAYMENT, STATUS_ADDITIONAL_INFORMATION_REQUIRED)), 1),
    (TicketOrder.status == STATUS_APPROVED, 2),
    else_=3,
)


def _to_admin_out(order: TicketOrder, user: User, event: Event) -> AdminTicketOrderOut:
    return AdminTicketOrderOut(
        id=order.id,
        user=TicketOrderUserOut(
            # Codul de plată al userului; un user fără cod generat încă (doar
            # comenzi vechi) → referința istorică a comenzii (`U-XXXXXXXX`).
            id=user.id, email=user.email, payment_ref=user.payment_code or order.reference
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
        ticket_status=order_ticket_status(order, event),
        admitted_at=order.admitted_at,
        payment_proof_uploaded=bool(order.payment_proof_url),
        payment_proof_kind=_proof_kind(order.payment_proof_url),
        payment_method=order.payment_method,
        payment_declared_at=order.payment_declared_at,
        is_request=order.full_name is not None,
        ticket_quantity=order.ticket_quantity or 1,
        total_amount=order.total_amount or None,
        allowed_statuses=list(allowed_admin_transitions(order)),
    )


async def list_orders(
    db: AsyncSession,
    *,
    limit: int | None = None,
    cursor: str | None = None,
    statuses: list[str] | None = None,
    q: str | None = None,
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
    if statuses:
        # Filtru aditiv (`?status=a,b`); cursorul rămâne valid în interiorul filtrului.
        stmt = stmt.where(TicketOrder.status.in_(statuses))
    if q and q.strip():
        # Căutare după referința EXACTĂ (codul de plată din extrasul bancar).
        stmt = stmt.where(TicketOrder.reference == q.strip())

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


async def get_admin_order(db: AsyncSession, order_id: uuid.UUID) -> AdminTicketOrderOut:
    """Detaliul unei comenzi pentru admin (orice tip: directă sau cerere)."""
    order = await _get_order_or_404(db, order_id)
    user = await db.get(User, order.user_id)
    event = await _get_event_or_404(db, order.event_id)
    return _to_admin_out(order, user, event)


# Tranzițiile MANUALE permise adminului pe o comandă DIRECTĂ. Orice altceva → 409.
#  - `approved` → `cancelled`: anularea unui bilet emis (nu și dacă a fost scanat);
#  - `rejected` → redeschidere (greșeală de verificare);
#  - `cancelled` e final.
_ADMIN_TRANSITIONS: dict[str, tuple[str, ...]] = {
    STATUS_AWAITING_PAYMENT: (
        STATUS_PAYMENT_DECLARED, STATUS_ADDITIONAL_INFORMATION_REQUIRED,
        STATUS_APPROVED, STATUS_REJECTED, STATUS_CANCELLED,
    ),
    STATUS_PAYMENT_DECLARED: (
        STATUS_AWAITING_PAYMENT, STATUS_ADDITIONAL_INFORMATION_REQUIRED,
        STATUS_APPROVED, STATUS_REJECTED, STATUS_CANCELLED,
    ),
    STATUS_ADDITIONAL_INFORMATION_REQUIRED: (
        STATUS_AWAITING_PAYMENT, STATUS_PAYMENT_DECLARED,
        STATUS_APPROVED, STATUS_REJECTED, STATUS_CANCELLED,
    ),
    STATUS_REJECTED: (STATUS_AWAITING_PAYMENT, STATUS_PAYMENT_DECLARED),
    STATUS_APPROVED: (STATUS_CANCELLED,),
    STATUS_CANCELLED: (),
}

# Mesajele push către user la o schimbare de stare (best-effort).
_STATUS_PUSH = {
    STATUS_APPROVED: "Plata a fost confirmată. Biletul tău e gata.",
    STATUS_REJECTED: "Plata nu a fost confirmată.",
    STATUS_ADDITIONAL_INFORMATION_REQUIRED: "Avem nevoie de informații suplimentare despre plată.",
    STATUS_CANCELLED: "Comanda ta de bilet a fost anulată.",
}


# Stările pe care adminul le poate pune pe o CERERE manuală (ca `TicketRequestReviewIn`).
_REQUEST_REVIEW_STATUSES = (
    STATUS_APPROVED, STATUS_REJECTED, STATUS_UNDER_REVIEW,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED, STATUS_CANCELLED,
)


def allowed_admin_transitions(order: TicketOrder) -> tuple[str, ...]:
    """Stările în care adminul poate muta MANUAL comanda (directă sau cerere)."""
    if order.full_name is not None:
        if order.status in (STATUS_APPROVED, STATUS_CANCELLED):
            return ()
        return tuple(st for st in _REQUEST_REVIEW_STATUSES if st != order.status)
    targets = _ADMIN_TRANSITIONS.get(order.status, ())
    if order.status == STATUS_APPROVED and order.admitted_at is not None:
        return ()  # biletul a fost deja folosit la intrare
    return targets


async def change_status(
    db: AsyncSession,
    actor: User,
    order_id: uuid.UUID,
    new_status: str,
    note: str | None,
    ip: str | None = None,
) -> AdminTicketOrderOut:
    """Schimbare manuală de stare (corecții), cu tranziții validate + audit.

    O CERERE manuală trece prin `review_request` (regulile ei). Pe o comandă
    directă: tabelul `_ADMIN_TRANSITIONS`; aceeași stare sau o tranziție
    nepermisă → 409 cu mesaj clar. `approved` emite biletul (`ticket_code`),
    `rejected`/`additional_information_required` pun `note` ca mesaj pentru user.
    Fiecare schimbare intră în jurnalul de audit (admin, stare veche/nouă, notă).
    """
    order = await _get_order_or_404(db, order_id)
    if order.full_name is not None:
        if new_status not in _REQUEST_REVIEW_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Tranziție nepermisă pentru o cerere: {order.status} → {new_status}.",
            )
        await review_request(db, actor, order_id, new_status, note, ip)
        return await get_admin_order(db, order_id)

    previous = order.status
    if new_status == previous:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Comanda este deja în această stare.",
        )
    if new_status not in allowed_admin_transitions(order):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Tranziție nepermisă: {previous} → {new_status}.",
        )

    if new_status == STATUS_APPROVED:
        order.ticket_code = order.ticket_code or uuid.uuid4().hex
        action = ACTION_TICKET_ORDER_APPROVE
    elif new_status == STATUS_REJECTED:
        action = ACTION_TICKET_ORDER_REJECT
    else:
        action = ACTION_TICKET_ORDER_STATUS
    if new_status == STATUS_PAYMENT_DECLARED and order.payment_declared_at is None:
        order.payment_declared_at = _now()
    if note is not None:
        order.admin_note = note
    order.status = new_status
    order.decided_at = _now()
    order.decided_by = actor.id

    audit(
        db,
        actor,
        action,
        target_type="ticket_order",
        target_id=order.id,
        meta={
            "reference": order.reference,
            "previous_status": previous,
            "new_status": new_status,
            "note": note or "",
        },
        ip=ip,
    )
    await db.commit()
    await db.refresh(order)

    body = _STATUS_PUSH.get(new_status)
    if body:
        await send_to_user(db, order.user_id, "Actualizare comandă bilet", note or body)
    return await get_admin_order(db, order_id)


async def count_pending(db: AsyncSession) -> int:
    """Numărul de comenzi cu plata DECLARATĂ (coada care așteaptă verificare)."""
    return (
        await db.scalar(
            select(func.count())
            .select_from(TicketOrder)
            .where(TicketOrder.status == STATUS_PAYMENT_DECLARED)
        )
    ) or 0
