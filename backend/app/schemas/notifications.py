"""Schemele notificărilor: preferințele botului Telegram (`tg_notify`) și
centrul de activitate din aplicație (`activity_service`)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator


class TelegramNotificationsOut(BaseModel):
    """Ce notificări îi trimite botul userului (toate pornite implicit)."""

    messages: bool
    likes: bool
    stories: bool
    matches: bool


class TelegramNotificationsIn(BaseModel):
    """Update PARȚIAL: doar cheile trimise se schimbă.

    Strict: o cheie necunoscută (`extra="forbid"`), un non-boolean (`"true"`, `1`)
    sau un `null` explicit → 422. Un corp gol `{}` e valid și nu schimbă nimic.
    """

    model_config = ConfigDict(extra="forbid")

    messages: StrictBool | None = None
    likes: StrictBool | None = None
    stories: StrictBool | None = None
    matches: StrictBool | None = None

    @field_validator("*", mode="before")
    @classmethod
    def _no_null(cls, value: Any) -> Any:
        # Default-urile nu trec prin validatori → `None` aici e DOAR un `null`
        # trimis explicit, care nu înseamnă nici „pornit", nici „oprit".
        if value is None:
            raise ValueError("valoarea trebuie să fie true sau false")
        return value

    def changes(self) -> dict[str, bool]:
        return self.model_dump(exclude_unset=True)


# --- Centrul de activitate ---------------------------------------------------
class ActivityStats(BaseModel):
    """Contoarele profilului. Dislike-urile apar DOAR aici, ca număr."""

    views_total: int
    views_last_7_days: int
    likes: int
    super_likes: int
    dislikes: int
    matches: int


class ActivityActor(BaseModel):
    """Cine a produs evenimentul (like / super like / match)."""

    user_id: uuid.UUID
    name: str
    age: int
    photo: str | None = None


class ActivityItem(BaseModel):
    """Un rând din cronologie.

    `kind = "views"` e AGREGAT pe o zi: are `count` (câți oameni), fără `actor`.
    `chat_id` vine doar la `match`, ca rândul să deschidă direct conversația.
    """

    id: str
    kind: Literal["match", "like", "super_like", "views"]
    occurred_at: datetime
    is_read: bool
    actor: ActivityActor | None = None
    count: int | None = None
    chat_id: uuid.UUID | None = None


class ActivityPage(BaseModel):
    """O pagină din centru. `stats` vine doar pe prima pagină (fără cursor)."""

    stats: ActivityStats | None = None
    items: list[ActivityItem] = Field(default_factory=list)
    next_cursor: str | None = None
    unread: int = 0


class ActivityUnreadOut(BaseModel):
    """Doar numărul pentru badge — răspunsul ieftin al poll-ului."""

    unread: int


class ActivityReadIn(BaseModel):
    """Marcare citit. `up_to` = cel mai nou element afișat (implicit: acum)."""

    model_config = ConfigDict(extra="forbid")

    up_to: datetime | None = None
