"""Modelul User — contul de autentificare."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:  # doar pentru type-hints, evită importul circular la runtime
    from app.models.profile import Profile


# Rolurile recunoscute. Câmp TEXT (nu boolean `is_admin`) tocmai ca adăugarea
# unui rol nou (ex. 'moderator', 'support') să fie o migrație de date, nu o
# rescriere a modelului. ATENȚIE: astăzi implementăm DOAR 'user' vs 'admin' —
# un RBAC complet (permisiuni granulare) se face mai târziu, dacă e nevoie.
ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLES = (ROLE_USER, ROLE_ADMIN)


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

    # Rolul contului: 'user' (implicit) | 'admin'. Indexat: panoul de admin
    # listează administratorii, iar `require_admin` îl citește la fiecare cerere.
    # NU e expus în niciun API public — doar în /api/v1/admin/*.
    role: Mapped[str] = mapped_column(
        String(16), default=ROLE_USER, server_default=ROLE_USER,
        nullable=False, index=True,
    )

    # Ban aplicat de moderare. NULL = cont în regulă. Când e setat:
    #   * login-ul e refuzat (auth_service),
    #   * orice token existent devine inutilizabil (`get_current_user` → 403),
    #   * profilul dispare din feed (feed_service filtrează pe `banned_at IS NULL`).
    # Indexat: e un predicat de filtrare în feed și în listările de admin.
    banned_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    # Motivul banului (text liber al moderatorului, validat/curățat de schemă).
    ban_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)

    @property
    def is_admin(self) -> bool:
        """Helper de citire — sursa de adevăr rămâne coloana `role`."""
        return self.role == ROLE_ADMIN

    @property
    def is_banned(self) -> bool:
        return self.banned_at is not None

    # Ultima activitate reală a contului (cerere autentificată). Feed-ul o
    # folosește ca semnal de calitate: conturile abandonate NU mai sunt promovate
    # la egalitate cu cele active (retrieval ordonat pe recență + filtru de
    # inactivitate din config). Scrisă rar (prag `last_active_touch_minutes`),
    # deci nu adaugă un UPDATE la fiecare request.
    # NULL = cont vechi/nefolosit încă → tratat ca ACTIV (nu ascundem retroactiv).
    last_active_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
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
