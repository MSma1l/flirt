"""Teste funcționale pentru CUMPĂRAREA de BILETE ONLINE prin transfer bancar cu
verificare manuală de admin.

Acoperă:
  * creare comandă (fără preț pe eveniment → 400)
  * instrucțiunile conțin referința = payment_ref al userului
  * declare schimbă statusul awaiting_payment → payment_declared
  * admin listă: comenzile DECLARATE primele
  * approve generează ticket_code + `mine` îl arată; dublu-approve → 409
  * reject → status rejected + admin_note
  * payment-settings GET (defaults goale) / PUT
  * user normal NU accesează rutele de admin (403)

Rulează pe PostgreSQL efemer (fixturile din `conftest.py`).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.ticket_order import user_payment_ref
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

pytestmark = pytest.mark.asyncio


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str) -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


async def _create_event(db, *, ticket_price: float | None = None, title="Petrecere Flirt") -> Event:
    event = Event(
        title=title,
        starts_at=datetime.now(timezone.utc) + timedelta(days=7),
        city="Chișinău",
        kind="party",
        ticket_price=ticket_price,
        ticket_currency="lei" if ticket_price is not None else None,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


# --------------------------------------------------------------------------- #
# Creare comandă + instrucțiuni
# --------------------------------------------------------------------------- #
async def test_create_order_without_price_400(client, db_session):
    headers = await _register(client, "u1@example.com")
    event = await _create_event(db_session, ticket_price=None)
    resp = await client.post(
        f"{API}/events/{event.id}/ticket-orders", headers=headers
    )
    assert resp.status_code == 400, resp.text


async def test_create_order_instructions_have_payment_ref(client, db_session):
    headers = await _register(client, "u2@example.com")
    user = await db_session.scalar(select(User).where(User.email == "u2@example.com"))
    event = await _create_event(db_session, ticket_price=150.0)

    resp = await client.post(
        f"{API}/events/{event.id}/ticket-orders", headers=headers
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    expected_ref = user_payment_ref(user)
    assert body["order"]["status"] == "awaiting_payment"
    assert body["order"]["reference"] == expected_ref
    assert body["order"]["ticket_code"] is None
    assert body["order"]["price"] == 150.0
    assert body["order"]["currency"] == "lei"

    payment = body["payment"]
    assert payment["reference"] == expected_ref
    assert payment["amount"] == 150.0
    assert expected_ref in payment["comment_template"]
    assert event.title in payment["comment_template"]


# --------------------------------------------------------------------------- #
# Declare
# --------------------------------------------------------------------------- #
async def test_declare_changes_status(client, db_session):
    headers = await _register(client, "u3@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    ).json()["order"]["id"]

    resp = await client.post(
        f"{API}/ticket-orders/{order_id}/declare",
        json={"note": "Am plătit azi dimineață"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "payment_declared"
    assert resp.json()["user_note"] == "Am plătit azi dimineață"

    # A doua declarație pe aceeași comandă → 409 (deja declarată).
    again = await client.post(
        f"{API}/ticket-orders/{order_id}/declare", json={}, headers=headers
    )
    assert again.status_code == 409, again.text


async def test_declare_not_owner_404(client, db_session):
    owner = await _register(client, "owner@example.com")
    other = await _register(client, "other@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=owner)
    ).json()["order"]["id"]

    resp = await client.post(
        f"{API}/ticket-orders/{order_id}/declare", json={}, headers=other
    )
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# Admin: listă declared-first + approve/reject
# --------------------------------------------------------------------------- #
async def test_admin_list_declared_first(client, db_session):
    admin = await _make_admin(client, db_session, "admin1@example.com")
    ua = await _register(client, "buyer_a@example.com")
    ub = await _register(client, "buyer_b@example.com")
    event = await _create_event(db_session, ticket_price=100.0)

    # A: rămâne awaiting_payment. B: declară plata.
    await client.post(f"{API}/events/{event.id}/ticket-orders", headers=ua)
    order_b = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=ub)
    ).json()["order"]["id"]
    await client.post(f"{API}/ticket-orders/{order_b}/declare", json={}, headers=ub)

    resp = await client.get(f"{ADMIN}/ticket-orders", headers=admin)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 2
    # Comanda DECLARATĂ trebuie să fie prima.
    assert items[0]["status"] == "payment_declared"
    assert items[0]["id"] == order_b
    assert items[0]["user"]["email"] == "buyer_b@example.com"
    assert items[0]["user"]["payment_ref"].startswith("U-")
    assert items[0]["event"]["title"] == event.title


async def test_approve_generates_ticket_code_and_mine_shows_it(client, db_session):
    admin = await _make_admin(client, db_session, "admin2@example.com")
    buyer = await _register(client, "buyer2@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    ).json()["order"]["id"]
    await client.post(f"{API}/ticket-orders/{order_id}/declare", json={}, headers=buyer)

    resp = await client.post(
        f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin
    )
    assert resp.status_code == 200, resp.text
    approved = resp.json()
    assert approved["status"] == "approved"
    assert approved["ticket_code"]
    assert approved["decided_at"] is not None

    # `mine` arată ticket_code-ul DOAR când e aprobată.
    mine = await client.get(f"{API}/ticket-orders/mine", headers=buyer)
    assert mine.status_code == 200, mine.text
    row = next(o for o in mine.json() if o["id"] == order_id)
    assert row["status"] == "approved"
    assert row["ticket_code"] == approved["ticket_code"]

    # GET pe comandă: aprobată → fără instrucțiuni de plată, cu ticket_code.
    one = await client.get(f"{API}/ticket-orders/{order_id}", headers=buyer)
    assert one.status_code == 200, one.text
    assert one.json()["payment"] is None
    assert one.json()["order"]["ticket_code"] == approved["ticket_code"]


async def test_double_approve_rejected(client, db_session):
    admin = await _make_admin(client, db_session, "admin3@example.com")
    buyer = await _register(client, "buyer3@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    ).json()["order"]["id"]

    first = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert first.status_code == 200, first.text
    second = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert second.status_code == 409, second.text


async def test_reject_sets_status_and_note(client, db_session):
    admin = await _make_admin(client, db_session, "admin4@example.com")
    buyer = await _register(client, "buyer4@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    ).json()["order"]["id"]

    resp = await client.post(
        f"{ADMIN}/ticket-orders/{order_id}/reject",
        json={"reason": "Nu s-a găsit transferul"},
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"
    assert resp.json()["admin_note"] == "Nu s-a găsit transferul"

    # Nu se mai poate aproba după respingere.
    approve = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert approve.status_code == 409, approve.text


# --------------------------------------------------------------------------- #
# Payment settings (singleton)
# --------------------------------------------------------------------------- #
async def test_payment_settings_get_and_put(client, db_session):
    admin = await _make_admin(client, db_session, "admin5@example.com")

    got = await client.get(f"{ADMIN}/payment-settings", headers=admin)
    assert got.status_code == 200, got.text
    assert got.json()["bank_iban"] == ""  # placeholder gol la creare leneșă

    put = await client.put(
        f"{ADMIN}/payment-settings",
        json={
            "bank_beneficiary": "SRL Flirt",
            "bank_iban": "MD24AG000000000000000000",
            "bank_name": "MAIB",
            "instructions": "Plătiți în 24h.",
        },
        headers=admin,
    )
    assert put.status_code == 200, put.text
    assert put.json()["bank_beneficiary"] == "SRL Flirt"
    assert put.json()["bank_iban"] == "MD24AG000000000000000000"

    # Instrucțiunile de plată din comandă reflectă noile date bancare.
    buyer = await _register(client, "buyer5@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    order = await client.post(
        f"{API}/events/{event.id}/ticket-orders", headers=buyer
    )
    assert order.json()["payment"]["iban"] == "MD24AG000000000000000000"
    assert order.json()["payment"]["beneficiary"] == "SRL Flirt"


# --------------------------------------------------------------------------- #
# Auth: user normal NU accesează rutele de admin
# --------------------------------------------------------------------------- #
async def test_user_cannot_access_admin_routes(client, db_session):
    user = await _register(client, "plainuser@example.com")
    for method, path in (
        ("get", f"{ADMIN}/ticket-orders"),
        ("get", f"{ADMIN}/payment-settings"),
    ):
        resp = await getattr(client, method)(path, headers=user)
        assert resp.status_code == 403, f"{path}: {resp.status_code}"

    put = await client.put(
        f"{ADMIN}/payment-settings",
        json={"bank_beneficiary": "x", "bank_iban": "y"},
        headers=user,
    )
    assert put.status_code == 403, put.text
