"""Scheme Pydantic v2 pentru chat (TZ secț. 5)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.validators import no_control_chars, no_html, safe_str

# Lungimea maximă a unui mesaj de chat (TZ 5) — anti-DoS payload.
MESSAGE_MAX_LENGTH = 2000

# Tipurile de mesaj. 'text' e implicitul — clienții vechi (aplicația nativă)
# ignoră câmpul și văd exact aceleași mesaje ca înainte.
MessageKind = Literal["text", "image", "video", "voice"]


class ChatSummary(BaseModel):
    """O intrare din lista de dialoguri (TZ 5.1)."""

    chat_id: uuid.UUID
    other_user_id: uuid.UUID
    other_name: str
    other_age: int | None = None
    other_city: str | None = None
    last_message: str | None = None
    last_message_at: datetime | None = None
    # Tipul ultimului mesaj (aditiv): la media `last_message` e legenda sau "",
    # iar clientul afișează o previzualizare după `last_message_kind`.
    last_message_kind: MessageKind | None = None
    unread_count: int = 0
    # Scorul de compatibilitate cu celălalt participant, 0–100 (TZ 5.2 / 4.6).
    compatibility: int = 0


class AttachmentOut(BaseModel):
    """Fișierul media atașat unui mesaj (poză / video / mesaj vocal)."""

    url: str
    mime: str
    size_bytes: int
    duration_ms: int | None = None
    width: int | None = None
    height: int | None = None


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
    # Câmpuri ADITIVE (compatibile cu clienții existenți): la media `body` e
    # legenda sau "", iar `attachment` descrie fișierul; la text attachment=None.
    kind: MessageKind = "text"
    attachment: AttachmentOut | None = None


class MessagePage(BaseModel):
    """O pagină de mesaje: mesajele + cursorul spre pagina mai VECHE.

    Aceeași convenție ca `FeedPage` (TZ 4): ruta expune `next_cursor` în
    header-ul `X-Next-Cursor`, iar corpul rămâne o listă simplă de `MessageOut`
    (compatibil cu clienții existenți). `next_cursor` e `None` când nu mai există
    istoric mai vechi.
    """

    items: list[MessageOut] = Field(default_factory=list)
    next_cursor: str | None = None


class MessageIn(BaseModel):
    """Payload-ul de trimitere a unui mesaj.

    `body` e validat defensiv: trim, non-gol (gol/spații → 422), plafon lungime,
    fără caractere de control și fără marcaje HTML (anti-XSS stocat).
    """

    body: safe_str(MESSAGE_MAX_LENGTH)


class ReactionIn(BaseModel):
    """Payload pentru reacția la un mesaj; None scoate reacția (TZ 5.2).

    `reaction` e sanitizat ca `body`-ul mesajului: fără caractere de control și
    fără marcaje HTML — altfel un `<img src=x onerror=...>` (≤16 car.) s-ar
    persista și s-ar servi celuilalt client (XSS stocat). Un emoji/text simplu
    trece; marcajul HTML → 422.
    """

    reaction: str | None = Field(default=None, max_length=16)

    @field_validator("reaction")
    @classmethod
    def _sanitize(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return no_html(no_control_chars(v))
