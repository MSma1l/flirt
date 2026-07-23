"""Scheme Pydantic v2 pentru monetizare (TZ 9) + push (TZ 6.3)."""
from __future__ import annotations

from datetime import datetime

from pydantic import AliasChoices, BaseModel, Field

from app.core.validators import safe_str

# Plafoane aliniate cu modelele (Subscription.plan = 32, PushDevice.token = 255,
# PushDevice.platform = 16).
PLAN_MAX_LENGTH = 32
PUSH_TOKEN_MAX_LENGTH = 255
PUSH_PLATFORM_MAX_LENGTH = 16

# Plafon pentru dovada de plată. Un JWS StoreKit 2 are ~2-4 KB, un purchaseToken
# Google ~1 KB. 16 KB lasă marjă confortabilă și, în același timp, împiedică un
# client să ne trimită 10 MB de „receipt" (DoS pe parsare/memorie).
RECEIPT_MAX_LENGTH = 16_384


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
    # Doar pentru „cardurile de reduceri" (card_5 / card_10): câte intrări la
    # evenimente au fost cumpărate și câte mai rămân. NULL pentru celelalte planuri.
    entries_total: int | None = None
    entries_remaining: int | None = None


class PurchaseIn(BaseModel):
    """Payload la cumpărarea unui plan.

    `plan` e validat defensiv (trim, non-gol, plafon lungime, fără HTML/control
    chars); apartenența la catalog se verifică în serviciu (plan necunoscut → 400).
    ATENȚIE: `plan` e doar INTENȚIA clientului. La providerii reali, planul efectiv
    acordat se derivă din `productId`-ul semnat de magazin; dacă cele două nu
    coincid, achiziția e REFUZATĂ (altfel se cumpăra `no_ads` și se cerea
    `all_inclusive`).

    `receipt` e DOVADA de plată. Numele câmpului diferă de la client la client, așa
    că acceptăm toate variantele reale prin `AliasChoices`:
    - `jwsRepresentationIos` — ce trimite `expo-iap` cu StoreKit 2 (JWS semnat);
    - `purchaseTokenAndroid` — token-ul Google Play;
    - `receipt` — numele generic (Stripe checkout session id).
    Un singur câmp în serviciu ⇒ o singură cale de validare, fără ramuri paralele.
    """

    plan: safe_str(PLAN_MAX_LENGTH)
    receipt: str | None = Field(
        default=None,
        max_length=RECEIPT_MAX_LENGTH,
        validation_alias=AliasChoices(
            "receipt", "jwsRepresentationIos", "purchaseTokenAndroid"
        ),
    )


class EntitlementsOut(BaseModel):
    """Drepturi derivate din abonamentul activ (flag-uri pentru client)."""

    premium: bool
    no_ads: bool
    ai_bot: bool
    # Acces la reducerile de la evenimente (cardurile de reduceri, sau all_inclusive).
    event_discount: bool = False
    # Intrări rămase pe cardul de reduceri activ (NULL dacă userul nu are card).
    entries_remaining: int | None = None
    entries_total: int | None = None


class PushRegisterIn(BaseModel):
    """Payload la înregistrarea unui dispozitiv de push.

    `token` și `platform` sunt validate defensiv (trim, non-gol, plafon lungime,
    fără HTML/control chars).
    """

    token: safe_str(PUSH_TOKEN_MAX_LENGTH)
    platform: safe_str(PUSH_PLATFORM_MAX_LENGTH)
