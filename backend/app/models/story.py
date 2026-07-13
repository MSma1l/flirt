"""Model Story — conținut foto/video de profil cu durată 24h (TZ secț. 11)."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Story(Base):
    """O poveste a unui user. Expiră automat la 24h (`expires_at`).

    `created_at` vine din `Base`. Vizibilitatea (match-uri + proprii) și
    filtrarea expirării se rezolvă în service.
    """

    __tablename__ = "stories"

    # Autorul poveștii; indexat pentru lookup rapid pe user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # URL-ul conținutului (foto/video) — upload-ul se face separat.
    media_url: Mapped[str] = mapped_column(String(500), nullable=False)
    # Text opțional afișat peste conținut.
    caption: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Momentul expirării (created_at + 24h); după el povestea nu mai apare.
    # Indexat: `WHERE expires_at > now()` e predicatul PRINCIPAL al modulului —
    # apare în fiecare listare (proprii + grupate). Fără index se scanează
    # întreaga tabelă, inclusiv toate poveștile expirate care nu sunt purjate.
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
