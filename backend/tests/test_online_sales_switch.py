"""Comutatorul GLOBAL al vânzării online de bilete (`payment_settings.online_sales_enabled`).

Cererea proprietarului: un singur buton care oprește vânzarea online la TOATE
evenimentele odată (ex. o problemă cu contul bancar), fără să atingă prețul,
capacitatea sau alte setări; la repornire vânzarea revine exact cum era.

Acoperă:
  * implicit pornit; `PUT /admin/payment-settings/online-sales` doar pentru admin
    (403 user, 401 fără token), merge și fără date bancare configurate, auditat;
  * oprit → evenimentele publice (listă + detaliu): `ticket_sales_open=false`,
    `ticket_sales_paused=true` (doar unde altfel s-ar vinde);
  * oprit → comandă / cerere / cotație NOUĂ: 409 `online_sales_disabled`;
    comanda/cererea EXISTENTĂ se întoarce în continuare;
  * oprit → dovada plății și aprobarea adminului merg normal;
  * `PUT /admin/payment-settings` (complet) NU schimbă comutatorul;
  * repornit → totul revine; migrarea rămâne un singur head.
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.models.admin import (
    ACTION_ONLINE_SALES_DISABLED,
    ACTION_ONLINE_SALES_ENABLED,
    AdminAuditLog,
)
from app.models.event import Event
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
SWITCH = f"{ADMIN}/payment-settings/online-sales"
PASSWORD = "Str0ng-Passw0rd!"
BACKEND = Path(__file__).resolve().parents[1]

PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)
REQUEST_BODY = {"full_name": "Ana Popescu", "phone": "+37360000000", "ticket_quantity": 1}

pytestmark = pytest.mark.asyncio


def _now() -> datetime:
    return datetime.now(timezone.utc)


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


async def _event(db, *, price=100.0, capacity=None, sold=0, title="Petrecere") -> Event:
    event = Event(
        title=title,
        starts_at=_now() + timedelta(days=3),
        city="Chișinău",
        kind="party",
        ticket_price=price,
        ticket_currency="lei" if price is not None else None,
        ticket_capacity=capacity,
        tickets_sold=sold,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _switch(client, admin: dict, enabled: bool) -> dict:
    resp = await client.put(SWITCH, json={"enabled": enabled}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json()["online_sales_enabled"] is enabled
    return resp.json()


async def _audit_count(db, action: str) -> int:
    return await db.scalar(
        select(func.count()).select_from(AdminAuditLog).where(AdminAuditLog.action == action)
    )


# --------------------------------------------------------------------------- #
# Admin: comutatorul
# --------------------------------------------------------------------------- #
async def test_default_enabled_and_toggle_without_bank_data(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin1@example.com")
    got = await client.get(f"{ADMIN}/payment-settings", headers=admin)
    assert got.status_code == 200, got.text
    assert got.json()["online_sales_enabled"] is True

    # Fără IBAN / MIA configurate: oprirea merge oricum (singleton creat leneș).
    off = await _switch(client, admin, False)
    assert off["bank_iban"] == "" and off["payment_methods"] == []
    got = await client.get(f"{ADMIN}/payment-settings", headers=admin)
    assert got.json()["online_sales_enabled"] is False
    assert await _audit_count(db_session, ACTION_ONLINE_SALES_DISABLED) == 1

    # Idempotent: o a doua oprire nu mai scrie în jurnal.
    await _switch(client, admin, False)
    assert await _audit_count(db_session, ACTION_ONLINE_SALES_DISABLED) == 1

    await _switch(client, admin, True)
    assert await _audit_count(db_session, ACTION_ONLINE_SALES_ENABLED) == 1


async def test_toggle_is_admin_only(client, db_session):
    user = await _register(client, "os_plain@example.com")
    resp = await client.put(SWITCH, json={"enabled": False}, headers=user)
    assert resp.status_code == 403, resp.text
    resp = await client.put(SWITCH, json={"enabled": False})
    assert resp.status_code == 401, resp.text
    admin = await _make_admin(client, db_session, "os_admin2@example.com")
    resp = await client.put(SWITCH, json={}, headers=admin)
    assert resp.status_code == 422, resp.text
    got = await client.get(f"{ADMIN}/payment-settings", headers=admin)
    assert got.json()["online_sales_enabled"] is True


async def test_full_put_preserves_flag(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin3@example.com")
    await _switch(client, admin, False)
    put = await client.put(
        f"{ADMIN}/payment-settings",
        json={
            "bank_beneficiary": "SRL Flirt",
            "bank_iban": "MD24AG000000000000000000",
            # Un client care trimite câmpul în PUT-ul complet nu-l poate schimba.
            "online_sales_enabled": True,
        },
        headers=admin,
    )
    assert put.status_code == 200, put.text
    assert put.json()["online_sales_enabled"] is False
    assert put.json()["bank_iban"] == "MD24AG000000000000000000"

    # Și invers: comutatorul nu atinge datele bancare.
    on = await _switch(client, admin, True)
    assert on["bank_beneficiary"] == "SRL Flirt"
    assert on["bank_iban"] == "MD24AG000000000000000000"


# --------------------------------------------------------------------------- #
# Public: evenimentele
# --------------------------------------------------------------------------- #
async def test_events_show_paused_while_off_and_restore_on(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin4@example.com")
    user = await _register(client, "os_viewer@example.com")
    selling = await _event(db_session, title="Vinde", capacity=50, sold=3)
    free = await _event(db_session, price=None, title="Fără preț")
    sold_out = await _event(db_session, capacity=2, sold=2, title="Sold-out")

    def _by_id(items):
        return {item["id"]: item for item in items}

    listed = _by_id((await client.get(f"{API}/events/", headers=user)).json())
    assert listed[str(selling.id)]["ticket_sales_open"] is True
    assert listed[str(selling.id)]["ticket_sales_paused"] is False

    await _switch(client, admin, False)
    resp = await client.get(f"{API}/events/", headers=user)
    assert resp.status_code == 200, resp.text
    listed = _by_id(resp.json())
    assert listed[str(selling.id)]["ticket_sales_open"] is False
    assert listed[str(selling.id)]["ticket_sales_paused"] is True
    # Unde oricum nu s-ar vinde, nu e „suspendat".
    for event in (free, sold_out):
        assert listed[str(event.id)]["ticket_sales_open"] is False
        assert listed[str(event.id)]["ticket_sales_paused"] is False

    detail = (await client.get(f"{API}/events/{selling.id}", headers=user)).json()
    assert detail["ticket_sales_open"] is False
    assert detail["ticket_sales_paused"] is True
    # Setările evenimentului rămân neatinse.
    assert detail["ticket_price"] == 100.0

    await _switch(client, admin, True)
    detail = (await client.get(f"{API}/events/{selling.id}", headers=user)).json()
    assert detail["ticket_sales_open"] is True
    assert detail["ticket_sales_paused"] is False
    order = await client.post(f"{API}/events/{selling.id}/ticket-orders", headers=user)
    assert order.status_code == 201, order.text


# --------------------------------------------------------------------------- #
# Public: comenzi / cereri / cotație
# --------------------------------------------------------------------------- #
async def test_new_order_request_and_quote_409_while_off(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin5@example.com")
    user = await _register(client, "os_buyer5@example.com")
    event = await _event(db_session)
    await _switch(client, admin, False)

    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=user)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "online_sales_disabled"
    assert resp.json()["detail"]

    resp = await client.post(
        f"{API}/events/{event.id}/ticket-requests", json=REQUEST_BODY, headers=user
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "online_sales_disabled"

    resp = await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=user)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "online_sales_disabled"


async def test_existing_order_and_request_still_returned_while_off(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin6@example.com")
    user = await _register(client, "os_buyer6@example.com")
    event = await _event(db_session)
    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=user)
    assert order.status_code == 201, order.text
    req_event = await _event(db_session, title="Cereri")
    req = await client.post(
        f"{API}/events/{req_event.id}/ticket-requests", json=REQUEST_BODY, headers=user
    )
    assert req.status_code == 201, req.text

    await _switch(client, admin, False)

    again = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=user)
    assert again.status_code in (200, 201), again.text
    assert again.json()["order"]["id"] == order.json()["order"]["id"]
    assert again.json()["payment"] is not None

    req_again = await client.post(
        f"{API}/events/{req_event.id}/ticket-requests", json=REQUEST_BODY, headers=user
    )
    assert req_again.status_code in (200, 201), req_again.text
    assert req_again.json()["request"]["id"] == req.json()["request"]["id"]


async def test_proof_upload_and_approve_work_while_off(client, db_session):
    admin = await _make_admin(client, db_session, "os_admin7@example.com")
    user = await _register(client, "os_buyer7@example.com")
    event = await _event(db_session, capacity=10)
    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=user)
    assert order.status_code == 201, order.text
    order_id = order.json()["order"]["id"]

    await _switch(client, admin, False)

    proof = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files={"file": ("chitanta.png", io.BytesIO(PNG_BYTES), "image/png")},
        data={"method": "mia"},
        headers=user,
    )
    assert proof.status_code == 200, proof.text
    assert proof.json()["status"] == "payment_declared"

    approved = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["ticket_code"]

    mine = await client.get(f"{API}/ticket-orders/{order_id}", headers=user)
    assert mine.status_code == 200, mine.text
    assert mine.json()["order"]["status"] == "approved"


# --------------------------------------------------------------------------- #
# Migrarea
# --------------------------------------------------------------------------- #
async def test_migration_single_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    # Un singur head (fără ramuri); migrarea comutatorului rămâne în lanț, chiar
    # dacă au apărut migrări noi peste ea.
    heads = script.get_heads()
    assert len(heads) == 1
    assert "c9e2f6a4d1b7" in {r.revision for r in script.walk_revisions("base", heads[0])}
    assert script.get_revision("c9e2f6a4d1b7").down_revision == "b8e1d4f7a2c3"
