"""Modelul RefreshSession — o sesiune de refresh token, cu suport pentru
rotație și detectarea reutilizării (reuse detection) prin `family_id`."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RefreshSession(Base):
    """Reprezintă un refresh token emis.

    Stocăm doar hash-ul SHA-256 al token-ului (`token_hash`), niciodată tokenul
    brut. `family_id` leagă token-urile rotite între ele pentru a detecta
    reutilizarea unui token deja consumat.
    """

    __tablename__ = "refresh_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), index=True, nullable=False
    )
    # jti unic al token-ului curent din familie.
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    # Identificatorul familiei — comun tuturor rotațiilor aceleiași sesiuni.
    family_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    # Hash SHA-256 (hex) al refresh token-ului brut.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
