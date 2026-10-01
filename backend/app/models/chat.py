"""Modele pentru chat: un dialog per match + mesajele lui (TZ secț. 5)."""
import uuid

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
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
    __table_args__ = (
        # Listarea paginată a conversației + ultimul mesaj din fiecare chat
        # (`ORDER BY created_at DESC` / window function în `GET /chats`).
        # Fără el, fiecare deschidere de chat scanează toate mesajele chat-ului.
        Index("ix_messages_chat_created", "chat_id", "created_at"),
        # Numărul de necitite: `WHERE chat_id = ? AND sender_id <> ? AND
        # is_read = false` — predicatul exact al badge-ului din lista de chat-uri,
        # cel mai *polled* query al aplicației. `sender_id` nu era indexat DELOC.
        Index("ix_messages_chat_sender_unread", "chat_id", "sender_id", "is_read"),
    )

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
    # Reacția la mesaj — un emoji simplu (❤️/😂/👍); None = fără reacție (TZ 5.2).
    reaction: Mapped[str | None] = mapped_column(String(16), nullable=True)

    # Tipul mesajului: 'text' | 'image' | 'video' | 'voice'. Rândurile vechi
    # primesc 'text' prin server_default (migrare sigură pe tabel populat).
    kind: Mapped[str] = mapped_column(
        String(16), default="text", server_default="text", nullable=False
    )
    # Atașamentul media (doar pentru kind != 'text'); NULL la mesajele text.
    # URL-ul întors de storage — cheia conține un token aleator de 128 biți,
    # deci nu poate fi ghicit (storage-ul nu are URL-uri semnate).
    attachment_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Tipul MIME detectat server-side din magic bytes (nu cel declarat de client).
    attachment_mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    attachment_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Durata declarată de client (voice/video), în milisecunde.
    attachment_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Dimensiunile imaginii (doar kind='image').
    attachment_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_height: Mapped[int | None] = mapped_column(Integer, nullable=True)

    @property
    def attachment(self) -> dict | None:
        """Atașamentul ca dict (citit de `MessageOut.attachment`); None la text."""
        if not self.attachment_url:
            return None
        return {
            "url": self.attachment_url,
            "mime": self.attachment_mime or "application/octet-stream",
            "size_bytes": self.attachment_size or 0,
            "duration_ms": self.attachment_duration_ms,
            "width": self.attachment_width,
            "height": self.attachment_height,
        }
