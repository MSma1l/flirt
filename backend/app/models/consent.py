"""Modelul UserConsent — evidența consimțămintelor (Legea nr. 195/2024 / GDPR art. 7(1)).

Operatorul trebuie să poată DOVEDI că persoana a consimțit: ce document, ce
versiune, când, de unde. De aceea fiecare acceptare e un rând NOU (istoric
complet, append-only), nu o actualizare peste cel vechi: o schimbare de versiune
a politicii nu are voie să șteargă dovada acceptării versiunii anterioare.

Starea curentă a unui document = cel mai recent rând pentru (user, document).
Retragerea (doar pentru consimțămintele opționale, ex. `sensitive_data`) setează
`withdrawn_at` pe acel rând — dovada acceptării rămâne, cu momentul retragerii.

La purjarea contului (`account_service.purge_user_data`) rândurile se păstrează
legate de contul anonimizat, dar IP-ul și user-agent-ul se șterg.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Tipurile de consimțământ înregistrate.
CONSENT_TERMS = "terms"
CONSENT_PRIVACY = "privacy"
CONSENT_SENSITIVE = "sensitive_data"
CONSENT_DOCUMENTS = (CONSENT_TERMS, CONSENT_PRIVACY, CONSENT_SENSITIVE)


class UserConsent(Base):
    """O acceptare a unui document legal, la o versiune anume."""

    __tablename__ = "user_consents"
    __table_args__ = (
        Index("ix_user_consents_user_document", "user_id", "document"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 'terms' | 'privacy' | 'sensitive_data'
    document: Mapped[str] = mapped_column(String(32), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    accepted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    withdrawn_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
