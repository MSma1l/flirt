"""Scheme Pydantic v2 pentru modulul cont/setări (TZ secț. 6)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.core.validators import optional_safe_str

# Plafoane de lungime aliniate cu coloanele din model (UserSettings.theme = 16,
# UserSettings.region = 120).
THEME_MAX_LENGTH = 16
REGION_MAX_LENGTH = 120


class SettingsOut(BaseModel):
    """Setările curente ale userului, așa cum sunt afișate."""

    theme: str
    search_radius_km: int
    notifications: dict
    profile_hidden: bool
    region: str | None = None


class SettingsIn(BaseModel):
    """Payload pentru actualizarea setărilor (toate câmpurile opționale).

    Câmpurile text (`theme`, `region`) sunt validate defensiv când sunt trimise:
    trim, non-gol, plafon lungime, fără HTML/caractere de control.
    """

    theme: optional_safe_str(THEME_MAX_LENGTH) | None = None
    search_radius_km: int | None = Field(default=None, ge=0)
    notifications: dict | None = None
    profile_hidden: bool | None = None
    region: optional_safe_str(REGION_MAX_LENGTH) | None = None


class FavoriteOut(BaseModel):
    """Un favorit afișat, cu date de profil pentru UI."""

    target_user_id: uuid.UUID
    name: str
    age: int
    city: str


class BlockOut(BaseModel):
    """O intrare din black list afișată în UI."""

    blocked_id: uuid.UUID
    name: str


class TicketOut(BaseModel):
    """Biletul Flirt Party al userului."""

    code: str
    used: bool


class AccountDeletionOut(BaseModel):
    """Confirmarea cererii de ștergere a contului."""

    requested_at: datetime
    purge_after: datetime


class TargetIn(BaseModel):
    """Payload cu userul țintă (favorite / block)."""

    target_user_id: uuid.UUID = Field(...)
