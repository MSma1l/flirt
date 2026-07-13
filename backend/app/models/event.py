"""Modele pentru Evenimente + Flirt Passport (TZ secț. 8).

Trei entități: evenimentul propriu-zis, prezența declarată a userului
(„Iiду на мероприятие") și ștampila Flirt Passport primită după check-in.
Toate moștenesc `Base` (PK uuid + timestamps).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Event(Base):
    """Un eveniment/Live Event afișat pe hartă și în lista de evenimente."""

    __tablename__ = "events"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Momentul de start (cu timezone) — folosit pentru filtrarea „viitor".
    # Indexat: `WHERE starts_at >= now() ORDER BY starts_at` e query-ul listării
    # (și cheia de paginare); fără index, orice listare sortează întreaga tabelă.
    starts_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    venue: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Coordonate opționale pentru harta Live Events (TZ 8.3).
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Tipul evenimentului: 'flirt_party' | 'concert' | 'other'.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)


class EventAttendance(Base):
    """Marcajul „merg la eveniment" al unui user (TZ 8.2). Unic per (event, user)."""

    __tablename__ = "event_attendances"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_attendance_pair"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    going: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FlirtPassportStamp(Base):
    """Ștampilă Flirt Passport după vizită confirmată (TZ 8.4). Unică per pereche."""

    __tablename__ = "flirt_passport_stamps"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_stamp_pair"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Momentul emiterii ștampilei (check-in confirmat).
    stamped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
