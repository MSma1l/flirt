"""Model Subscription — abonamente de monetizare (TZ 9).

Un rând per user pentru abonamentul curent. `plan` alege pachetul, `status`
urmărește ciclul de viață, iar `expires_at` dă valabilitatea (în stub: acum+30
zile). Providerul real (Stripe/App Store/Play) validează receipt-ul separat.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Subscription(Base):
    """Abonamentul unui user.

    `plan`: 'premium' | 'no_ads' | 'ai_bot' | 'all_inclusive'.
    `status`: 'active' | 'canceled' | 'expired'.
    `provider`: cine a procesat plata ('stub'|'stripe'|'app_store'|'play').
    """

    __tablename__ = "subscriptions"

    # Proprietarul abonamentului; indexat pentru lookup rapid pe user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Pachetul cumpărat (codul planului din PLANS).
    plan: Mapped[str] = mapped_column(String(32), nullable=False)
    # Starea abonamentului; implicit 'active' după cumpărare.
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    # Providerul care a procesat plata (din config la momentul cumpărării).
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Momentul expirării; None = fără expirare cunoscută.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
