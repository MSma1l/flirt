"""Scheme Pydantic v2 pentru Testul de umor (TZ 2.7).

Vectorul de umor rezultat populează `Profile.humor_vector` (câmp JSON existent),
folosit de algoritmul de compatibilitate.
"""
from __future__ import annotations

from pydantic import BaseModel


class HumorCard(BaseModel):
    """Un card din quiz — o glumă scurtă etichetată cu un tip de umor."""

    id: str
    text: str
    type: str


class HumorAnswer(BaseModel):
    """Răspunsul userului la un card: a fost amuzant sau nu."""

    card_id: str
    funny: bool


class HumorSubmitIn(BaseModel):
    """Payload-ul de trimitere a quiz-ului complet."""

    answers: list[HumorAnswer]


class HumorProfileOut(BaseModel):
    """Vectorul de umor normalizat (pondere pe tip, sumă ≈ 1.0)."""

    vector: dict[str, float]
