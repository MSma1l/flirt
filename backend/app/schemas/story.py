"""Scheme Pydantic v2 pentru modulul Stories (TZ secț. 11)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, StringConstraints

from app.core.validators import is_https_url, optional_safe_str

# Plafon lungime caption aliniat cu coloana Story.caption = String(500).
CAPTION_MAX_LENGTH = 500
# Plafon URL aliniat cu coloana Story.media_url = String(500).
MEDIA_URL_MAX_LENGTH = 500

# URL de media: obligatoriu https (anti-mixed-content / SSRF pe scheme exotice).
HttpsUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MEDIA_URL_MAX_LENGTH),
    AfterValidator(is_https_url),
]


class StoryIn(BaseModel):
    """Payload la crearea unei povești.

    `media_url` trebuie să fie un URL https valid; `caption` (opțional) e curățat
    defensiv (trim, non-gol, fără HTML/control chars, plafon lungime).
    """

    media_url: HttpsUrl
    caption: optional_safe_str(CAPTION_MAX_LENGTH) | None = None


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
