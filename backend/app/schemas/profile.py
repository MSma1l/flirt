"""Scheme Pydantic v2 pentru anketă/profil."""
from datetime import date
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.config import settings
from app.core.validators import is_https_url, optional_safe_str, safe_str

# Limite anti-DoS pe listele scurte (bounded input). Nu sunt reguli de business.
_MAX_LIST_ITEMS = 50
# Plafon pe lista de genuri căutate (catalogul are 3 valori).
_MAX_GENDERS = 8


class AnketaIn(BaseModel):
    """Datele editabile ale anketei, trimise de mobil la PUT /profiles/me."""

    # Text sigur: trim, non-gol, plafon lungime, fără control chars / HTML (anti-XSS).
    name: safe_str(120)
    birth_date: date
    gender: str  # validat în service față de catalogul de genuri
    height_cm: int = Field(gt=0, lt=300)
    city: safe_str(120)
    street: optional_safe_str(200) | None = None
    nationality: optional_safe_str(120) | None = None
    languages: list[str] = Field(default_factory=list, max_length=_MAX_LIST_ITEMS)
    # ≤ about_max_length (TZ 2.4) → 422 automat; sursa unică = settings; anti-XSS.
    about: optional_safe_str(settings.about_max_length) | None = None
    dating_statuses: list[str] = Field(
        default_factory=list, max_length=_MAX_LIST_ITEMS
    )
    interests: list[str] = Field(
        default_factory=list, max_length=_MAX_LIST_ITEMS
    )  # slug-uri
    # ≤ max_photos (din settings) → 422; fiecare URL validat mai jos.
    photos: list[str] = Field(default_factory=list, max_length=settings.max_photos)

    # --- Preferințe de căutare (TZ 4) ----------------------------------------
    # Culese în anketă, dar PERSISTATE în `UserSettings` (aceeași sursă ca
    # `PUT /settings`) — vezi `account_service.set_search_preferences`.
    # Toate opționale: `None` = nu le atinge (păstrează ce era / default-urile).
    # Listă goală pe `interested_in` = fără restricție de gen.
    interested_in: list[str] | None = Field(default=None, max_length=_MAX_GENDERS)
    age_min: int | None = Field(default=None, ge=0)
    age_max: int | None = Field(default=None, ge=0)

    @field_validator("photos")
    @classmethod
    def _validate_photo_urls(cls, v: list[str]) -> list[str]:
        """Fiecare URL de poză: doar https + domeniu din allowlist-ul storage."""
        from app.services.storage import allowed_hosts  # import lazy (anti-ciclu)

        hosts = allowed_hosts()
        for url in v:
            is_https_url(url)  # ridică ValueError → 422 dacă nu e https
            if urlparse(url).netloc not in hosts:
                raise ValueError("URL de poză în afara domeniului permis.")
        return v


class ProfileOut(BaseModel):
    """Reprezentarea completă a profilului întoarsă către client."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    birth_date: date
    age: int  # calculat din birth_date
    gender: str
    height_cm: int
    city: str
    street: str | None = None
    nationality: str | None = None
    languages: list[str] = Field(default_factory=list)
    about: str | None = None
    dating_statuses: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)  # slug-uri
    photos: list[str] = Field(default_factory=list)
    humor_vector: dict | None = None
    completed: bool = False
    verified: bool = False  # verificare facială reușită (TZ 2.2)

    # Preferințele de căutare EFECTIVE (din `UserSettings`, cu default-urile din
    # config aplicate) — ca mobilul să reafișeze anketa completă dintr-un GET.
    interested_in: list[str] = Field(default_factory=list)
    age_min: int | None = None
    age_max: int | None = None


class FaceVerifyIn(BaseModel):
    """Body opțional pentru verificarea facială în modul stub (fără fișier)."""

    selfie_url: str | None = Field(default=None, max_length=1000)


class FaceVerifyOut(BaseModel):
    """Rezultatul verificării faciale: dacă a trecut + scorul de similaritate."""

    verified: bool
    similarity: float


class PhotoUrlIn(BaseModel):
    """URL-ul unei poze — folosit la add (mod stub) și delete."""

    url: str = Field(min_length=1, max_length=1000)


class PhotoOrderIn(BaseModel):
    """Noua ordine a pozelor — trebuie să conțină exact aceleași URL-uri."""

    urls: list[str] = Field(default_factory=list)


class ReferenceItem(BaseModel):
    """Opțiune de referință cu valoare + etichete localizate în cele 4 limbi.

    `label_ru`/`label_ro` rămân pentru clientul deja publicat (contract aditiv);
    `label_uk`/`label_en` sunt câmpurile noi. Aplicația e în 4 limbi: ro, ru, uk, en.
    """

    value: str
    label_ru: str
    label_ro: str
    label_uk: str
    label_en: str


class InterestItem(BaseModel):
    """Interes din catalog (slug + etichete în cele 4 limbi)."""

    slug: str
    label_ru: str
    label_ro: str
    label_uk: str
    label_en: str


class ReferenceOut(BaseModel):
    """Toate opțiunile de referință — ca mobilul să nu hardcodeze nimic."""

    genders: list[ReferenceItem] = Field(default_factory=list)
    dating_statuses: list[ReferenceItem] = Field(default_factory=list)
    languages: list[ReferenceItem] = Field(default_factory=list)
    interests: list[InterestItem] = Field(default_factory=list)
