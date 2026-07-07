"""Scheme Pydantic v2 pentru feed-ul de swipe și match-uri (TZ secț. 4)."""
from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field


class FeedCard(BaseModel):
    """O carte din feed-ul de swipe (TZ 4.1–4.2)."""

    user_id: uuid.UUID
    name: str
    age: int
    gender: str
    city: str
    distance_km: int | None = None  # None până la geocoding real
    about: str | None = None
    top_interests: list[str] = Field(default_factory=list)  # max 3 slug-uri
    languages: list[str] = Field(default_factory=list)
    compatibility: int  # 0–100 (bejul cu procentul, TZ 4.2)
    photos: list[str] = Field(default_factory=list)


class SwipeIn(BaseModel):
    """Payload-ul unui swipe (TZ 4.4)."""

    target_user_id: uuid.UUID
    action: Literal["like", "dislike"]


class SwipeResult(BaseModel):
    """Rezultatul unui swipe: dacă a produs match (TZ 4.7)."""

    matched: bool
    match_id: uuid.UUID | None = None
    # Chat-ul creat pentru match (None când swipe-ul nu produce match).
    chat_id: uuid.UUID | None = None


class MatchOut(BaseModel):
    """Un match afișat în lista de match-uri (TZ 4.7)."""

    match_id: uuid.UUID
    user_id: uuid.UUID
    name: str
    age: int
    city: str
    compatibility: int
