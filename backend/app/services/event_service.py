"""Logica modulului Evenimente + Flirt Passport (TZ secț. 8).

Seed idempotent de evenimente demo, listare cu numărul de participanți,
marcaj „merg la eveniment", check-in cu ștampilă și afișarea pașaportului.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.event import Event, EventAttendance, FlirtPassportStamp
from app.models.user import User
from app.schemas.event import EventOut, EventPage, PassportStampOut
from app.services import billing
from app.services.pagination import (
    EVENTS_MAX_LIMIT,
    EVENTS_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)


# --- Seed --------------------------------------------------------------------
async def seed_events(db: AsyncSession) -> None:
    """Inserează evenimente demo dacă tabela e goală (idempotent).

    NU RULEAZĂ ÎN PRODUCȚIE. Seed-ul e apelat automat din `list_events`, deci
    până acum baza de PRODUCȚIE se umplea cu 4 evenimente FALSE („Flirt Party
    Downtown" & co.) la prima cerere `GET /events` a primului utilizator real.
    Rămâne util în dev/staging, unde nu există un flux de creare a evenimentelor.
    """
    if settings.environment == "production":
        return

    existing = await db.execute(select(func.count()).select_from(Event))
    if existing.scalar_one() > 0:
        return

    now = datetime.now(timezone.utc)
    db.add_all(
        [
            Event(
                title="Flirt Party Downtown",
                description="Petrecere FLIRT în centrul orașului.",
                starts_at=now + timedelta(days=3),
                city="Chișinău",
                venue="Club Nova",
                lat=47.0245,
                lng=28.8322,
                kind="flirt_party",
                cover_url=None,
            ),
            Event(
                title="Flirt Party Rooftop",
                description="Seară pe acoperiș cu vedere la oraș.",
                starts_at=now + timedelta(days=7),
                city="Chișinău",
                venue="Sky Bar",
                lat=47.0105,
                lng=28.8638,
                kind="flirt_party",
                cover_url=None,
            ),
            Event(
                title="Flirt Party Riverside",
                description="Întâlniri lângă lac.",
                starts_at=now + timedelta(days=10),
                city="Bălți",
                venue="Lake Lounge",
                lat=47.7615,
                lng=27.9291,
                kind="flirt_party",
                cover_url=None,
            ),
            Event(
                title="Summer Live Concert",
                description="Concert live cu artiști locali.",
                starts_at=now + timedelta(days=14),
                city="Chișinău",
                venue="Arena Chișinău",
                lat=47.0000,
                lng=28.8500,
                kind="concert",
                cover_url=None,
            ),
        ]
    )
    await db.commit()


# --- Listare / detalii -------------------------------------------------------
async def list_events(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> EventPage:
    """Evenimentele viitoare cu `attendee_count` și `i_am_going` (paginat).

    Înainte întorcea TOATE evenimentele viitoare, fără limită. Acum: paginare pe
    cursor peste `(starts_at, id)`, cele mai apropiate primele.

    Apelează seed-ul demo — care în PRODUCȚIE nu face nimic (vezi `seed_events`).
    """
    await seed_events(db)

    now = datetime.now(timezone.utc)
    limit = clamp_limit(limit, EVENTS_PAGE_LIMIT, EVENTS_MAX_LIMIT)

    stmt = select(Event).where(Event.starts_at >= now)
    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul evenimentului-ancoră, citit DB-side (vezi pagination.py).
        anchor_at = (
            select(Event.starts_at).where(Event.id == anchor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Event.starts_at > anchor_at,
                and_(Event.starts_at == anchor_at, Event.id > anchor_id),
            )
        )

    # Ordonare TOTALĂ (starts_at, id) → fără duplicate / fără evenimente sărite.
    result = await db.execute(
        stmt.order_by(Event.starts_at.asc(), Event.id.asc()).limit(limit + 1)
    )
    events = list(result.scalars().all())

    has_more = len(events) > limit
    events = events[:limit]
    if not events:
        return EventPage(items=[], next_cursor=None)

    event_ids = [e.id for e in events]
    counts = await _attendee_counts(db, event_ids)
    going = await _going_event_ids(db, user, event_ids)

    return EventPage(
        items=[_to_event_out(e, counts.get(e.id, 0), e.id in going) for e in events],
        next_cursor=encode_cursor(events[-1].id) if has_more else None,
    )


async def get_event(db: AsyncSession, user: User, event_id: uuid.UUID) -> EventOut:
    """Detaliile unui eveniment sau 404 dacă lipsește."""
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    counts = await _attendee_counts(db, [event.id])
    going = await _going_event_ids(db, user, [event.id])
    return _to_event_out(event, counts.get(event.id, 0), event.id in going)


# --- Marcaj „merg la eveniment" ---------------------------------------------
async def set_going(
    db: AsyncSession, user: User, event_id: uuid.UUID, going: bool
) -> EventOut:
    """Upsert al prezenței userului la un eveniment (TZ 8.2). 404 dacă lipsește."""
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    result = await db.execute(
        select(EventAttendance).where(
            EventAttendance.event_id == event_id,
            EventAttendance.user_id == user.id,
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        db.add(EventAttendance(event_id=event_id, user_id=user.id, going=going))
    else:
        record.going = going
    await db.commit()

    return await get_event(db, user, event_id)


# --- Check-in / Flirt Passport ----------------------------------------------
async def checkin(
    db: AsyncSession, user: User, event_id: uuid.UUID
) -> PassportStampOut:
    """Emite o ștampilă Flirt Passport (idempotent, TZ 8.4). 404 dacă lipsește."""
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    result = await db.execute(
        select(FlirtPassportStamp).where(
            FlirtPassportStamp.event_id == event_id,
            FlirtPassportStamp.user_id == user.id,
        )
    )
    stamp = result.scalar_one_or_none()
    if stamp is None:
        stamp = FlirtPassportStamp(
            event_id=event_id,
            user_id=user.id,
            stamped_at=datetime.now(timezone.utc),
        )
        db.add(stamp)
        # Prima intrare la ACEST eveniment consumă o intrare din cardul de reduceri,
        # dacă userul are unul activ cu intrări rămase. Defensiv: fără card = no-op,
        # nu blochează check-in-ul. Legat de crearea ștampilei (idempotentă) ⇒ un
        # al doilea check-in la același eveniment nu mai scade nimic.
        await billing.consume_event_entry(db, user)
        await db.commit()
        await db.refresh(stamp)

    return PassportStampOut(
        event_id=event.id,
        event_title=event.title,
        city=event.city,
        stamped_at=stamp.stamped_at,
    )


async def list_passport(db: AsyncSession, user: User) -> list[PassportStampOut]:
    """Ștampilele userului, cu titlul și orașul evenimentului pentru afișare."""
    result = await db.execute(
        select(FlirtPassportStamp, Event)
        .join(Event, Event.id == FlirtPassportStamp.event_id)
        .where(FlirtPassportStamp.user_id == user.id)
        .order_by(FlirtPassportStamp.stamped_at.desc())
    )
    return [
        PassportStampOut(
            event_id=event.id,
            event_title=event.title,
            city=event.city,
            stamped_at=stamp.stamped_at,
        )
        for stamp, event in result.all()
    ]


# --- Helperi -----------------------------------------------------------------
async def _attendee_counts(
    db: AsyncSession, event_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Numărul de participanți (going=True) per eveniment."""
    if not event_ids:
        return {}
    result = await db.execute(
        select(EventAttendance.event_id, func.count())
        .where(
            EventAttendance.event_id.in_(event_ids),
            EventAttendance.going.is_(True),
        )
        .group_by(EventAttendance.event_id)
    )
    return {event_id: count for event_id, count in result.all()}


async def _going_event_ids(
    db: AsyncSession, user: User, event_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Set-ul de evenimente la care userul curent a marcat going=True."""
    if not event_ids:
        return set()
    result = await db.execute(
        select(EventAttendance.event_id).where(
            EventAttendance.event_id.in_(event_ids),
            EventAttendance.user_id == user.id,
            EventAttendance.going.is_(True),
        )
    )
    return set(result.scalars().all())


def _to_event_out(event: Event, attendee_count: int, i_am_going: bool) -> EventOut:
    return EventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        starts_at=event.starts_at,
        city=event.city,
        venue=event.venue,
        lat=event.lat,
        lng=event.lng,
        kind=event.kind,
        cover_url=event.cover_url,
        promo_discount_percent=event.promo_discount_percent,
        promo_code=event.promo_code,
        promo_description=event.promo_description,
        ticket_price=event.ticket_price,
        ticket_currency=event.ticket_currency,
        attendee_count=attendee_count,
        i_am_going=i_am_going,
    )
