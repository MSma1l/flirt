"""Regresii din review-ul sistemului de bilete (concurență, capacitate, stări).

Cursele sunt reproduse DETERMINIST cu două sesiuni: sesiunea „lentă" (A) citește
comanda, sesiunea „rapidă" (B) face commit pe o tranziție, apoi A își continuă
tranziția pe starea pe care a citit-o. Fără lock + recitire (`FOR UPDATE` +
`populate_existing`), A suprascria decizia lui B.

`_held = …` ține o referință TARE la obiectul citit de A: identity map-ul
SQLAlchemy e slab — fără ea, obiectul e colectat și A ar re-citi din DB.
"""
from __future__ import annotations

import asyncio
import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.event import Event
from app.models.ticket_order import (
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_REJECTED,
    TicketOrder,
)
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import TicketRequestCreateIn
from app.services import loyalty
from app.services import ticket_order_service as T
from app.services import ticket_scan_service as S

API = "/api/v1"
PASSWORD = "Str0ng-Passw0rd!"
PROOF = "https://storage.example/ticket-proofs/x/proof.png"
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)

pytestmark = pytest.mark.asyncio


async def _user(db, email, *, admin=False) -> User:
    user = User(email=email, password_hash=hash_password(PASSWORD))
    if admin:
        user.role = ROLE_ADMIN
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _event(db, *, capacity=None, sold=0) -> Event:
    event = Event(
        title="Flirt Review",
        starts_at=datetime.now(timezone.utc) + timedelta(days=3),
        city="Chișinău",
        kind="party",
        ticket_price=100.0,
        ticket_currency="lei",
        ticket_capacity=capacity,
        tickets_sold=sold,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _sold(db, event_id) -> int:
    return await db.scalar(
        select(Event.tickets_sold)
        .where(Event.id == event_id)
        .execution_options(populate_existing=True)
    )


async def _request(db, user, event, qty=2):
    out = await T.create_request(
        db, user, event.id,
        TicketRequestCreateIn(full_name="Ana Pop", phone="+37360000000", ticket_quantity=qty),
    )
    return out.request.id


# --------------------------------------------------------------------------- #
# Capacitatea pe comenzile DIRECTE (fluxul principal din Mini App)
# --------------------------------------------------------------------------- #
async def test_direct_approve_respects_and_counts_capacity(db_session):
    admin = await _user(db_session, "cap_admin@example.com", admin=True)
    a = await _user(db_session, "cap_a@example.com")
    b = await _user(db_session, "cap_b@example.com")
    event = await _event(db_session, capacity=1)
    oa = (await T.create_order(db_session, a, event.id)).order.id
    ob = (await T.create_order(db_session, b, event.id)).order.id

    await T.approve(db_session, admin, oa)
    assert await _sold(db_session, event.id) == 1

    with pytest.raises(HTTPException) as exc:
        await T.approve(db_session, admin, ob)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        await T.change_status(db_session, admin, ob, STATUS_APPROVED, None)
    assert exc.value.status_code == 409
    assert (await T.get_admin_order(db_session, ob)).status != STATUS_APPROVED

    # Anularea biletului emis eliberează locul → al doilea poate fi aprobat.
    await T.change_status(db_session, admin, oa, STATUS_CANCELLED, None)
    assert await _sold(db_session, event.id) == 0
    await T.approve(db_session, admin, ob)
    assert await _sold(db_session, event.id) == 1


async def test_new_order_refused_when_sold_out_but_existing_one_returned(db_session):
    admin = await _user(db_session, "so_admin@example.com", admin=True)
    a = await _user(db_session, "so_a@example.com")
    b = await _user(db_session, "so_b@example.com")
    c = await _user(db_session, "so_c@example.com")
    event = await _event(db_session, capacity=1)
    oa = (await T.create_order(db_session, a, event.id)).order.id
    ob = (await T.create_order(db_session, b, event.id)).order.id
    await T.approve(db_session, admin, oa)

    with pytest.raises(HTTPException) as exc:
        await T.create_order(db_session, c, event.id)
    assert exc.value.status_code == 409
    # Cine a comandat la timp își primește comanda înapoi (idempotență).
    assert (await T.create_order(db_session, b, event.id)).order.id == ob


# --------------------------------------------------------------------------- #
# Decizii simultane de admin
# --------------------------------------------------------------------------- #
async def test_reject_after_concurrent_approve_is_409(db_session):
    admin = await _user(db_session, "race_admin@example.com", admin=True)
    buyer = await _user(db_session, "race_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    _held = await db_session.get(TicketOrder, oid)  # A a citit comanda (stare veche)

    async with AsyncSessionLocal() as other:
        approved = await T.approve(other, await other.get(User, admin.id), oid)
    code = approved.ticket_code

    with pytest.raises(HTTPException) as exc:
        await T.reject(db_session, admin, oid, "nu găsesc plata")
    assert exc.value.status_code == 409
    out = await T.get_admin_order(db_session, oid)
    assert out.status == STATUS_APPROVED
    assert out.ticket_code == code


async def test_request_double_approve_counts_capacity_once_and_keeps_code(db_session):
    admin = await _user(db_session, "dbl_admin@example.com", admin=True)
    buyer = await _user(db_session, "dbl_buyer@example.com")
    event = await _event(db_session, capacity=10)
    rid = await _request(db_session, buyer, event, qty=2)
    await T.submit_payment_proof(db_session, buyer, rid, PROOF)
    _held = await db_session.get(TicketOrder, rid)  # A: stare + eveniment în identity map

    async with AsyncSessionLocal() as other:
        first = await T.review_request(other, await other.get(User, admin.id), rid, STATUS_APPROVED, None)

    with pytest.raises(HTTPException) as exc:
        await T.review_request(db_session, admin, rid, STATUS_APPROVED, None)
    assert exc.value.status_code == 409
    assert await _sold(db_session, event.id) == 2
    assert (await T.get_admin_order(db_session, rid)).ticket_code == first.ticket_code


async def test_cancel_after_concurrent_scan_is_409(db_session):
    admin = await _user(db_session, "cs_admin@example.com", admin=True)
    buyer = await _user(db_session, "cs_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    code = (await T.approve(db_session, admin, oid)).ticket_code
    _held = await db_session.get(TicketOrder, oid)  # A: încă neadmisă

    async with AsyncSessionLocal() as door:
        res = await S.scan(door, await door.get(User, admin.id), code, event.id)
    assert res.result == "admitted"

    with pytest.raises(HTTPException) as exc:
        await T.change_status(db_session, admin, oid, STATUS_CANCELLED, None)
    assert exc.value.status_code == 409
    out = await T.get_admin_order(db_session, oid)
    assert out.status == STATUS_APPROVED
    assert out.admitted_at is not None


async def test_scan_losing_race_to_cancel_reports_cancelled(db_session):
    admin = await _user(db_session, "sc_admin@example.com", admin=True)
    buyer = await _user(db_session, "sc_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    code = (await T.approve(db_session, admin, oid)).ticket_code
    _held = await db_session.get(TicketOrder, oid)  # scannerul A a citit biletul valid

    async with AsyncSessionLocal() as other:
        await T.change_status(other, await other.get(User, admin.id), oid, STATUS_CANCELLED, None)

    res = await S.scan(db_session, admin, code, event.id)
    assert res.result == "cancelled"
    assert res.ticket.admitted_at is None


# --------------------------------------------------------------------------- #
# Userul vs. adminul: dovada/declararea nu suprascrie o aprobare
# --------------------------------------------------------------------------- #
async def test_proof_upload_after_concurrent_approve_does_not_revert(db_session):
    admin = await _user(db_session, "pu_admin@example.com", admin=True)
    buyer = await _user(db_session, "pu_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    # Pre-check-ul rutei (înainte de upload-ul lent).
    _held = await T.ensure_can_upload_order_proof(db_session, buyer, oid)

    async with AsyncSessionLocal() as other:
        await T.approve(other, await other.get(User, admin.id), oid)

    with pytest.raises(HTTPException) as exc:
        await T.submit_order_proof(db_session, buyer, oid, PROOF, "mia")
    assert exc.value.status_code == 409
    out = await T.get_admin_order(db_session, oid)
    assert out.status == STATUS_APPROVED
    assert out.ticket_code


async def test_declare_after_concurrent_reject_is_409(db_session):
    admin = await _user(db_session, "dc_admin@example.com", admin=True)
    buyer = await _user(db_session, "dc_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    _held = await db_session.get(TicketOrder, oid)

    async with AsyncSessionLocal() as other:
        await T.reject(other, await other.get(User, admin.id), oid, "fără plată")

    with pytest.raises(HTTPException) as exc:
        await T.declare(db_session, buyer, oid, None)
    assert exc.value.status_code == 409
    assert (await T.get_admin_order(db_session, oid)).status == STATUS_REJECTED


# --------------------------------------------------------------------------- #
# Idempotența creării sub concurență (dublu-tap)
# --------------------------------------------------------------------------- #
async def test_concurrent_create_order_creates_a_single_order(db_session):
    buyer = await _user(db_session, "tap_buyer@example.com")
    event = await _event(db_session)
    # Singleton-urile create leneș (fidelitate, date de plată) există deja în
    # producție; testul măsoară DOAR idempotența comenzii.
    await loyalty.price_breakdown(db_session, buyer, event)
    await T.get_payment_settings(db_session)

    async def create():
        async with AsyncSessionLocal() as s:
            return (await T.create_order(s, await s.get(User, buyer.id), event.id)).order.id

    ids = await asyncio.gather(create(), create(), create())
    assert len(set(ids)) == 1
    count = await db_session.scalar(
        select(func.count()).select_from(TicketOrder).where(TicketOrder.event_id == event.id)
    )
    assert count == 1


async def test_create_order_does_not_return_a_pending_request(db_session):
    admin = await _user(db_session, "mix_admin@example.com", admin=True)
    buyer = await _user(db_session, "mix_buyer@example.com")
    event = await _event(db_session)
    rid = await _request(db_session, buyer, event)
    await T.review_request(db_session, admin, rid, STATUS_ADDITIONAL_INFORMATION_REQUIRED, "Detalii")

    out = await T.create_order(db_session, buyer, event.id)
    assert out.order.id != rid
    assert out.payment is not None
    assert out.payment.amount == 100.0


# --------------------------------------------------------------------------- #
# `approve`/`reject` pe o CERERE manuală respectă regulile cererii
# --------------------------------------------------------------------------- #
async def test_approve_endpoint_on_request_requires_proof_and_counts_capacity(db_session):
    admin = await _user(db_session, "ar_admin@example.com", admin=True)
    buyer = await _user(db_session, "ar_buyer@example.com")
    event = await _event(db_session, capacity=5)
    rid = await _request(db_session, buyer, event, qty=3)
    await T.review_request(db_session, admin, rid, STATUS_ADDITIONAL_INFORMATION_REQUIRED, "?")

    with pytest.raises(HTTPException) as exc:
        await T.approve(db_session, admin, rid)
    assert exc.value.status_code == 409
    assert await _sold(db_session, event.id) == 0

    await T.submit_payment_proof(db_session, buyer, rid, PROOF)
    out = await T.approve(db_session, admin, rid)
    assert out.status == STATUS_APPROVED
    assert out.is_request is True
    assert await _sold(db_session, event.id) == 3


# --------------------------------------------------------------------------- #
# API: dovada pe o cerere închisă e refuzată ÎNAINTE de stocare; lista plafonată
# --------------------------------------------------------------------------- #
async def _register(client, email) -> dict:
    resp = await client.post(f"{API}/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_request_proof_on_approved_request_is_refused_before_storing(
    client, db_session, monkeypatch
):
    from app.api.v1 import ticket_orders as routes

    saved: list[str] = []

    class _Storage:
        async def save(self, key, content, content_type):
            saved.append(key)
            return f"https://storage.example/{key}"

    monkeypatch.setattr(routes, "get_storage", lambda: _Storage())
    headers = await _register(client, "closed_req@example.com")
    event = await _event(db_session)
    resp = await client.post(
        f"{API}/events/{event.id}/ticket-requests",
        json={"full_name": "Ana Pop", "phone": "+37360000000", "ticket_quantity": 1},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    rid = resp.json()["request"]["id"]
    order = await db_session.get(TicketOrder, rid)
    order.status = STATUS_APPROVED
    await db_session.commit()

    resp = await client.post(
        f"{API}/ticket-requests/{rid}/payment-proof",
        files={"file": ("p.png", io.BytesIO(PNG_BYTES), "image/png")},
        headers=headers,
    )
    assert resp.status_code == 409, resp.text
    assert saved == []


async def test_admin_ticket_requests_list_is_limited(client, db_session):
    admin = await _user(db_session, "lim_admin@example.com", admin=True)
    for i in range(3):
        buyer = await _user(db_session, f"lim_{i}@example.com")
        await _request(db_session, buyer, await _event(db_session), qty=1)
    assert len(await T.list_requests(db_session, limit=2)) == 2
    assert len(await T.list_requests(db_session)) == 3

    resp = await client.post(
        f"{API}/admin/login", json={"email": admin.email, "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    resp = await client.get(f"{API}/admin/ticket-requests?limit=2", headers=headers)
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) == 2
    resp = await client.get(f"{API}/admin/ticket-requests?limit=0", headers=headers)
    assert resp.status_code == 422


async def test_concurrent_lazy_payment_settings_creation_does_not_500(db_session):
    async def read():
        async with AsyncSessionLocal() as s:
            return await T.get_payment_settings(s)

    outs = await asyncio.gather(*(read() for _ in range(4)))
    assert all(o.bank_iban == "" for o in outs)
