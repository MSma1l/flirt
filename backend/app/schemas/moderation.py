"""Scheme Pydantic v2 pentru modulul Moderare / Raportări (TZ 5.5 + 10)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ReportIn(BaseModel):
    """Payload la crearea unei raportări."""

    reported_user_id: uuid.UUID
    category: Literal["spam", "fake", "offensive", "obscene"]
    chat_id: uuid.UUID | None = None
    note: str | None = None


class ReportOut(BaseModel):
    """O raportare întoarsă către client."""

    id: uuid.UUID
    reported_id: uuid.UUID
    category: str
    status: str
    created_at: datetime
