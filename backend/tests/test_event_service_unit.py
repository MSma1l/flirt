"""Unit teste pentru event_service — seed, going, check-in, passport, 404."""
import uuid

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.models.user import User
from app.services import event_service as E


async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_seed_is_idempotent(db_session):
    await E.seed_events(db_session)
    await E.seed_events(db_session)  # a doua oară nu adaugă
    user = await _make_user(db_session, "e1@example.com")
    # `list_events` întoarce acum o PAGINĂ (items + next_cursor), ca `/feed`.
    page = await E.list_events(db_session, user)
    events = page.items
    # Cele 4 evenimente demo sunt viitoare → toate listate (încap într-o pagină).
    assert len(events) == 4
    assert page.next_cursor is None
    assert all(e.attendee_count == 0 for e in events)
    assert all(e.i_am_going is False for e in events)


@pytest.mark.asyncio
async def test_get_event_404(db_session):
    user = await _make_user(db_session, "e2@example.com")
    with pytest.raises(HTTPException) as exc:
        await E.get_event(db_session, user, uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_set_going_404(db_session):
    user = await _make_user(db_session, "e3@example.com")
    with pytest.raises(HTTPException) as exc:
        await E.set_going(db_session, user, uuid.uuid4(), True)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_set_going_toggle_and_count(db_session):
    user = await _make_user(db_session, "e4@example.com")
    events = (await E.list_events(db_session, user)).items
    ev = events[0]

    out = await E.set_going(db_session, user, ev.id, True)
    assert out.i_am_going is True
    assert out.attendee_count == 1

    # Re-marcaj (upsert al aceleiași linii) → going=False.
    out2 = await E.set_going(db_session, user, ev.id, False)
    assert out2.i_am_going is False
    assert out2.attendee_count == 0


@pytest.mark.asyncio
async def test_checkin_404(db_session):
    user = await _make_user(db_session, "e5@example.com")
    with pytest.raises(HTTPException) as exc:
        await E.checkin(db_session, user, uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_checkin_idempotent_and_passport(db_session):
    user = await _make_user(db_session, "e6@example.com")
    events = (await E.list_events(db_session, user)).items
    ev = events[0]

    stamp1 = await E.checkin(db_session, user, ev.id)
    stamp2 = await E.checkin(db_session, user, ev.id)
    # Idempotent: aceeași ștampilă.
    assert stamp1.stamped_at == stamp2.stamped_at
    assert stamp1.event_title == ev.title

    passport = await E.list_passport(db_session, user)
    assert len(passport) == 1
    assert passport[0].event_id == ev.id


@pytest.mark.asyncio
async def test_empty_passport(db_session):
    user = await _make_user(db_session, "e7@example.com")
    assert await E.list_passport(db_session, user) == []
