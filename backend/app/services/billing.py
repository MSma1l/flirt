"""Schelet de monetizare (TZ 9) — catalog de planuri + abonare STUB.

Provider-ul se alege din `settings.billing_provider`:
- 'stub' (implicit): `purchase` „cumpără" imediat, fără plată reală.
- 'stripe' | 'app_store' | 'play': punct de conectare pentru validarea
  receipt-ului real (nu e implementat încă).

Entitlements-urile (drepturile) sunt derivate din planul abonamentului activ,
fără hardcodare la nivel de endpoint.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.billing import Subscription
from app.models.user import User
from app.schemas.billing import EntitlementsOut, PlanOut, SubscriptionOut

# Durata unui ciclu de abonament în modul stub (zile). Fără hardcodare în cod.
_STUB_PERIOD_DAYS = 30

# Catalogul de planuri (TZ 9). Cheia = codul planului stocat pe Subscription.
# Fiecare plan mapează la drepturi via `_PLAN_ENTITLEMENTS` de mai jos.
PLANS: dict[str, dict] = {
    "premium": {
        "code": "premium",
        "title": "Premium",
        "price_eur": 9.99,
        "features": [
            "Swipe nelimitat",
            "Fără timer și fără reclamă",
            "Undo nelimitat",
            "Prioritate în feed",
        ],
    },
    "no_ads": {
        "code": "no_ads",
        "title": "Fără reclamă",
        "price_eur": 3.99,
        "features": [
            "Dezactivează bannerele și reclama video",
            "Fără ridicarea limitei de swipe",
        ],
    },
    "ai_bot": {
        "code": "ai_bot",
        "title": "AI-bot în chat",
        "price_eur": 4.99,
        "features": [
            "Sugestii de mesaje extinse",
            "Analiză de compatibilitate peste limita free",
        ],
    },
    "all_inclusive": {
        "code": "all_inclusive",
        "title": "Totul inclus",
        "price_eur": 14.99,
        "features": [
            "Premium complet",
            "Fără reclamă",
            "AI-bot în chat",
            "Preț redus față de cumpărarea separată",
        ],
    },
}

# Maparea plan -> drepturi. `all_inclusive` cumulează toate flag-urile.
_PLAN_ENTITLEMENTS: dict[str, dict[str, bool]] = {
    "premium": {"premium": True, "no_ads": True, "ai_bot": False},
    "no_ads": {"premium": False, "no_ads": True, "ai_bot": False},
    "ai_bot": {"premium": False, "no_ads": False, "ai_bot": True},
    "all_inclusive": {"premium": True, "no_ads": True, "ai_bot": True},
}


def list_plans() -> list[PlanOut]:
    """Catalogul public de planuri."""
    return [PlanOut(**plan) for plan in PLANS.values()]


def _is_active(sub: Subscription | None) -> bool:
    """True dacă abonamentul e 'active' și nu a expirat."""
    if sub is None or sub.status != "active":
        return False
    if sub.expires_at is not None:
        expires = sub.expires_at
        # RO: unele backend-uri (ex. SQLite) întorc datetime naive; îl tratăm UTC.
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            return False
    return True


async def get_subscription(db: AsyncSession, user: User) -> SubscriptionOut | None:
    """Abonamentul curent al userului (cel mai recent), sau None."""
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if sub is None:
        return None
    return SubscriptionOut(plan=sub.plan, status=sub.status, expires_at=sub.expires_at)


async def purchase(db: AsyncSession, user: User, plan: str) -> SubscriptionOut:
    """Cumpără/activează un plan.

    În modul 'stub' activează imediat, fără plată reală (expires_at = acum+30z).
    La providerii reali, aici se validează receipt-ul înainte de a marca activ.
    """
    if plan not in PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Plan necunoscut: '{plan}'.",
        )

    provider = settings.billing_provider
    if provider != "stub":
        # RO: aici se validează achiziția reală înainte de activare, în funcție
        # de provider, folosind settings.billing_api_key:
        # - 'stripe':    creezi/confirmi Subscription prin Stripe API și
        #                asculți webhook-urile pentru status.
        # - 'app_store': verifici receipt-ul cu App Store Server API
        #                (verifyReceipt / JWS) și extragi expires_date.
        # - 'play':      verifici token-ul cu Google Play Developer API
        #                (purchases.subscriptions.get) și extragi expiryTime.
        raise NotImplementedError(
            f"Billing provider '{provider}' nu este implementat încă. "
            "Setează BILLING_API_KEY și adaugă validarea receipt-ului."
        )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_STUB_PERIOD_DAYS)

    # Upsert: reutilizăm rândul existent al userului dacă există, altfel creăm.
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()
    if sub is None:
        sub = Subscription(user_id=user.id)
        db.add(sub)

    sub.plan = plan
    sub.status = "active"
    sub.provider = provider
    sub.expires_at = expires_at

    await db.commit()
    await db.refresh(sub)
    return SubscriptionOut(plan=sub.plan, status=sub.status, expires_at=sub.expires_at)


async def entitlements(db: AsyncSession, user: User) -> EntitlementsOut:
    """Drepturile userului, derivate din abonamentul activ."""
    result = await db.execute(
        select(Subscription)
        .where(Subscription.user_id == user.id)
        .order_by(Subscription.created_at.desc())
    )
    sub = result.scalars().first()

    # Fără abonament activ → toate flag-urile false.
    if not _is_active(sub):
        return EntitlementsOut(premium=False, no_ads=False, ai_bot=False)

    flags = _PLAN_ENTITLEMENTS.get(
        sub.plan, {"premium": False, "no_ads": False, "ai_bot": False}
    )
    return EntitlementsOut(**flags)
