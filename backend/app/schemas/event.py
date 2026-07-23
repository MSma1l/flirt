"""Scheme Pydantic v2 pentru modulul Evenimente + Flirt Passport (TZ secț. 8)."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class EventOut(BaseModel):
    """Un eveniment afișat, cu numărul de participanți și statusul userului."""

    id: uuid.UUID
    title: str
    description: str | None = None
    starts_at: datetime
    city: str
    venue: str | None = None
    lat: float | None = None
    lng: float | None = None
    kind: str
    cover_url: str | None = None
    # Promo/reducere de marketing setată de admin (același pentru toți).
    promo_discount_percent: int | None = None
    promo_code: str | None = None
    promo_description: str | None = None
    # Preț al biletului ONLINE (transfer bancar). NULL = biletul online indisponibil.
    ticket_price: float | None = None
    ticket_currency: str | None = None
    # Câți useri au going=True + dacă userul curent merge.
    attendee_count: int
    i_am_going: bool


class EventPage(BaseModel):
    """O pagină de evenimente viitoare + cursorul spre următoarea.

    Convenția `/feed`: cursorul e expus în header-ul `X-Next-Cursor`, corpul
    rămâne o listă simplă de `EventOut` (compatibil cu clienții existenți).
    """

    items: list[EventOut] = Field(default_factory=list)
    next_cursor: str | None = None


class PassportStampOut(BaseModel):
    """O ștampilă din Flirt Passport, cu datele evenimentului pentru afișare."""

    event_id: uuid.UUID
    event_title: str
    city: str
    stamped_at: datetime


class GoingIn(BaseModel):
    """Payload pentru marcajul „merg / nu mai merg" la un eveniment."""

    going: bool
