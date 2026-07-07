"""Scheme Pydantic v2 pentru anketă/profil."""
from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import settings


class AnketaIn(BaseModel):
    """Datele editabile ale anketei, trimise de mobil la PUT /profiles/me."""

    name: str = Field(min_length=1, max_length=120)
    birth_date: date
    gender: str  # validat în service față de catalogul de genuri
    height_cm: int = Field(gt=0, lt=300)
    city: str = Field(min_length=1, max_length=120)
    street: str | None = Field(default=None, max_length=200)
    nationality: str | None = Field(default=None, max_length=120)
    languages: list[str] = Field(default_factory=list)
    # ≤ about_max_length (TZ 2.4) → 422 automat; sursa unică = settings
    about: str | None = Field(default=None, max_length=settings.about_max_length)
    dating_statuses: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)  # slug-uri
    photos: list[str] = Field(default_factory=list)


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


class PhotoUrlIn(BaseModel):
    """URL-ul unei poze — folosit la add (mod stub) și delete."""

    url: str = Field(min_length=1, max_length=1000)


class PhotoOrderIn(BaseModel):
    """Noua ordine a pozelor — trebuie să conțină exact aceleași URL-uri."""

    urls: list[str] = Field(default_factory=list)


class ReferenceItem(BaseModel):
    """Opțiune de referință cu valoare + etichete localizate."""

    value: str
    label_ru: str
    label_ro: str


class InterestItem(BaseModel):
    """Interes din catalog (slug + etichete)."""

    slug: str
    label_ru: str
    label_ro: str


class ReferenceOut(BaseModel):
    """Toate opțiunile de referință — ca mobilul să nu hardcodeze nimic."""

    genders: list[ReferenceItem] = Field(default_factory=list)
    dating_statuses: list[ReferenceItem] = Field(default_factory=list)
    languages: list[ReferenceItem] = Field(default_factory=list)
    interests: list[InterestItem] = Field(default_factory=list)
