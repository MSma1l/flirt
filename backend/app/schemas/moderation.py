"""Scheme Pydantic v2 pentru modulul Moderare / Raportări (TZ 5.5 + 10)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.core.validators import optional_safe_str

# Lungimea maximă a notei libere a raportorului (aliniat cu Report.note = String(500)).
NOTE_MAX_LENGTH = 500


class ReportIn(BaseModel):
    """Payload la crearea unei raportări."""

    reported_user_id: uuid.UUID
    category: Literal["spam", "fake", "offensive", "obscene"]
    chat_id: uuid.UUID | None = None
    # Notă liberă opțională: dacă e trimisă, e curățată (trim, fără HTML/control
    # chars) și plafonată la NOTE_MAX_LENGTH (prea lungă → 422).
    note: optional_safe_str(NOTE_MAX_LENGTH) | None = None


class ReportOut(BaseModel):
    """O raportare întoarsă către client."""

    id: uuid.UUID
    reported_id: uuid.UUID
    category: str
    status: str
    created_at: datetime
