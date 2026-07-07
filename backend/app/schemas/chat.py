"""Scheme Pydantic v2 pentru chat (TZ secț. 5)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ChatSummary(BaseModel):
    """O intrare din lista de dialoguri (TZ 5.1)."""

    chat_id: uuid.UUID
    other_user_id: uuid.UUID
    other_name: str
    other_age: int | None = None
    other_city: str | None = None
    last_message: str | None = None
    last_message_at: datetime | None = None
    unread_count: int = 0
    # Scorul de compatibilitate cu celălalt participant, 0–100 (TZ 5.2 / 4.6).
    compatibility: int = 0


class MessageOut(BaseModel):
    """Un mesaj afișat în lenta de conversație (TZ 5.2)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sender_id: uuid.UUID
    body: str  # deja mascat la persistare (TZ 5.5)
    was_masked: bool
    is_read: bool
    reaction: str | None = None  # emoji simplu sau None (TZ 5.2)
    created_at: datetime


class MessageIn(BaseModel):
    """Payload-ul de trimitere a unui mesaj."""

    body: str = Field(min_length=1, max_length=2000)


class ReactionIn(BaseModel):
    """Payload pentru reacția la un mesaj; None scoate reacția (TZ 5.2)."""

    reaction: str | None = Field(default=None, max_length=16)
