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
# Plafon anti-DoS pe lista de genuri căutate (catalogul are 3 valori).
MAX_GENDERS = 8


class SettingsOut(BaseModel):
    """Setările curente ale userului, așa cum sunt afișate."""

    theme: str
    search_radius_km: int
    notifications: dict
    profile_hidden: bool
    region: str | None = None
    # Comutatorul funcțiilor AI. Mereu False pe un cont nou — se aprinde manual.
    ai_enabled: bool = False

    # --- Preferințe de căutare (filtre DURE în feed) --------------------------
    # Genurile căutate; listă goală = fără restricție de gen.
    interested_in: list[str] = Field(default_factory=list)
    # Intervalul de vârstă căutat — mereu valorile EFECTIVE (cu default-urile din
    # config aplicate), ca mobilul să nu reimplementeze regulile.
    age_min: int
    age_max: int


class SettingsIn(BaseModel):
    """Payload pentru actualizarea setărilor (toate câmpurile opționale).

    Câmpurile text (`theme`, `region`) sunt validate defensiv când sunt trimise:
    trim, non-gol, plafon lungime, fără HTML/caractere de control.

    Preferințele de căutare (`interested_in`, `age_min`, `age_max`,
    `search_radius_km`) sunt validate suplimentar în `account_service`
    (catalog de genuri, prag 18+, interval coerent, plafoane din config).
    """

    theme: optional_safe_str(THEME_MAX_LENGTH) | None = None
    search_radius_km: int | None = Field(default=None, ge=0)
    notifications: dict | None = None
    profile_hidden: bool | None = None
    region: optional_safe_str(REGION_MAX_LENGTH) | None = None
    # Aprinde/stinge funcțiile AI pentru userul curent. `None` = netrimis, deci
    # nu-l atingem (update parțial) — NU „stinge-l".
    ai_enabled: bool | None = None

    # Preferințe de căutare. `max_length` = anti-DoS pe listă (catalogul de
    # genuri e mic); valorile efective sunt validate în serviciu.
    interested_in: list[str] | None = Field(default=None, max_length=MAX_GENDERS)
    age_min: int | None = Field(default=None, ge=0)
    age_max: int | None = Field(default=None, ge=0)


class FavoriteOut(BaseModel):
    """Un favorit afișat, cu date de profil pentru UI."""

    target_user_id: uuid.UUID
    name: str
    age: int
    city: str
    # Pozele profilului (prima = avatarul din listă). Gol = profil fără poze.
    # Câmp ADITIV: clienții vechi îl ignoră, cei noi pot randa un card complet.
    photos: list[str] = Field(default_factory=list)


class LikeSentOut(BaseModel):
    """Un profil căruia userul curent i-a dat LIKE (swipe dreapta).

    Formă IDENTICĂ cu `FavoriteOut` intenționat: ecranul de favorite afișează
    ambele liste cu același rând, iar mobilul folosește un singur mapper.
    """

    target_user_id: uuid.UUID
    name: str
    age: int
    city: str
    photos: list[str] = Field(default_factory=list)


class LikeSentPage(BaseModel):
    """O pagină de like-uri TRIMISE + cursorul spre următoarea (convenția `/feed`)."""

    items: list[LikeSentOut] = Field(default_factory=list)
    next_cursor: str | None = None


class LikePendingOut(LikeSentOut):
    """Un like TRIMIS care încă NU a devenit match — profil „în așteptare".

    Extinde `LikeSentOut` (aceleași câmpuri de profil, același mapper pe mobil) cu
    două câmpuri în plus, specifice ecranului „În așteptare":
      - `is_super`: like-ul a fost un SUPER like → mobilul pune un badge;
      - `my_message`: mesajul pe care L-AM SCRIS EU la like (`deferred_message`).
        E mesajul MEU, deci am voie să-l văd. Mesajul rămâne ascuns de destinatar
        până la match — de aceea îl expunem DOAR aici, autorului, niciodată în
        listele altcuiva.
    """

    is_super: bool = False
    my_message: str | None = None


class LikePendingPage(BaseModel):
    """O pagină de like-uri „în așteptare" + cursorul spre următoarea (`/feed`)."""

    items: list[LikePendingOut] = Field(default_factory=list)
    next_cursor: str | None = None


class BlockOut(BaseModel):
    """O intrare din black list afișată în UI."""

    blocked_id: uuid.UUID
    name: str


class FavoritePage(BaseModel):
    """O pagină de favorite + cursorul spre următoarea (convenția `/feed`)."""

    items: list[FavoriteOut] = Field(default_factory=list)
    next_cursor: str | None = None


class BlockPage(BaseModel):
    """O pagină din black list + cursorul spre următoarea (convenția `/feed`)."""

    items: list[BlockOut] = Field(default_factory=list)
    next_cursor: str | None = None


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
