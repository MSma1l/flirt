"""Scheme Pydantic v2 pentru monetizare (TZ 9) + push (TZ 6.3)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.core.validators import safe_str

# Plafoane aliniate cu modelele (Subscription.plan = 32, PushDevice.token = 255,
# PushDevice.platform = 16).
PLAN_MAX_LENGTH = 32
PUSH_TOKEN_MAX_LENGTH = 255
PUSH_PLATFORM_MAX_LENGTH = 16


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
    """Payload la cumpărarea unui plan.

    `plan` e validat defensiv (trim, non-gol, plafon lungime, fără HTML/control
    chars); apartenența la catalog se verifică în serviciu (plan necunoscut → 400).
    """

    plan: safe_str(PLAN_MAX_LENGTH)


class EntitlementsOut(BaseModel):
    """Drepturi derivate din abonamentul activ (flag-uri pentru client)."""

    premium: bool
    no_ads: bool
    ai_bot: bool


class PushRegisterIn(BaseModel):
    """Payload la înregistrarea unui dispozitiv de push.

    `token` și `platform` sunt validate defensiv (trim, non-gol, plafon lungime,
    fără HTML/control chars).
    """

    token: safe_str(PUSH_TOKEN_MAX_LENGTH)
    platform: safe_str(PUSH_PLATFORM_MAX_LENGTH)
