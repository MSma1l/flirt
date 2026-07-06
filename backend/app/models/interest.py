"""Catalogul de interese (TZ 2.5) + tabelul de legătură many-to-many cu profilul."""
import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Interest(Base):
    """Un interes din catalog. Extensibil prin admin fără release (TZ 2.5)."""

    __tablename__ = "interests"

    slug: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    label_ru: Mapped[str] = mapped_column(String(120), nullable=False)
    label_ro: Mapped[str] = mapped_column(String(120), nullable=False)


class ProfileInterest(Base):
    """Legătură many-to-many între un profil și interesele alese."""

    __tablename__ = "profile_interests"
    __table_args__ = (
        UniqueConstraint("profile_id", "interest_id", name="uq_profile_interest"),
    )

    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True, nullable=False
    )
    interest_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("interests.id", ondelete="CASCADE"), index=True, nullable=False
    )
