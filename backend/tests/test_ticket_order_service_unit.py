"""Unit teste DIRECTE pentru `ticket_order_service` — apelează serviciul, nu API-ul.

Țintesc mașina de stări (create → declare → approve/reject), izolarea owner/admin,
409 la dublu-approve / re-declare, singleton-ul `PaymentSettings`, coada de admin
(declared-first + paginare pe cursor) și `count_pending`. Apel direct = liniile
serviciului se înregistrează ca acoperite (vezi nota din `test_ad_service_unit.py`).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.security import hash_password
from app.models.admin import (
    ACTION_PAYMENT_SETTINGS_UPDATE,
    ACTION_TICKET_ORDER_APPROVE,
    ACTION_TICKET_ORDER_REJECT,
    AdminAuditLog,
)
from app.models.event import Event
from app.models.ticket_order import (
    STATUS_APPROVED,
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_REJECTED,
    user_payment_ref,
)
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import PaymentSettingsIn
from app.services import ticket_order_service as T

pytestmark = pytest.mark.asyncio


async def _make_user(db, email, *, admin=False) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    if admin:
        user.role = ROLE_ADMIN
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_event(db, *, price=150.0, currency="lei", title="Petrecere Flirt") -> Event:
    event = Event(
        title=title,
        starts_at=datetime.now(timezone.utc) + timedelta(days=7),
        city="Chișinău",
        kind="party",
        ticket_price=price,
        ticket_currency=currency if price is not None else None,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _count_audit(db, action) -> int:
    return await db.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == action
        )
    )


# --------------------------------------------------------------------------- #
# PaymentSettings singleton
# --------------------------------------------------------------------------- #
async def test_get_payment_settings_creates_empty_singleton(db_session):
    out = await T.get_payment_settings(db_session)
    assert out.bank_beneficiary == ""
    assert out.bank_iban == ""
    assert out.bank_name is None
    assert out.instructions is None


async def test_update_payment_settings_writes_audit(db_session):
    admin = await _make_user(db_session, "pay_admin@example.com", admin=True)
    out = await T.update_payment_settings(
        db_session,
        PaymentSettingsIn(
            bank_beneficiary="SRL Flirt",
            bank_iban="MD00AG0000000000",
            bank_name="Banca",
            instructions="Transfer în 24h.",
        ),
        actor=admin,
        ip="1.1.1.1",
    )
    assert out.bank_beneficiary == "SRL Flirt"
    assert out.bank_iban == "MD00AG0000000000"
    assert await _count_audit(db_session, ACTION_PAYMENT_SETTINGS_UPDATE) == 1


# --------------------------------------------------------------------------- #
# Creare comandă
# --------------------------------------------------------------------------- #
async def test_create_order_returns_instructions(db_session):
    user = await _make_user(db_session, "to_create@example.com")
    event = await _make_event(db_session, price=200.0)
    out = await T.create_order(db_session, user, event.id)
    assert out.order.status == STATUS_AWAITING_PAYMENT
    assert out.order.price == 200.0
    assert out.order.reference == user_payment_ref(user)
    assert out.order.ticket_code is None
    # Instrucțiuni prezente la creare.
    assert out.payment is not None
    assert out.payment.reference == user_payment_ref(user)
    assert out.payment.amount == 200.0
    assert user_payment_ref(user) in out.payment.comment_template


async def test_create_order_event_404(db_session):
    user = await _make_user(db_session, "to_create404@example.com")
    with pytest.raises(HTTPException) as exc:
        await T.create_order(db_session, user, uuid.uuid4())
    assert exc.value.status_code == 404


async def test_create_order_without_price_400(db_session):
    user = await _make_user(db_session, "to_noprice@example.com")
    event = await _make_event(db_session, price=None)
    with pytest.raises(HTTPException) as exc:
        await T.create_order(db_session, user, event.id)
    assert exc.value.status_code == 400


async def test_create_order_uses_default_currency_when_event_has_none(db_session):
    user = await _make_user(db_session, "to_defcur@example.com")
    # Preț setat dar monedă None → serviciul cade pe DEFAULT_CURRENCY.
    event = Event(
        title="No currency",
        starts_at=datetime.now(timezone.utc) + timedelta(days=3),
        city="Chișinău",
        kind="party",
        ticket_price=99.0,
        ticket_currency=None,
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)
    out = await T.create_order(db_session, user, event.id)
    assert out.order.currency == "lei"


# --------------------------------------------------------------------------- #
# Idempotență (anti-spam) + eveniment trecut
# --------------------------------------------------------------------------- #
async def test_create_order_is_idempotent_while_awaiting(db_session):
    user = await _make_user(db_session, "to_idem_await@example.com")
    event = await _make_event(db_session, price=120.0)

    first = await T.create_order(db_session, user, event.id)
    second = await T.create_order(db_session, user, event.id)

    # Aceeași comandă întoarsă, nu una nouă.
    assert second.order.id == first.order.id
    assert second.payment is not None  # awaiting → instrucțiuni prezente
    # O singură comandă în DB pentru user+event.
    from app.models.ticket_order import TicketOrder

    n = await db_session.scalar(
        select(func.count())
        .select_from(TicketOrder)
        .where(TicketOrder.user_id == user.id, TicketOrder.event_id == event.id)
    )
    assert n == 1


async def test_create_order_is_idempotent_after_declare(db_session):
    user = await _make_user(db_session, "to_idem_declared@example.com")
    event = await _make_event(db_session)
    first = await T.create_order(db_session, user, event.id)
    await T.declare(db_session, user, first.order.id, note="Am plătit.")

    # O comandă DECLARATĂ blochează crearea alteia noi → o întoarce pe aceea.
    again = await T.create_order(db_session, user, event.id)
    assert again.order.id == first.order.id
    assert again.order.status == STATUS_PAYMENT_DECLARED
    # Nimic de plătit → fără instrucțiuni (aceeași semantică precum `get_mine`).
    assert again.payment is None


async def test_rejected_order_does_not_block_new_one(db_session):
    user = await _make_user(db_session, "to_idem_rejected@example.com")
    admin = await _make_user(db_session, "to_idem_rej_admin@example.com", admin=True)
    event = await _make_event(db_session)
    first = await T.create_order(db_session, user, event.id)
    await T.reject(db_session, admin, first.order.id, reason="Fără transfer.")

    # După un REFUZ, userul are voie să reîncerce → comandă NOUĂ.
    retry = await T.create_order(db_session, user, event.id)
    assert retry.order.id != first.order.id
    assert retry.order.status == STATUS_AWAITING_PAYMENT
    assert retry.payment is not None


async def test_create_order_past_event_400(db_session):
    user = await _make_user(db_session, "to_past@example.com")
    # Eveniment deja trecut (starts_at în trecut) — biletul nu mai are sens.
    event = Event(
        title="Petrecere trecută",
        starts_at=datetime.now(timezone.utc) - timedelta(days=1),
        city="Chișinău",
        kind="party",
        ticket_price=100.0,
        ticket_currency="lei",
    )
    db_session.add(event)
    await db_session.commit()
    await db_session.refresh(event)

    with pytest.raises(HTTPException) as exc:
        await T.create_order(db_session, user, event.id)
    assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Declare (mașina de stări userului)
# --------------------------------------------------------------------------- #
async def test_declare_moves_to_payment_declared(db_session):
    user = await _make_user(db_session, "to_declare@example.com")
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    out = await T.declare(db_session, user, created.order.id, note="Am plătit azi.")
    assert out.status == STATUS_PAYMENT_DECLARED
    assert out.user_note == "Am plătit azi."


async def test_declare_twice_is_409(db_session):
    user = await _make_user(db_session, "to_declare2@example.com")
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    await T.declare(db_session, user, created.order.id, note=None)
    with pytest.raises(HTTPException) as exc:
        await T.declare(db_session, user, created.order.id, note=None)
    assert exc.value.status_code == 409


async def test_declare_not_owner_404(db_session):
    owner = await _make_user(db_session, "to_owner@example.com")
    other = await _make_user(db_session, "to_other@example.com")
    event = await _make_event(db_session)
    created = await T.create_order(db_session, owner, event.id)
    # Alt user → 404 (nu 403): nu confirmăm existența comenzii altcuiva.
    with pytest.raises(HTTPException) as exc:
        await T.declare(db_session, other, created.order.id, note=None)
    assert exc.value.status_code == 404


async def test_declare_missing_order_404(db_session):
    user = await _make_user(db_session, "to_declare_missing@example.com")
    with pytest.raises(HTTPException) as exc:
        await T.declare(db_session, user, uuid.uuid4(), note=None)
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# list_mine / get_mine
# --------------------------------------------------------------------------- #
async def test_list_mine_only_own_orders_newest_first(db_session):
    user = await _make_user(db_session, "to_listmine@example.com")
    other = await _make_user(db_session, "to_listmine_other@example.com")
    # Evenimente DISTINCTE: create_order e idempotent per (user, event), deci două
    # comenzi distincte pentru același user cer două evenimente diferite.
    event1 = await _make_event(db_session, title="Petrecere 1")
    event2 = await _make_event(db_session, title="Petrecere 2")
    o1 = await T.create_order(db_session, user, event1.id)
    o2 = await T.create_order(db_session, user, event2.id)
    await T.create_order(db_session, other, event1.id)

    rows = await T.list_mine(db_session, user)
    ids = [r.id for r in rows]
    assert set(ids) == {o1.order.id, o2.order.id}  # nu apare comanda lui `other`
    # Cel mai recent (o2) primul.
    assert ids[0] == o2.order.id


async def test_get_mine_payment_present_only_while_awaiting(db_session):
    user = await _make_user(db_session, "to_getmine@example.com")
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)

    # awaiting_payment → payment prezent.
    got = await T.get_mine(db_session, user, created.order.id)
    assert got.payment is not None

    # După declare → payment None.
    await T.declare(db_session, user, created.order.id, note=None)
    got2 = await T.get_mine(db_session, user, created.order.id)
    assert got2.payment is None
    assert got2.order.status == STATUS_PAYMENT_DECLARED


async def test_get_mine_not_owner_404(db_session):
    owner = await _make_user(db_session, "to_getmine_owner@example.com")
    other = await _make_user(db_session, "to_getmine_other@example.com")
    event = await _make_event(db_session)
    created = await T.create_order(db_session, owner, event.id)
    with pytest.raises(HTTPException) as exc:
        await T.get_mine(db_session, other, created.order.id)
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Admin: approve / reject + 409 finalitate
# --------------------------------------------------------------------------- #
async def test_approve_generates_unique_ticket_code(db_session):
    user = await _make_user(db_session, "to_approve@example.com")
    admin = await _make_user(db_session, "to_approve_admin@example.com", admin=True)
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    await T.declare(db_session, user, created.order.id, note=None)

    out = await T.approve(db_session, admin, created.order.id, ip="2.2.2.2")
    assert out.status == STATUS_APPROVED
    assert out.ticket_code is not None and len(out.ticket_code) == 32
    assert await _count_audit(db_session, ACTION_TICKET_ORDER_APPROVE) == 1

    # `get_mine` expune ticket_code doar când e aprobată.
    got = await T.get_mine(db_session, user, created.order.id)
    assert got.order.ticket_code == out.ticket_code


async def test_approve_directly_from_awaiting(db_session):
    user = await _make_user(db_session, "to_approve_direct@example.com")
    admin = await _make_user(db_session, "to_approve_direct_admin@example.com", admin=True)
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    # Fără declare (awaiting_payment) → tot decidabil.
    out = await T.approve(db_session, admin, created.order.id)
    assert out.status == STATUS_APPROVED


async def test_double_approve_is_409(db_session):
    user = await _make_user(db_session, "to_dblapprove@example.com")
    admin = await _make_user(db_session, "to_dblapprove_admin@example.com", admin=True)
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    await T.approve(db_session, admin, created.order.id)
    with pytest.raises(HTTPException) as exc:
        await T.approve(db_session, admin, created.order.id)
    assert exc.value.status_code == 409


async def test_reject_sets_status_and_note(db_session):
    user = await _make_user(db_session, "to_reject@example.com")
    admin = await _make_user(db_session, "to_reject_admin@example.com", admin=True)
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    out = await T.reject(db_session, admin, created.order.id, reason="Fără transfer.", ip="3.3.3.3")
    assert out.status == STATUS_REJECTED
    assert out.admin_note == "Fără transfer."
    assert await _count_audit(db_session, ACTION_TICKET_ORDER_REJECT) == 1


async def test_reject_after_approve_is_409(db_session):
    user = await _make_user(db_session, "to_rejapprove@example.com")
    admin = await _make_user(db_session, "to_rejapprove_admin@example.com", admin=True)
    event = await _make_event(db_session)
    created = await T.create_order(db_session, user, event.id)
    await T.approve(db_session, admin, created.order.id)
    with pytest.raises(HTTPException) as exc:
        await T.reject(db_session, admin, created.order.id, reason=None)
    assert exc.value.status_code == 409


async def test_approve_missing_order_404(db_session):
    admin = await _make_user(db_session, "to_approve_missing@example.com", admin=True)
    with pytest.raises(HTTPException) as exc:
        await T.approve(db_session, admin, uuid.uuid4())
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Admin: coada (declared-first) + paginare pe cursor + count_pending
# --------------------------------------------------------------------------- #
async def test_list_orders_declared_first_and_pagination(db_session):
    user = await _make_user(db_session, "to_queue@example.com")
    # Evenimente distincte: create_order e idempotent per (user, event).
    ev_a = await _make_event(db_session, title="Coada A")
    ev_b = await _make_event(db_session, title="Coada B")
    ev_c = await _make_event(db_session, title="Coada C")

    # 2 în așteptare + 1 declarată. Declarata trebuie să iasă prima.
    a = await T.create_order(db_session, user, ev_a.id)
    b = await T.create_order(db_session, user, ev_b.id)
    c = await T.create_order(db_session, user, ev_c.id)
    await T.declare(db_session, user, c.order.id, note=None)

    items, cursor = await T.list_orders(db_session, limit=2)
    assert len(items) == 2
    assert items[0].id == c.order.id  # declarata prima (prioritate 0)
    assert items[0].status == STATUS_PAYMENT_DECLARED
    assert cursor is not None  # mai există o pagină

    items2, cursor2 = await T.list_orders(db_session, limit=2, cursor=cursor)
    ids_all = {items[0].id, items[1].id, *[i.id for i in items2]}
    assert ids_all == {a.order.id, b.order.id, c.order.id}
    assert cursor2 is None  # ultima pagină


async def test_list_orders_empty(db_session):
    items, cursor = await T.list_orders(db_session)
    assert items == []
    assert cursor is None


async def test_count_pending_counts_only_declared(db_session):
    user = await _make_user(db_session, "to_pending@example.com")
    # Evenimente distincte: create_order e idempotent per (user, event).
    ev_a = await _make_event(db_session, title="Pending A")
    ev_b = await _make_event(db_session, title="Pending B")
    a = await T.create_order(db_session, user, ev_a.id)
    b = await T.create_order(db_session, user, ev_b.id)
    await T.declare(db_session, user, a.order.id, note=None)
    # doar `a` e declarată → count == 1
    assert await T.count_pending(db_session) == 1
    # declarăm și `b`
    await T.declare(db_session, user, b.order.id, note=None)
    assert await T.count_pending(db_session) == 2


async def test_count_pending_zero_when_none(db_session):
    assert await T.count_pending(db_session) == 0
