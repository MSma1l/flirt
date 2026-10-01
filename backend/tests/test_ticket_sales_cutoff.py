"""Închiderea vânzării online de bilete la o oră setată per eveniment.

Cererea proprietarului: fără haos la intrare — vânzarea online se oprește la
`ticket_sales_end_at` (sau, implicit, la `starts_at`).

Acoperă:
  * admin: citire/scriere a valorii BRUTE + validarea „cel mult start + 12h" (422),
    inclusiv la un PUT care mută doar ora de start;
  * public: `ticket_sales_end_at` EFECTIV + `ticket_sales_open`
    (fără preț / închis / sold-out → False);
  * comandă/cerere NOUĂ după închidere → 409 `ticket_sales_closed`;
  * comanda existentă se poate finaliza după închidere, dar doar până la start
    (după start → 409 `event_started`); aprobarea adminului rămâne permisă.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.errors import CodedHTTPException
from app.models.event import Event
from app.models.ticket_order import STATUS_APPROVED
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import TicketRequestCreateIn
from app.services import ticket_order_service as tickets

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

pytestmark = pytest.mark.asyncio


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


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


async def _event(db, *, price=100.0, sales_end=None, capacity=None, sold=0, in_days=3) -> Event:
    event = Event(
        title="Petrecere Flirt",
        starts_at=_now() + timedelta(days=in_days),
        city="Chișinău",
        kind="party",
        ticket_price=price,
        ticket_currency="lei" if price is not None else None,
        ticket_capacity=capacity,
        tickets_sold=sold,
        ticket_sales_end_at=sales_end,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _public_event(client, headers, event_id) -> dict:
    resp = await client.get(f"{API}/events/{event_id}", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


# --------------------------------------------------------------------------- #
# Admin: scriere / citire / validare
# --------------------------------------------------------------------------- #
async def test_admin_sets_cutoff_and_public_sees_effective_value(client, db_session):
    headers = await _make_admin(client, db_session, "cut_admin@example.com")
    user_headers = await _register(client, "cut_user@example.com")
    starts = _now() + timedelta(days=5)
    cutoff = starts - timedelta(hours=2)
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "Flirt Party",
            "starts_at": starts.isoformat(),
            "city": "Chișinău",
            "ticket_price": 150,
            "ticket_sales_end_at": cutoff.isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert _parse(body["ticket_sales_end_at"]) == cutoff

    public = await _public_event(client, user_headers, body["id"])
    assert _parse(public["ticket_sales_end_at"]) == cutoff
    assert public["ticket_sales_open"] is True

    # Ștergerea valorii (null) → adminul vede null, publicul vede starts_at.
    resp = await client.put(
        f"{ADMIN}/events/{body['id']}",
        json={"ticket_sales_end_at": None},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ticket_sales_end_at"] is None
    public = await _public_event(client, user_headers, body["id"])
    assert _parse(public["ticket_sales_end_at"]) == starts


async def test_admin_cutoff_too_late_is_422(client, db_session):
    headers = await _make_admin(client, db_session, "cut_admin2@example.com")
    starts = _now() + timedelta(days=5)
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "Flirt Party",
            "starts_at": starts.isoformat(),
            "city": "Chișinău",
            "ticket_sales_end_at": (starts + timedelta(hours=13)).isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "12 ore" in resp.json()["detail"]

    # Exact la limită (start + 12h) e permis.
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "Flirt Party",
            "starts_at": starts.isoformat(),
            "city": "Chișinău",
            "ticket_sales_end_at": (starts + timedelta(hours=12)).isoformat(),
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    event_id = resp.json()["id"]

    # Un PUT care mută DOAR startul mai devreme invalidează închiderea existentă.
    resp = await client.put(
        f"{ADMIN}/events/{event_id}",
        json={"starts_at": (starts - timedelta(days=1)).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    # PUT direct cu o valoare prea târzie → 422.
    resp = await client.put(
        f"{ADMIN}/events/{event_id}",
        json={"ticket_sales_end_at": (starts + timedelta(days=2)).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


# --------------------------------------------------------------------------- #
# Public: `ticket_sales_open`
# --------------------------------------------------------------------------- #
async def test_public_sales_open_flags(client, db_session):
    headers = await _register(client, "flags@example.com")
    default = await _event(db_session)
    no_price = await _event(db_session, price=None)
    closed = await _event(db_session, sales_end=_now() - timedelta(minutes=1))
    sold_out = await _event(db_session, capacity=2, sold=2)

    body = await _public_event(client, headers, default.id)
    assert body["ticket_sales_open"] is True
    assert _parse(body["ticket_sales_end_at"]) == default.starts_at
    assert (await _public_event(client, headers, no_price.id))["ticket_sales_open"] is False
    assert (await _public_event(client, headers, closed.id))["ticket_sales_open"] is False
    assert (await _public_event(client, headers, sold_out.id))["ticket_sales_open"] is False

    listed = {e["id"]: e for e in (await client.get(f"{API}/events/", headers=headers)).json()}
    assert listed[str(closed.id)]["ticket_sales_open"] is False
    assert listed[str(default.id)]["ticket_sales_open"] is True


# --------------------------------------------------------------------------- #
# Enforce la creare
# --------------------------------------------------------------------------- #
async def test_new_order_after_cutoff_409_with_code(client, db_session):
    headers = await _register(client, "late_order@example.com")
    event = await _event(db_session, sales_end=_now() - timedelta(minutes=1))
    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "ticket_sales_closed"
    assert resp.json()["detail"]


async def test_new_request_after_cutoff_409_with_code(client, db_session):
    headers = await _register(client, "late_req@example.com")
    event = await _event(db_session, sales_end=_now() - timedelta(minutes=1))
    resp = await client.post(
        f"{API}/events/{event.id}/ticket-requests",
        json={"full_name": "Ana Popescu", "phone": "+37360000000", "ticket_quantity": 1},
        headers=headers,
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "ticket_sales_closed"


async def test_started_event_keeps_400_and_gains_code(client, db_session):
    """Retrocompatibil: evenimentul început rămâne 400 (aplicația nativă), dar
    primește și `code`, ca Mini App-ul să-l trateze la fel ca închiderea."""
    headers = await _register(client, "started@example.com")
    event = await _event(db_session, in_days=-1)
    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert resp.status_code == 400, resp.text
    assert resp.json()["code"] == "ticket_sales_closed"


async def test_order_before_cutoff_still_open(client, db_session):
    headers = await _register(client, "early@example.com")
    event = await _event(db_session, sales_end=_now() + timedelta(hours=1))
    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert resp.status_code == 201, resp.text


# --------------------------------------------------------------------------- #
# Comanda existentă: se termină după închidere, dar doar până la start
# --------------------------------------------------------------------------- #
async def test_existing_order_can_be_finished_after_cutoff(client, db_session):
    headers = await _register(client, "finish@example.com")
    event = await _event(db_session)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    ).json()["order"]["id"]

    event.ticket_sales_end_at = _now() - timedelta(minutes=1)
    await db_session.commit()

    # Re-POST întoarce comanda existentă (idempotent), nu 409.
    again = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert again.status_code == 201, again.text
    assert again.json()["order"]["id"] == order_id

    resp = await client.post(
        f"{API}/ticket-orders/{order_id}/declare", json={}, headers=headers
    )
    assert resp.status_code == 200, resp.text


async def test_declare_after_start_409_event_started(client, db_session):
    headers = await _register(client, "declare_late@example.com")
    event = await _event(db_session)
    order_id = (
        await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    ).json()["order"]["id"]
    event.starts_at = _now() - timedelta(minutes=1)
    await db_session.commit()
    resp = await client.post(
        f"{API}/ticket-orders/{order_id}/declare", json={}, headers=headers
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "event_started"


async def test_proof_after_cutoff_ok_after_start_refused_admin_approves(db_session):
    user = User(email="proof_cut@example.com", password_hash="x")
    admin = User(email="proof_cut_admin@example.com", password_hash="x", role=ROLE_ADMIN)
    db_session.add_all([user, admin])
    await db_session.commit()
    event = await _event(db_session)
    created = await tickets.create_request(
        db_session, user, event.id,
        TicketRequestCreateIn(full_name="Ana", phone="1", ticket_quantity=1),
    )
    request_id = created.request.id

    # După închiderea vânzării, înainte de start: dovada e acceptată.
    event.ticket_sales_end_at = _now() - timedelta(minutes=1)
    await db_session.commit()
    out = await tickets.submit_payment_proof(
        db_session, user, request_id, "https://storage.example/ticket-proofs/a.png"
    )
    assert out.payment_proof_uploaded is True

    # O cerere NOUĂ de la alt user e refuzată cu cod stabil.
    other = User(email="proof_cut_other@example.com", password_hash="x")
    db_session.add(other)
    await db_session.commit()
    with pytest.raises(CodedHTTPException) as exc:
        await tickets.create_request(
            db_session, other, event.id,
            TicketRequestCreateIn(full_name="Ion", phone="2", ticket_quantity=1),
        )
    assert exc.value.status_code == 409
    assert exc.value.code == "ticket_sales_closed"

    # După start: o nouă dovadă e refuzată…
    event.starts_at = _now() - timedelta(minutes=1)
    event.ticket_sales_end_at = None
    await db_session.commit()
    with pytest.raises(CodedHTTPException) as exc:
        await tickets.submit_payment_proof(
            db_session, user, request_id, "https://storage.example/ticket-proofs/b.png"
        )
    assert exc.value.status_code == 409
    assert exc.value.code == "event_started"

    # …dar adminul poate aproba oricând.
    approved = await tickets.review_request(db_session, admin, request_id, STATUS_APPROVED, None)
    assert approved.status == STATUS_APPROVED
