"""Scheme Pydantic v2 pentru modulul Stories (TZ secț. 11)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class StoryIn(BaseModel):
    """Payload la crearea unei povești."""

    media_url: str
    caption: str | None = None


class StoryOut(BaseModel):
    """O poveste afișată."""

    id: uuid.UUID
    user_id: uuid.UUID
    media_url: str
    caption: str | None = None
    created_at: datetime
    expires_at: datetime


class UserStories(BaseModel):
    """Poveștile active ale unui user, grupate pentru afișare (nume din Profile)."""

    user_id: uuid.UUID
    name: str
    story_count: int
    stories: list[StoryOut]
