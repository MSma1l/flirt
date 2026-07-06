"""Modele pentru swipe: like-uri și match-uri (TZ secț. 4)."""
import uuid

from sqlalchemy import Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Like(Base):
    """Un swipe: userul `from` a dat like/dislike userului `to` (TZ 4.4)."""

    __tablename__ = "likes"
    __table_args__ = (
        # Un singur swipe per pereche direcțională (upsert la re-swipe).
        UniqueConstraint("from_user_id", "to_user_id", name="uq_like_pair"),
    )

    from_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # True = like (swipe dreapta), False = dislike (swipe stânga).
    is_like: Mapped[bool] = mapped_column(Boolean, nullable=False)


class Match(Base):
    """Match reciproc între doi useri (TZ 4.7).

    Perechea e stocată normalizat: `user_a_id` conține mereu UUID-ul mai mic
    (comparat ca string), `user_b_id` pe cel mai mare. Astfel un match A-B și
    unul B-A produc aceeași linie, iar UniqueConstraint previne duplicatele.
    """

    __tablename__ = "matches"
    __table_args__ = (
        UniqueConstraint("user_a_id", "user_b_id", name="uq_match_pair"),
    )

    user_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
