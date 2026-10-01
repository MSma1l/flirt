"""Teste pentru SCANAREA biletelor la intrare (`/api/v1/admin/tickets/*`) și
starea de ciclu de viață expusă clienților (`status` / `ticket_status`).

Acoperă:
  * fiecare rezultat de scanare (admitted, already_admitted, wrong_event,
    not_paid, cancelled, event_over, not_found);
  * cursa a două scanări simultane (o singură admitere, a doua vede ora originală);
  * ștampila Flirt Passport creată O SINGURĂ DATĂ;
  * normalizarea codului tastat (litere mari, spații, cratime, prefix);
  * biletul Flirt Party (consumat la un eveniment `flirt_party`);
  * calculul stărilor valid / admitted / used / expired / cancelled;
  * contorul live + lista de intrări; autentificare obligatorie.

Rulează pe PostgreSQL efemer (fixturile din `conftest.py`).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.db.session import AsyncSessionLocal
from app.models.account import Ticket
from app.models.admin import ACTION_TICKET_ADMIT, AdminAuditLog
from app.models.event import Event, FlirtPassportStamp
from app.models.profile import Profile
from app.models.ticket_order import TicketOrder
from app.models.user import ROLE_ADMIN, User
from app.services import ticket_scan_service
from app.services.ticket_lifecycle import order_ticket_status, party_ticket_status

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

# `asyncio_mode = "auto"` (pyproject) — fără marcaj global, ca testele pure
# (sincrone) de mai jos să nu primească avertismente.


# --------------------------------------------------------------------------- #
# Helperi
# --------------------------------------------------------------------------- #
async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _user(db, email: str) -> User:
    return await db.scalar(select(User).where(User.email == email))


async def _make_admin(client, db, email: str = "staff@example.com") -> dict:
    headers = await _register(client, email)
    user = await _user(db, email)
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


async def _holder(client, db, email: str = "guest@example.com") -> tuple[dict, User]:
    headers = await _register(client, email)
    user = await _user(db, email)
    db.add(
        Profile(
            user_id=user.id,
            name="Ana Maria Popescu",
            birth_date=date(2000, 1, 1),
            gender="female",
            height_cm=170,
            city="Chișinău",
            photos=["https://cdn.example.com/ana.jpg"],
        )
    )
    await db.commit()
    return headers, user


async def _event(db, *, starts_in=timedelta(hours=1), kind="party", title="Petrecere") -> Event:
    event = Event(
        title=title,
        starts_at=datetime.now(timezone.utc) + starts_in,
        city="Chișinău",
        kind=kind,
        ticket_price=100.0,
        ticket_currency="lei",
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _order(db, user: User, event: Event, *, status="approved", quantity=1) -> TicketOrder:
    order = TicketOrder(
        user_id=user.id,
        event_id=event.id,
        price=100.0,
        total_amount=100.0 * quantity,
        ticket_quantity=quantity,
        currency="lei",
        reference="123456",
        status=status,
        ticket_code=uuid.uuid4().hex if status == "approved" else None,
    )
    db.add(order)
    await db.commit()
    await db.refresh(order)
    return order


async def _scan(client, headers, code: str, event_id) -> dict:
    resp = await client.post(
        f"{ADMIN}/tickets/scan",
        json={"code": code, "event_id": str(event_id)},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _stamps(db, user_id, event_id) -> int:
    return await db.scalar(
        select(func.count())
        .select_from(FlirtPassportStamp)
        .where(FlirtPassportStamp.user_id == user_id, FlirtPassportStamp.event_id == event_id)
    )


# --------------------------------------------------------------------------- #
# Rezultatele scanării
# --------------------------------------------------------------------------- #
async def test_scan_admits_valid_ticket_and_stamps_passport(client, db_session):
    staff = await _make_admin(client, db_session)
    guest_headers, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event, quantity=2)

    body = await _scan(client, staff, order.ticket_code, event.id)
    assert body["result"] == "admitted"
    t = body["ticket"]
    assert t["first_name"] == "Ana"
    assert t["age"] >= 18
    assert t["photo_url"] == "https://cdn.example.com/ana.jpg"
    assert t["event_title"] == "Petrecere"
    assert t["ticket_quantity"] == 2
    assert t["admitted_at"] is not None
    assert t["admitted_by_email"] == "staff@example.com"

    assert await _stamps(db_session, guest.id, event.id) == 1
    audits = await db_session.scalar(
        select(func.count()).select_from(AdminAuditLog).where(AdminAuditLog.action == ACTION_TICKET_ADMIT)
    )
    assert audits == 1

    # Userul vede biletul „admis" (status de bilet, aditiv).
    mine = (await client.get(f"{API}/ticket-orders/mine", headers=guest_headers)).json()
    assert mine[0]["status"] == "approved"  # starea comenzii rămâne neschimbată
    assert mine[0]["ticket_status"] == "admitted"
    assert mine[0]["admitted_at"] is not None


async def test_second_scan_already_admitted_with_original_time(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event)

    first = await _scan(client, staff, order.ticket_code, event.id)
    second = await _scan(client, staff, order.ticket_code, event.id)
    assert first["result"] == "admitted"
    assert second["result"] == "already_admitted"
    assert second["ticket"]["admitted_at"] == first["ticket"]["admitted_at"]
    assert second["ticket"]["admitted_by_email"] == "staff@example.com"
    # Ștampila NU se dublează.
    assert await _stamps(db_session, guest.id, event.id) == 1


async def test_concurrent_scans_admit_once(client, db_session):
    """Două scanări SIMULTANE (sesiuni/conexiuni diferite) → o singură admitere."""
    await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event)
    code, event_id = order.ticket_code, event.id

    async def one_scan():
        async with AsyncSessionLocal() as s:
            actor = await s.scalar(select(User).where(User.email == "staff@example.com"))
            return await ticket_scan_service.scan(s, actor, code, event_id)

    results = await asyncio.gather(*(one_scan() for _ in range(4)))
    outcomes = sorted(r.result for r in results)
    assert outcomes == ["admitted", "already_admitted", "already_admitted", "already_admitted"]
    times = {r.ticket.admitted_at for r in results}
    assert len(times) == 1  # toți văd ora ORIGINALĂ
    assert await _stamps(db_session, guest.id, event.id) == 1


async def test_wrong_event(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session, title="Alt eveniment")
    other = await _event(db_session, title="Cel scanat")
    order = await _order(db_session, guest, event)

    body = await _scan(client, staff, order.ticket_code, other.id)
    assert body["result"] == "wrong_event"
    assert body["ticket"]["event_title"] == "Alt eveniment"
    await db_session.refresh(order)
    assert order.admitted_at is None


@pytest.mark.parametrize("status_,expected", [
    ("payment_declared", "not_paid"),
    ("payment_proof_submitted", "not_paid"),
    ("rejected", "cancelled"),
    ("cancelled", "cancelled"),
])
async def test_unpaid_and_cancelled(client, db_session, status_, expected):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event, status=status_)
    # Codul poate exista (ex. comandă aprobată apoi anulată) — îl punem explicit.
    order.ticket_code = uuid.uuid4().hex
    await db_session.commit()

    body = await _scan(client, staff, order.ticket_code, event.id)
    assert body["result"] == expected
    assert await _stamps(db_session, guest.id, event.id) == 0


async def test_event_over(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session, starts_in=-timedelta(hours=13))
    order = await _order(db_session, guest, event)

    body = await _scan(client, staff, order.ticket_code, event.id)
    assert body["result"] == "event_over"


async def test_not_found_and_garbage(client, db_session):
    staff = await _make_admin(client, db_session)
    event = await _event(db_session)
    assert (await _scan(client, staff, uuid.uuid4().hex, event.id))["result"] == "not_found"
    assert (await _scan(client, staff, "<script>", event.id))["result"] == "not_found"
    assert (await _scan(client, staff, "   ", event.id))["result"] == "not_found"


async def test_unknown_event_404(client, db_session):
    staff = await _make_admin(client, db_session)
    resp = await client.post(
        f"{ADMIN}/tickets/scan",
        json={"code": "abc", "event_id": str(uuid.uuid4())},
        headers=staff,
    )
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# Normalizarea codului tastat
# --------------------------------------------------------------------------- #
async def test_typed_code_is_normalized(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event)
    code = order.ticket_code
    typed = " " + "-".join(code[i:i + 4] for i in range(0, 32, 4)).upper() + "  "

    body = await _scan(client, staff, typed, event.id)
    assert body["result"] == "admitted"


async def test_typed_prefix_matches_within_event(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event)

    body = await _scan(client, staff, order.ticket_code[:8].upper(), event.id)
    assert body["result"] == "admitted"
    # Prefix prea scurt → nu se acceptă.
    assert (await _scan(client, staff, order.ticket_code[:5], event.id))["result"] == "not_found"


def test_normalize_code_unit():
    n = ticket_scan_service.normalize_code
    assert n("AB-CD ef_12") == "abcdef12"
    assert n("https://flrt.md/t/ABCDEF12") == "abcdef12"
    assert n("https://flrt.md/t?code=abc-def") == "abcdef"
    assert n("") is None
    assert n("%%%") is None


# --------------------------------------------------------------------------- #
# Biletul Flirt Party
# --------------------------------------------------------------------------- #
async def test_flirt_party_ticket(client, db_session):
    staff = await _make_admin(client, db_session)
    guest_headers, guest = await _holder(client, db_session)
    party = await _event(db_session, kind="flirt_party", title="Flirt Party")
    concert = await _event(db_session, kind="concert", title="Concert")

    ticket = (await client.get(f"{API}/ticket/", headers=guest_headers)).json()
    assert ticket["status"] == "valid"
    assert ticket["used"] is False
    assert ticket["admitted_at"] is None

    assert (await _scan(client, staff, ticket["code"], concert.id))["result"] == "wrong_event"
    first = await _scan(client, staff, ticket["code"], party.id)
    assert first["result"] == "admitted"
    assert first["ticket"]["ticket_type"] == "flirt_party"
    again = await _scan(client, staff, ticket["code"], party.id)
    assert again["result"] == "already_admitted"
    assert again["ticket"]["event_title"] == "Flirt Party"
    assert await _stamps(db_session, guest.id, party.id) == 1

    after = (await client.get(f"{API}/ticket/", headers=guest_headers)).json()
    assert after["status"] == "admitted"
    assert after["used"] is True  # retrocompatibil
    assert after["admitted_at"] is not None
    assert after["admitted_event_title"] == "Flirt Party"

    stats = (await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(party.id)}, headers=staff)).json()
    assert stats["admitted"] == 1 and stats["flirt_party_admitted"] == 1


# --------------------------------------------------------------------------- #
# Calculul stărilor (fără DB)
# --------------------------------------------------------------------------- #
def _ev(starts_in: timedelta) -> Event:
    return Event(title="E", city="X", kind="party", starts_at=datetime.now(timezone.utc) + starts_in)


def _ord(status: str, admitted: bool) -> TicketOrder:
    return TicketOrder(
        status=status,
        admitted_at=datetime.now(timezone.utc) if admitted else None,
    )


@pytest.mark.parametrize("status_,admitted,starts_in,expected", [
    ("approved", False, timedelta(days=1), "valid"),
    ("approved", True, timedelta(hours=-1), "admitted"),
    ("approved", True, timedelta(hours=-13), "used"),
    ("approved", False, timedelta(hours=-13), "expired"),
    ("rejected", False, timedelta(days=1), "cancelled"),
    ("cancelled", False, timedelta(days=1), "cancelled"),
    ("payment_declared", False, timedelta(days=1), None),
])
def test_order_ticket_status(status_, admitted, starts_in, expected):
    assert order_ticket_status(_ord(status_, admitted), _ev(starts_in)) == expected


def test_party_ticket_status():
    now = datetime.now(timezone.utc)
    assert party_ticket_status(Ticket(used=False, admitted_at=None), None) == "valid"
    assert party_ticket_status(Ticket(used=True, admitted_at=None), None) == "used"
    assert party_ticket_status(Ticket(used=True, admitted_at=now), _ev(timedelta(hours=-1))) == "admitted"
    assert party_ticket_status(Ticket(used=True, admitted_at=now), _ev(timedelta(hours=-13))) == "used"


# --------------------------------------------------------------------------- #
# Contor + listă + autentificare
# --------------------------------------------------------------------------- #
async def test_stats_and_admissions(client, db_session):
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    _, guest2 = await _holder(client, db_session, "guest2@example.com")
    event = await _event(db_session)
    o1 = await _order(db_session, guest, event, quantity=2)
    await _order(db_session, guest2, event)
    await _order(db_session, guest2, event, status="payment_declared")

    stats = (await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(event.id)}, headers=staff)).json()
    assert stats == {"event_id": str(event.id), "sold": 3, "admitted": 0, "flirt_party_admitted": 0, "door_admitted": 0}

    await _scan(client, staff, o1.ticket_code, event.id)
    stats = (await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(event.id)}, headers=staff)).json()
    assert stats["sold"] == 3 and stats["admitted"] == 2

    rows = (await client.get(f"{ADMIN}/events/{event.id}/admissions", headers=staff)).json()
    assert len(rows) == 1
    assert rows[0]["first_name"] == "Ana"
    assert rows[0]["ticket_quantity"] == 2
    assert rows[0]["admitted_by_email"] == "staff@example.com"


async def test_scan_requires_admin(client, db_session):
    user_headers = await _register(client, "plain@example.com")
    event = await _event(db_session)
    body = {"code": "abc", "event_id": str(event.id)}
    assert (await client.post(f"{ADMIN}/tickets/scan", json=body)).status_code == 401
    assert (await client.post(f"{ADMIN}/tickets/scan", json=body, headers=user_headers)).status_code == 403
    assert (
        await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(event.id)}, headers=user_headers)
    ).status_code == 403


async def test_user_ticket_order_statuses(client, db_session):
    """`ticket_status` pe comenzile userului: valid / expired / cancelled / None."""
    headers, guest = await _holder(client, db_session)
    future = await _event(db_session, starts_in=timedelta(days=2), title="Viitor")
    past = await _event(db_session, starts_in=-timedelta(days=2), title="Trecut")
    await _order(db_session, guest, future)
    await _order(db_session, guest, past)
    await _order(db_session, guest, future, status="rejected")
    await _order(db_session, guest, future, status="awaiting_payment")

    mine = (await client.get(f"{API}/ticket-orders/mine", headers=headers)).json()
    got = sorted((o["event_title"], o["status"], o["ticket_status"]) for o in mine)
    assert got == sorted([
        ("Viitor", "approved", "valid"),
        ("Trecut", "approved", "expired"),
        ("Viitor", "rejected", "cancelled"),
        ("Viitor", "awaiting_payment", None),
    ])


# --------------------------------------------------------------------------- #
# Cod scurt (sufix) + Flirt Passport QR + intrarea cash la ușă
# --------------------------------------------------------------------------- #
async def test_typed_suffix_matches_within_event(client, db_session):
    """Codul scurt din Mini App („B094 1698") = ULTIMELE 8 caractere ale codului."""
    staff = await _make_admin(client, db_session)
    _, guest = await _holder(client, db_session)
    event = await _event(db_session)
    order = await _order(db_session, guest, event)

    short = order.ticket_code[-8:].upper()
    body = await _scan(client, staff, f"{short[:4]} {short[4:]}", event.id)
    assert body["result"] == "admitted"
    assert body["via"] == "ticket"


async def _passport_qr(client, headers) -> dict:
    resp = await client.get(f"{API}/events/passport/qr", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _door(client, headers, code: str, event_id) -> dict:
    resp = await client.post(
        f"{ADMIN}/events/{event_id}/door-admissions", json={"code": code}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_passport_qr_endpoint_is_stable(client, db_session):
    headers, guest = await _holder(client, db_session)
    first = await _passport_qr(client, headers)
    second = await _passport_qr(client, headers)
    assert first == second
    assert first["qr_payload"].startswith("FLIRTP-")
    token = first["qr_payload"].removeprefix("FLIRTP-")
    assert len(token) == 32 and int(token, 16) >= 0
    code = first["payment_code"]
    assert len(code) == 6 and code.isdigit() and code[0] != "0"
    await db_session.refresh(guest)
    assert guest.passport_token == token
    assert guest.payment_code == code
    # Protejat.
    assert (await client.get(f"{API}/events/passport/qr")).status_code in (401, 403)


async def test_scan_passport_with_paid_ticket_admits_ticket(client, db_session):
    staff = await _make_admin(client, db_session)
    headers, guest = await _holder(client, db_session)
    event = await _event(db_session)
    await _order(db_session, guest, event, quantity=2)
    qr = (await _passport_qr(client, headers))["qr_payload"]

    body = await _scan(client, staff, qr, event.id)
    assert body["result"] == "admitted"
    assert body["via"] == "passport"
    assert body["ticket"]["ticket_type"] == "event_ticket"
    assert body["ticket"]["ticket_quantity"] == 2
    assert body["ticket"]["stamps"] == 1
    assert await _stamps(db_session, guest.id, event.id) == 1

    again = await _scan(client, staff, qr, event.id)
    assert again["result"] == "already_admitted"
    assert again["via"] == "passport"

    # „Achitat cash" peste un bilet online → se întoarce biletul, fără dublă evidență.
    door = await _door(client, staff, qr, event.id)
    assert door["result"] == "already_admitted"
    assert door["ticket"]["ticket_type"] == "event_ticket"
    stats = (
        await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(event.id)}, headers=staff)
    ).json()
    assert stats["admitted"] == 2 and stats["door_admitted"] == 0


async def test_scan_passport_without_ticket_is_no_ticket(client, db_session):
    staff = await _make_admin(client, db_session)
    headers, guest = await _holder(client, db_session)
    event = await _event(db_session, title="Seara cash")
    # O cerere NEPLĂTITĂ nu contează ca bilet.
    await _order(db_session, guest, event, status="awaiting_payment")
    qr = (await _passport_qr(client, headers))["qr_payload"]

    body = await _scan(client, staff, qr.lower(), event.id)
    assert body["result"] == "no_ticket"
    assert body["via"] == "passport"
    t = body["ticket"]
    assert t["first_name"] == "Ana"
    assert t["event_title"] == "Seara cash"
    assert t["event_id"] == str(event.id)
    assert t["stamps"] == 0
    assert t["discount_percent"] == 0
    assert t["admitted_at"] is None
    assert await _stamps(db_session, guest.id, event.id) == 0


async def test_unknown_passport_not_found(client, db_session):
    staff = await _make_admin(client, db_session)
    event = await _event(db_session)
    fake = "FLIRTP-" + uuid.uuid4().hex
    assert (await _scan(client, staff, fake, event.id))["result"] == "not_found"
    assert (await _door(client, staff, fake, event.id))["result"] == "not_found"
    # Un cod de bilet nu e acceptat ca pașaport la intrarea cash.
    assert (await _door(client, staff, uuid.uuid4().hex, event.id))["result"] == "not_found"


async def test_door_admission_cash_flow(client, db_session):
    from app.models.billing import Subscription  # noqa: F401 — doar pentru claritate
    from app.models.event import EventDoorAdmission

    staff = await _make_admin(client, db_session)
    headers, guest = await _holder(client, db_session)
    event = await _event(db_session)
    qr = (await _passport_qr(client, headers))["qr_payload"]

    body = await _door(client, staff, qr, event.id)
    assert body["result"] == "admitted"
    assert body["via"] == "passport"
    t = body["ticket"]
    assert t["ticket_type"] == "door_cash"
    assert t["ticket_quantity"] == 1
    assert t["admitted_at"] is not None
    assert t["admitted_by_email"] == "staff@example.com"
    assert t["stamps"] == 1
    assert await _stamps(db_session, guest.id, event.id) == 1
    row = await db_session.scalar(select(EventDoorAdmission).where(EventDoorAdmission.user_id == guest.id))
    assert row.payment_method == "cash"
    audits = await db_session.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == ACTION_TICKET_ADMIT,
            AdminAuditLog.target_type == "event_door_admission",
        )
    )
    assert audits == 1

    # A doua apăsare / o scanare ulterioară → already_admitted, cu ora ORIGINALĂ.
    again = await _door(client, staff, qr, event.id)
    assert again["result"] == "already_admitted"
    assert again["ticket"]["ticket_type"] == "door_cash"
    assert again["ticket"]["admitted_at"] == t["admitted_at"]
    scanned = await _scan(client, staff, qr, event.id)
    assert scanned["result"] == "already_admitted"
    assert scanned["ticket"]["ticket_type"] == "door_cash"
    assert await _stamps(db_session, guest.id, event.id) == 1

    stats = (
        await client.get(f"{ADMIN}/tickets/scan-stats", params={"event_id": str(event.id)}, headers=staff)
    ).json()
    assert stats["sold"] == 0
    assert stats["admitted"] == 1
    assert stats["door_admitted"] == 1
    admissions = (await client.get(f"{ADMIN}/events/{event.id}/admissions", headers=staff)).json()
    assert len(admissions) == 1
    assert admissions[0]["ticket_type"] == "door_cash"
    assert admissions[0]["first_name"] == "Ana"
    assert admissions[0]["ticket_quantity"] == 1


async def test_door_admission_does_not_consume_discount_card(client, db_session, monkeypatch):
    """Intrarea cash emite ștampila FĂRĂ `billing.consume_event_entry`."""
    from app.services import billing

    called = []

    async def fake_consume(db, user):
        called.append(user.id)

    monkeypatch.setattr(billing, "consume_event_entry", fake_consume)
    staff = await _make_admin(client, db_session)
    headers, guest = await _holder(client, db_session)
    event = await _event(db_session)
    qr = (await _passport_qr(client, headers))["qr_payload"]
    assert (await _door(client, staff, qr, event.id))["result"] == "admitted"
    assert called == []
    assert await _stamps(db_session, guest.id, event.id) == 1


async def test_door_admission_event_over_and_404(client, db_session):
    staff = await _make_admin(client, db_session)
    headers, _ = await _holder(client, db_session)
    past = await _event(db_session, starts_in=-timedelta(days=3))
    qr = (await _passport_qr(client, headers))["qr_payload"]
    assert (await _door(client, staff, qr, past.id))["result"] == "event_over"
    resp = await client.post(
        f"{ADMIN}/events/{uuid.uuid4()}/door-admissions", json={"code": qr}, headers=staff
    )
    assert resp.status_code == 404
    # Doar admin.
    resp = await client.post(
        f"{ADMIN}/events/{past.id}/door-admissions", json={"code": qr}, headers=headers
    )
    assert resp.status_code == 403
