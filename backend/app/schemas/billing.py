"""Scheme Pydantic v2 pentru monetizare (TZ 9) + push (TZ 6.3)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class PlanOut(BaseModel):
    """Un plan din catalog (public)."""

    code: str
    title: str
    price_eur: float
    features: list[str]


class SubscriptionOut(BaseModel):
    """Abonamentul curent al userului."""

    plan: str
    status: str
    expires_at: datetime | None = None


class PurchaseIn(BaseModel):
    """Payload la cumpărarea unui plan."""

    plan: str


class EntitlementsOut(BaseModel):
    """Drepturi derivate din abonamentul activ (flag-uri pentru client)."""

    premium: bool
    no_ads: bool
    ai_bot: bool


class PushRegisterIn(BaseModel):
    """Payload la înregistrarea unui dispozitiv de push."""

    token: str
    platform: str
