"""Scheme Pydantic v2 pentru Testul de umor (TZ 2.7).

Vectorul de umor rezultat populează `Profile.humor_vector` (câmp JSON existent),
folosit de algoritmul de compatibilitate.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, computed_field, field_validator

from app.core.validators import no_html, safe_str

# Plafon lungime pentru id-ul unui card (identificatori scurți gen "c1").
CARD_ID_MAX_LENGTH = 64
# Plafoane pentru conținutul editabil din panou.
QUESTION_TEXT_MAX_LENGTH = 500
INTRO_MAX_LENGTH = 2000
# Plafon pe numărul de răspunsuri dintr-o trimitere (testul are ≤ 50 de glume).
MAX_ANSWERS = 100


class HumorCard(BaseModel):
    """Un card din quiz — o glumă scurtă etichetată cu un tip de umor.

    Textele sunt localizate (ro, ru, en), pe tiparul `ReferenceItem` din
    `schemas/profile.py`: serverul trimite toate variantele, clientul alege
    limba. `text_uk` a rămas în contract ca `null` (interfața nu mai are
    ucraineana; clienții cad pe `text_ro`).
    """

    id: str
    text_ro: str
    text_ru: str
    text_uk: str | None = None
    text_en: str
    type: str

    @computed_field  # type: ignore[prop-decorator]
    @property
    def text(self) -> str:
        """DEPRECAT — păstrat pentru clientul deja publicat (contract aditiv).

        Mobilul curent afișează `card.text` (`mobile/app/humor.tsx`), deci câmpul
        rămâne în răspuns ca alias pe `text_ro`.
        """
        return self.text_ro


class HumorAnswer(BaseModel):
    """Răspunsul userului la un card: a fost amuzant sau nu.

    `card_id` e validat defensiv (trim, non-gol, plafon lungime, fără HTML/control
    chars) — vine de la client și e folosit ca cheie de căutare a cardului.
    """

    card_id: safe_str(CARD_ID_MAX_LENGTH)
    funny: bool


class HumorSubmitIn(BaseModel):
    """Payload-ul de trimitere a quiz-ului complet."""

    answers: list[HumorAnswer] = Field(max_length=MAX_ANSWERS)


class HumorProfileOut(BaseModel):
    """Vectorul de umor normalizat (pondere pe tip, sumă ≈ 1.0)."""

    vector: dict[str, float]


class HumorConfigOut(BaseModel):
    """`GET /humor/config` — dacă testul e activ + textul ecranului de introducere."""

    enabled: bool
    intro_ro: str
    intro_ru: str
    intro_en: str
    question_count: int


# --------------------------------------------------------------------------- #
# Panoul de admin
# --------------------------------------------------------------------------- #
class HumorSettingsIn(BaseModel):
    """Comutatorul global + textul de introducere (gol = textul implicit al aplicației)."""

    enabled: bool
    intro_ro: str = Field(default="", max_length=INTRO_MAX_LENGTH)
    intro_ru: str = Field(default="", max_length=INTRO_MAX_LENGTH)
    intro_en: str = Field(default="", max_length=INTRO_MAX_LENGTH)

    @field_validator("intro_ro", "intro_ru", "intro_en")
    @classmethod
    def _clean_intro(cls, v: str) -> str:
        # Text simplu, cu paragrafe: trim + fără HTML / caractere de control
        # (în afară de sfârșit de rând). Gol e permis.
        v = v.replace("\r\n", "\n").strip()
        if any(ord(ch) < 32 and ch not in "\n\t" for ch in v):
            raise ValueError("Textul conține caractere nepermise.")
        return no_html(v) if v else v


class HumorSettingsOut(BaseModel):
    enabled: bool
    intro_ro: str
    intro_ru: str
    intro_en: str
    active_questions: int
    min_active_questions: int
    humor_types: list[str]
    updated_at: datetime | None = None


class HumorQuestionIn(BaseModel):
    """O glumă nouă. Textele sunt obligatorii în toate cele 3 limbi."""

    humor_type: safe_str(32)
    text_ro: safe_str(QUESTION_TEXT_MAX_LENGTH)
    text_ru: safe_str(QUESTION_TEXT_MAX_LENGTH)
    text_en: safe_str(QUESTION_TEXT_MAX_LENGTH)
    active: bool = True


class HumorQuestionUpdate(BaseModel):
    """Modificare parțială; câmpurile trimise sunt validate ca la creare."""

    humor_type: safe_str(32) | None = None
    text_ro: safe_str(QUESTION_TEXT_MAX_LENGTH) | None = None
    text_ru: safe_str(QUESTION_TEXT_MAX_LENGTH) | None = None
    text_en: safe_str(QUESTION_TEXT_MAX_LENGTH) | None = None
    active: bool | None = None

    @field_validator("humor_type", "text_ro", "text_ru", "text_en", "active")
    @classmethod
    def _not_null(cls, v: object) -> object:
        # `null` explicit ar goli o coloană NOT NULL: îl refuzăm ca 422.
        if v is None:
            raise ValueError("Câmpul nu poate fi null.")
        return v


class HumorQuestionOut(BaseModel):
    id: uuid.UUID
    key: str
    humor_type: str
    text_ro: str
    text_ru: str
    text_en: str
    position: int
    active: bool
    updated_at: datetime | None = None


class HumorReorderIn(BaseModel):
    """Noua ordine: id-urile TUTUROR glumelor, fiecare o dată."""

    ids: list[uuid.UUID] = Field(max_length=200)
