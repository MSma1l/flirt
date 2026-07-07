"""Model Report — raportări de utilizatori pentru moderare (TZ 5.5 + 10)."""
from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Report(Base):
    """O raportare: `reporter_id` îl reclamă pe `reported_id` cu un motiv.

    Unicitate pe (reporter, reported, category) — un singur raport per motiv,
    per pereche, ca să nu se dubleze aceeași reclamație.
    """

    __tablename__ = "reports"
    __table_args__ = (
        UniqueConstraint(
            "reporter_id", "reported_id", "category", name="uq_report_triplet"
        ),
    )

    # Cine raportează (indexat pentru lookup rapid).
    reporter_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Cine este raportat (indexat pentru numărarea reclamațiilor pe user).
    reported_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Motivul: 'spam' | 'fake' | 'offensive' | 'obscene'.
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    # Chat-ul din care s-a raportat (opțional, TZ 5.5). UUID fără FK strict.
    chat_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    # Notă liberă opțională a raportorului.
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Starea raportului: 'open' | 'auto_banned' | 'reviewed'.
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
