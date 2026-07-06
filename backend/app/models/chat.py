"""Modele pentru chat: un dialog per match + mesajele lui (TZ secț. 5)."""
import uuid

from sqlalchemy import Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Chat(Base):
    """Dialogul asociat unui match. Un singur chat per match (relație 1:1).

    `user_a_id`/`user_b_id` reflectă participanții match-ului (aceeași
    normalizare min/max ca în `Match`), doar pentru interogări rapide.
    """

    __tablename__ = "chats"

    # Un chat per match: FK unic + indexat pentru lookup idempotent.
    match_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"),
        unique=True,
        index=True,
        nullable=False,
    )
    user_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )


class Message(Base):
    """Un mesaj dintr-un chat. `body` conține DEJA textul mascat (TZ 5.5)."""

    __tablename__ = "messages"

    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Corpul mesajului — deja trecut prin `mask_contacts` la persistare.
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # True dacă mascarea a modificat ceva (afișăm pastila explicativă, TZ 5.5).
    was_masked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # True după ce destinatarul a deschis conversația.
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
