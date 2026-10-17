"""Schemele preferințelor de notificare ale botului Telegram (`tg_notify`)."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, StrictBool, field_validator


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
