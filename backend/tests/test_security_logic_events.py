"""Securitate (logică de business): ștampila Flirt Passport cere DOVADĂ de prezență.

Înainte, `POST /events/{id}/checkin` dădea oricui o ștampilă pentru orice
eveniment (trecut, viitor) — iar ștampilele urcă treapta de fidelitate (reduceri
la bilete + invitații). Acum: admitere înregistrată de staff + eveniment în curs.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.account import Ticket
from app.models.event import Event, EventDoorAdmission, FlirtPassportStamp
from app.models.ticket_order import STATUS_APPROVED, STATUS_PENDING_PAYMENT, TicketOrder
from app.models.user import User

API = "/api/v1"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _register(client, email: str) -> tuple[dict, None]:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Passw0rd!"}
    )
    assert resp.status_code in (200, 201), resp.text
    token = resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, None


async def _user(db, email: str) -> User:
    return (await db.execute(select(User).where(User.email == email))).scalar_one()


async def _event(db, *, starts_in: timedelta) -> Event:
    event = Event(
        title="Flirt Party", starts_at=_now() + starts_in, city="Chișinău", kind="flirt_party"
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _stamps(db, user: User) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(FlirtPassportStamp).where(
                FlirtPassportStamp.user_id == user.id
            )
        )
    )


def _order(user: User, event: Event, *, status: str, admitted: bool) -> TicketOrder:
    return TicketOrder(
        user_id=user.id, event_id=event.id, price=100.0, total_amount=100.0,
        ticket_quantity=1, currency="lei", reference=f"U-{uuid.uuid4().hex[:8].upper()}",
        status=status, admitted_at=_now() if admitted else None,
    )


@pytest.mark.asyncio
async def test_checkin_without_any_proof_is_403_and_no_stamp(client, db_session):
    headers, _ = await _register(client, "noproof@example.com")
    user = await _user(db_session, "noproof@example.com")
    event = await _event(db_session, starts_in=-timedelta(hours=1))  # în desfășurare

    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)

    assert resp.status_code == 403, resp.text
    assert await _stamps(db_session, user) == 0


@pytest.mark.asyncio
async def test_checkin_with_paid_but_not_admitted_ticket_is_403(client, db_session):
    """Un bilet plătit dar NEscanat la intrare nu e dovadă de prezență."""
    headers, _ = await _register(client, "paid@example.com")
    user = await _user(db_session, "paid@example.com")
    event = await _event(db_session, starts_in=-timedelta(hours=1))
    db_session.add(_order(user, event, status=STATUS_APPROVED, admitted=False))
    await db_session.commit()

    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert resp.status_code == 403, resp.text
    assert await _stamps(db_session, user) == 0


@pytest.mark.asyncio
async def test_checkin_with_unapproved_admitted_order_is_403(client, db_session):
    headers, _ = await _register(client, "pend@example.com")
    user = await _user(db_session, "pend@example.com")
    event = await _event(db_session, starts_in=-timedelta(hours=1))
    db_session.add(_order(user, event, status=STATUS_PENDING_PAYMENT, admitted=True))
    await db_session.commit()

    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_checkin_with_admitted_ticket_at_running_event_stamps(client, db_session):
    headers, _ = await _register(client, "admitted@example.com")
    user = await _user(db_session, "admitted@example.com")
    event = await _event(db_session, starts_in=-timedelta(hours=1))
    db_session.add(_order(user, event, status=STATUS_APPROVED, admitted=True))
    await db_session.commit()

    first = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    second = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert await _stamps(db_session, user) == 1


@pytest.mark.asyncio
async def test_checkin_with_door_admission_stamps(client, db_session):
    headers, _ = await _register(client, "door@example.com")
    user = await _user(db_session, "door@example.com")
    event = await _event(db_session, starts_in=-timedelta(minutes=30))
    db_session.add(EventDoorAdmission(event_id=event.id, user_id=user.id, admitted_at=_now()))
    await db_session.commit()

    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text
    assert await _stamps(db_session, user) == 1


@pytest.mark.asyncio
async def test_checkin_with_party_ticket_used_at_this_event_stamps(client, db_session):
    headers, _ = await _register(client, "party@example.com")
    user = await _user(db_session, "party@example.com")
    event = await _event(db_session, starts_in=-timedelta(hours=1))
    other = await _event(db_session, starts_in=-timedelta(hours=1))
    db_session.add(
        Ticket(
            user_id=user.id, code=f"T-{uuid.uuid4().hex}", used=True,
            admitted_at=_now(), admitted_event_id=other.id,
        )
    )
    await db_session.commit()

    # Biletul a fost folosit la ALT eveniment: nu e dovadă pentru acesta.
    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert resp.status_code == 403, resp.text
    # La evenimentul unde a fost scanat, da.
    resp = await client.post(f"{API}/events/{other.id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "starts_in",
    [timedelta(days=7), timedelta(hours=3), -timedelta(days=3)],
    ids=["future", "before-doors-open", "past"],
)
async def test_checkin_outside_event_window_is_409(client, db_session, starts_in):
    """Chiar cu admitere înregistrată, în afara desfășurării: 409, fără ștampilă."""
    email = f"window{abs(int(starts_in.total_seconds()))}@example.com"
    headers, _ = await _register(client, email)
    user = await _user(db_session, email)
    event = await _event(db_session, starts_in=starts_in)
    db_session.add(EventDoorAdmission(event_id=event.id, user_id=user.id, admitted_at=_now()))
    await db_session.commit()

    resp = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert resp.status_code == 409, resp.text
    assert await _stamps(db_session, user) == 0


@pytest.mark.asyncio
async def test_checkin_unknown_event_is_404(client):
    headers, _ = await _register(client, "ghost@example.com")
    resp = await client.post(f"{API}/events/{uuid.uuid4()}/checkin", headers=headers)
    assert resp.status_code == 404, resp.text
