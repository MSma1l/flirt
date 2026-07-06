"""Modelul User — contul de autentificare."""
from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:  # doar pentru type-hints, evită importul circular la runtime
    from app.models.profile import Profile


class User(Base):
    """Cont utilizator: email unic + parolă hash-uită (niciodată în clar)."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    # Stocăm doar hash-ul parolei (Argon2), niciodată parola brută.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    profile_completed: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )

    # Relație opțională către profil; referință prin string ca să evităm
    # importul circular la definirea mapper-ului. Condiția de join este dedusă
    # din cheia externă Profile.user_id -> users.id.
    profile: Mapped["Profile | None"] = relationship(
        "Profile",
        uselist=False,
        lazy="selectin",
        viewonly=True,
    )
