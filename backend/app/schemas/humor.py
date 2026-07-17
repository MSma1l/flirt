"""Scheme Pydantic v2 pentru Testul de umor (TZ 2.7).

Vectorul de umor rezultat populează `Profile.humor_vector` (câmp JSON existent),
folosit de algoritmul de compatibilitate.
"""
from __future__ import annotations

from pydantic import BaseModel, computed_field

from app.core.validators import safe_str

# Plafon lungime pentru id-ul unui card (identificatori scurți gen "c1").
CARD_ID_MAX_LENGTH = 64


class HumorCard(BaseModel):
    """Un card din quiz — o glumă scurtă etichetată cu un tip de umor.

    Textele sunt localizate în cele 4 limbi ale aplicației (ro, ru, uk, en), pe
    tiparul `ReferenceItem` din `schemas/profile.py`: serverul trimite toate
    variantele, clientul alege limba. Zero hardcodare de limbă în logică.
    """

    id: str
    text_ro: str
    text_ru: str
    text_uk: str
    text_en: str
    type: str

    @computed_field  # type: ignore[prop-decorator]
    @property
    def text(self) -> str:
        """DEPRECAT — păstrat pentru clientul deja publicat (contract aditiv).

        Mobilul curent afișează `card.text` (`mobile/app/humor.tsx`), deci câmpul
        rămâne în răspuns ca alias pe `text_ro` (UI-ul e azi în română, la fel ca
        `anketaApi` care alege `label_ro`). Clienții noi citesc `text_<limbă>`.
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

    answers: list[HumorAnswer]


class HumorProfileOut(BaseModel):
    """Vectorul de umor normalizat (pondere pe tip, sumă ≈ 1.0)."""

    vector: dict[str, float]
