"""Scheme Pydantic v2 pentru modulul Stories (TZ secț. 11)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, StringConstraints

from app.core.validators import is_https_url, optional_safe_str, safe_str
from app.schemas.chat import MessageOut

# Tipul de media al unei povești: imagine sau video (TZ secț. 11).
MediaType = Literal["image", "video"]

# Plafon lungime caption aliniat cu coloana Story.caption = String(500).
CAPTION_MAX_LENGTH = 500
# Plafon URL aliniat cu coloana Story.media_url = String(500).
MEDIA_URL_MAX_LENGTH = 500
# Plafon pentru răspunsul la un story. Mai mic decât MESSAGE_MAX_LENGTH (2000):
# răspunsul se livrează ca mesaj de chat PREFIXAT cu contextul poveștii, iar
# suma (prefix + text) trebuie să rămână sub limita mesajului de chat.
STORY_REPLY_MAX_LENGTH = 500

# URL de media: obligatoriu https (anti-mixed-content / SSRF pe scheme exotice).
HttpsUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=MEDIA_URL_MAX_LENGTH),
    AfterValidator(is_https_url),
]


class StoryIn(BaseModel):
    """Payload la crearea unei povești.

    `media_url` trebuie să fie un URL https valid (întors de upload-ul de media);
    `media_type` spune vizualizatorului dacă e imagine sau video; `caption`
    (opțional) e curățat defensiv (trim, non-gol, fără HTML/control chars, plafon).
    """

    media_url: HttpsUrl
    media_type: MediaType = "image"
    caption: optional_safe_str(CAPTION_MAX_LENGTH) | None = None


class StoryOut(BaseModel):
    """O poveste afișată."""

    id: uuid.UUID
    user_id: uuid.UUID
    media_url: str
    media_type: str
    caption: str | None = None
    created_at: datetime
    expires_at: datetime


class StoryMediaOut(BaseModel):
    """Rezultatul upload-ului de media pentru story: URL-ul salvat + tipul detectat.

    Clientul folosește apoi aceste valori în POST /stories/ (`media_url` + `media_type`).
    """

    media_url: str
    media_type: MediaType


class StoryReplyIn(BaseModel):
    """Payload la răspunsul dat unei povești (text liber sau un emoji-reacție).

    `body` e validat ca orice text de la user: trim, non-gol, plafon lungime,
    fără caractere de control și fără marcaje HTML (anti-XSS stocat) — un emoji
    trece, `<script>` → 422.
    """

    body: safe_str(STORY_REPLY_MAX_LENGTH)


class StoryReplyOut(BaseModel):
    """Rezultatul răspunsului la o poveste.

    Răspunsul NU e un sistem paralel de mesagerie: e un mesaj obișnuit în chatul
    match-ului (poveștile se văd doar între match-uri, deci chatul există deja).
    Întoarcem și `chat_id`, ca aplicația să poată deschide direct conversația.
    """

    chat_id: uuid.UUID
    message: MessageOut


class UserStories(BaseModel):
    """Poveștile active ale unui user, grupate pentru afișare (nume din Profile)."""

    user_id: uuid.UUID
    name: str
    story_count: int
    stories: list[StoryOut]


class StoryPage(BaseModel):
    """O pagină de povești proprii (`/stories/mine`) + cursorul spre următoarea.

    Convenția `/feed`: cursorul e expus în header-ul `X-Next-Cursor`, corpul
    rămâne o listă simplă (compatibil cu clienții existenți).
    """

    items: list[StoryOut] = Field(default_factory=list)
    next_cursor: str | None = None


class UserStoriesPage(BaseModel):
    """O pagină de GRUPURI de povești (`/stories/`) + cursorul spre următoarea.

    Paginarea e la nivel de USER (un grup nu se rupe între pagini), deci un user
    nu poate apărea în două pagini.
    """

    items: list[UserStories] = Field(default_factory=list)
    next_cursor: str | None = None
