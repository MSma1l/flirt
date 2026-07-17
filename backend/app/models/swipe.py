"""Modele pentru swipe: like-uri și match-uri (TZ secț. 4)."""
import uuid

from sqlalchemy import Boolean, ForeignKey, Index, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Like(Base):
    """Un swipe: userul `from` a dat like/dislike userului `to` (TZ 4.4)."""

    __tablename__ = "likes"
    __table_args__ = (
        # Un singur swipe per pereche direcțională (upsert la re-swipe).
        UniqueConstraint("from_user_id", "to_user_id", name="uq_like_pair"),
        # Index compus pentru limita zilnică de swipe-uri
        # (`WHERE from_user_id = ? AND created_at >= ?`) și pentru `undo`
        # (`ORDER BY created_at DESC`) — fără el se scanează toate like-urile
        # userului la fiecare swipe.
        Index("ix_likes_from_user_created", "from_user_id", "created_at"),
    )

    from_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    to_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # True = like (swipe dreapta), False = dislike (swipe stânga).
    is_like: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Super like (swipe sus): un FLAG peste like, nu o stare separată — un super
    # like are mereu `is_like=True`. DE CE flag și nu o valoare nouă în `is_like`:
    # toată logica de match, feed (`NOT EXISTS` pe swipe-uiți) și undo
    # interoghează `is_like` și trebuie să continue să vadă un like obișnuit,
    # fără nicio modificare. `server_default` face coloana non-null pentru
    # like-urile deja existente, fără un pas separat de backfill.
    is_super: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # Mesaj atașat la like, livrat abia la match reciproc (TZ 4.7). Nullable.
    deferred_message: Mapped[str | None] = mapped_column(Text, nullable=True)


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
