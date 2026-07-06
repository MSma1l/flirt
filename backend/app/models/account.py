"""Modele pentru contul/setările utilizatorului (TZ secț. 6).

Cinci entități: setări, favorite, black list, bilet Flirt Party și cererea de
ștergere a contului. Toate moștenesc `Base` (PK uuid + timestamps).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UserSettings(Base):
    """Setările unui user (relație 1:1 cu `users`). O linie per user."""

    __tablename__ = "user_settings"

    # Legătura 1:1 către user (unică + indexată pentru lookup rapid).
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # Tema aplicației: 'system' / 'light' / 'dark'.
    theme: Mapped[str] = mapped_column(String(16), default="system", nullable=False)
    # Raza de căutare (km) — implicit din config la creare.
    search_radius_km: Mapped[int] = mapped_column(Integer, nullable=False)
    # Dict de flag-uri notificări (match/messages/ai_hints/events/promos).
    notifications: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Ascunde profilul din feed-ul altora.
    profile_hidden: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    # Regiunea preferată (opțională).
    region: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Favorite(Base):
    """O intrare din lista de favorite: `user_id` a marcat `target_user_id`."""

    __tablename__ = "favorites"
    __table_args__ = (
        UniqueConstraint("user_id", "target_user_id", name="uq_favorite_pair"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    target_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )


class Block(Base):
    """O intrare din black list: `blocker_id` l-a blocat pe `blocked_id`."""

    __tablename__ = "blocks"
    __table_args__ = (
        UniqueConstraint("blocker_id", "blocked_id", name="uq_block_pair"),
    )

    blocker_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )


class Ticket(Base):
    """Bilet one-time pentru Flirt Party — un singur bilet per user (TZ 6)."""

    __tablename__ = "tickets"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # Codul biletului — unic la nivel global.
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AccountDeletionRequest(Base):
    """Cererea de ștergere a contului cu perioadă de grație (TZ 6)."""

    __tablename__ = "account_deletion_requests"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    # Momentul cererii și momentul de la care contul poate fi purjat.
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    purge_after: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
