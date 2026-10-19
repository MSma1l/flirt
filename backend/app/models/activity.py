"""Modele pentru centrul de activitate: vizualizări de profil + starea „citit".

Restul evenimentelor din centru (like, super like, match) NU au tabel propriu:
se citesc direct din `likes` și `matches`, deci nu pot ieși din sincron cu ele
(un undo șterge like-ul ⇒ dispare și din activitate, fără curățenie separată).
"""
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ProfileView(Base):
    """`viewer` a văzut profilul lui `viewed` într-o anumită zi (UTC).

    DEDUPLICARE per viewer per zi, garantată de baza de date (UniqueConstraint +
    `INSERT ... ON CONFLICT DO NOTHING`), nu de cod: zece carduri văzute azi de
    același om = o singură vizualizare. Un rând = „un om, o zi".
    """

    __tablename__ = "profile_views"
    __table_args__ = (
        UniqueConstraint(
            "viewer_id", "viewed_id", "view_date", name="uq_profile_view_daily"
        ),
        # Toate citirile pornesc de la profilul VĂZUT: totalul (COUNT), ultimele
        # 7 zile (`view_date >= ?`), gruparea pe zile din lista de activitate și
        # „noi de la ultima citire" (`created_at > ?`). Un index compus pe
        # (viewed_id, view_date, created_at) le servește pe toate fără heap scan.
        Index(
            "ix_profile_views_viewed_date",
            "viewed_id",
            "view_date",
            "created_at",
        ),
    )

    viewer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    viewed_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    view_date: Mapped[date] = mapped_column(Date, nullable=False)


class ActivityReadMark(Base):
    """Până unde și-a citit userul activitatea (un rând per user).

    Un singur „semn de carte" în loc de un flag per eveniment: tot ce s-a
    întâmplat DUPĂ `last_read_at` e necitit. Numărul de necitite e astfel un
    COUNT pe index cu `created_at > ?`, nu o tabelă care crește cu fiecare like.
    """

    __tablename__ = "activity_read_marks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    last_read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
