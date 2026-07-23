"""Scheme Pydantic v2 pentru sistemul de reclame (Ads).

CONTRACT (consumat de panoul de admin ȘI de aplicația mobilă):
  * Admin CRUD    → AdIn / AdOut / AdUpdate
  * Admin settings→ AdSettingsIn / AdSettingsOut
  * Public        → AdConfigOut ( /ads/config ), AdNextOut ( /ads/next )

Ca peste tot în `schemas/`, ieșirile enumeră EXPLICIT câmpurile expuse (fără
`from_attributes` peste modelul ORM întreg), iar intrările de text trec prin
validatorii defensivi (`safe_str` / `optional_safe_str`: trim, non-gol, plafon,
fără control chars / HTML).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.core.validators import optional_safe_str, safe_str

# Plafoane aliniate cu coloanele din `models/ad.py`.
AD_TITLE_MAX_LENGTH = 200
AD_URL_MAX_LENGTH = 500
# Un creativ nu poate depăși o oră (protecție anti-date aberante), min 1s.
DURATION_MAX_SECONDS = 3600
# Ponderea maximă de rotație — suficient de mare pentru orice raport rezonabil.
WEIGHT_MAX = 1000
# Plafoane pentru parametrii globali (anti-valori aberante din panou).
SWIPES_MAX = 1000
MAX_VIDEO_SECONDS_CAP = 300
# Intervalul plauzibil de vârstă pentru targetare (minim legal 18, plafon 120).
TARGET_AGE_MIN = 18
TARGET_AGE_MAX = 120
# Genurile acceptate pentru targetare (NULL = oricine, validat separat).
TargetGender = Literal["male", "female"]


def _validate_age_window(age_min: int | None, age_max: int | None) -> None:
    """Fereastra de vârstă trebuie să fie coerentă: min <= max când ambele sunt date."""
    if age_min is not None and age_max is not None and age_min > age_max:
        raise ValueError("target_age_min nu poate depăși target_age_max.")


# --- Admin: CRUD reclame ------------------------------------------------------
class AdIn(BaseModel):
    """Payload la CREAREA unei reclame (`POST /admin/ads`).

    Cel puțin una dintre `video_url` / `image_url` are sens să fie prezentă, dar
    nu forțăm asta la nivel de schemă — panoul poate salva un draft cu titlul
    întâi. `duration_seconds` e obligatoriu (lungimea reală a creativului).
    """

    title: safe_str(AD_TITLE_MAX_LENGTH)
    video_url: optional_safe_str(AD_URL_MAX_LENGTH) | None = None
    image_url: optional_safe_str(AD_URL_MAX_LENGTH) | None = None
    duration_seconds: int = Field(ge=1, le=DURATION_MAX_SECONDS)
    active: bool = True
    weight: int = Field(default=1, ge=1, le=WEIGHT_MAX)

    # Targetare (opțională; NULL = fără restricție).
    target_gender: TargetGender | None = None
    target_age_min: int | None = Field(default=None, ge=TARGET_AGE_MIN, le=TARGET_AGE_MAX)
    target_age_max: int | None = Field(default=None, ge=TARGET_AGE_MIN, le=TARGET_AGE_MAX)
    # Programare (opțională; NULL = fără limită pe acea margine).
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @model_validator(mode="after")
    def _check_age_window(self) -> "AdIn":
        _validate_age_window(self.target_age_min, self.target_age_max)
        return self


class AdUpdate(BaseModel):
    """Payload la EDITAREA unei reclame — actualizare PARȚIALĂ (`PATCH`).

    Toate câmpurile sunt opționale; se scriu doar cele trimise efectiv
    (`model_dump(exclude_unset=True)`), ca un PATCH cu un singur câmp să nu
    reseteze restul. Payload gol → 422.
    """

    title: safe_str(AD_TITLE_MAX_LENGTH) | None = None
    video_url: optional_safe_str(AD_URL_MAX_LENGTH) | None = None
    image_url: optional_safe_str(AD_URL_MAX_LENGTH) | None = None
    duration_seconds: int | None = Field(default=None, ge=1, le=DURATION_MAX_SECONDS)
    active: bool | None = None
    weight: int | None = Field(default=None, ge=1, le=WEIGHT_MAX)

    # Targetare + programare (opționale; trimise doar câmpurile de schimbat).
    # NOTĂ: fiind PATCH pe `exclude_unset`, un câmp ABSENT rămâne neatins; pentru
    # a ȘTERGE o restricție existentă se trimite explicit `null`.
    target_gender: TargetGender | None = None
    target_age_min: int | None = Field(default=None, ge=TARGET_AGE_MIN, le=TARGET_AGE_MAX)
    target_age_max: int | None = Field(default=None, ge=TARGET_AGE_MIN, le=TARGET_AGE_MAX)
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    @model_validator(mode="after")
    def _check_age_window(self) -> "AdUpdate":
        _validate_age_window(self.target_age_min, self.target_age_max)
        return self


class AdOut(BaseModel):
    """O reclamă completă, așa cum o vede panoul de admin."""

    id: int
    title: str
    video_url: str | None = None
    image_url: str | None = None
    duration_seconds: int
    active: bool
    weight: int
    target_gender: str | None = None
    target_age_min: int | None = None
    target_age_max: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    impressions: int
    clicks: int
    created_at: datetime
    updated_at: datetime


# --- Admin: setări globale ----------------------------------------------------
class AdSettingsIn(BaseModel):
    """Payload la actualizarea setărilor globale (`PUT /admin/ads/settings`)."""

    swipes_before_ad: int = Field(ge=1, le=SWIPES_MAX)
    max_video_seconds: int = Field(ge=1, le=MAX_VIDEO_SECONDS_CAP)
    enabled: bool


class AdSettingsOut(BaseModel):
    """Setările globale ale sistemului de reclame."""

    swipes_before_ad: int
    max_video_seconds: int
    enabled: bool
    updated_at: datetime


# --- Public -------------------------------------------------------------------
class AdConfigOut(BaseModel):
    """`GET /ads/config` — de ce are nevoie clientul ca să știe CÂND să ceară o reclamă."""

    enabled: bool
    swipes_before_ad: int
    max_video_seconds: int


class AdNextOut(BaseModel):
    """`GET /ads/next` — creativul de afișat acum.

    `duration_seconds` e deja PLAFONAT la `max_video_seconds` (clientul primește
    direct durata pe care trebuie să o redea, fără să recalculeze).
    """

    id: int
    title: str
    video_url: str | None = None
    image_url: str | None = None
    duration_seconds: int
