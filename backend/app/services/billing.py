"""Schelet de monetizare (TZ 9) — catalog de planuri + abonare STUB.

Provider-ul se alege din `settings.billing_provider`:
- 'stub' (implicit): `purchase` „cumpără" imediat, fără plată reală.
- 'stripe' | 'app_store' | 'play': punct de conectare pentru validarea
  receipt-ului real (nu e implementat încă).

Entitlements-urile (drepturile) sunt derivate din planul abonamentului activ,
fără hardcodare la nivel de endpoint.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.billing import Subscription
from app.models.user import User
from app.schemas.billing import EntitlementsOut, PlanOut, SubscriptionOut

logger = logging.getLogger("app.billing")

# Durata unui ciclu de abonament (zile). Folosit când provider-ul nu întoarce
# o dată de expirare proprie. Fără hardcodare în cod.
_STUB_PERIOD_DAYS = 30

# Timeout comun pentru apelurile HTTP către provideri (secunde).
_HTTP_TIMEOUT = 10.0

# Endpoint-uri oficiale (o singură sursă de adevăr, fără hardcodare la apel).
_STRIPE_SESSION_URL = "https://api.stripe.com/v1/checkout/sessions"
_APP_STORE_VERIFY_URL = "https://buy.itunes.apple.com/verifyReceipt"

# Stripe: statusuri care confirmă o plată reușită.
_STRIPE_PAID_STATES = {"paid", "complete", "succeeded"}

# Catalogul de planuri (TZ 9). Cheia = codul planului stocat pe Subscription.
# Descriptiv (titlu + features); PREȚURILE vin din `settings` (vezi `_PLAN_PRICE_ATTRS`).
# Fiecare plan mapează la drepturi via `_PLAN_ENTITLEMENTS` de mai jos.
PLANS: dict[str, dict] = {
    "premium": {
        "code": "premium",
        "title": "Premium",
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
        "features": [
            "Dezactivează bannerele și reclama video",
            "Fără ridicarea limitei de swipe",
        ],
    },
    "ai_bot": {
        "code": "ai_bot",
        "title": "AI-bot în chat",
        "features": [
            "Sugestii de mesaje extinse",
            "Analiză de compatibilitate peste limita free",
        ],
    },
    "all_inclusive": {
        "code": "all_inclusive",
        "title": "Totul inclus",
        "features": [
            "Premium complet",
            "Fără reclamă",
            "AI-bot în chat",
            "Preț redus față de cumpărarea separată",
        ],
    },
}

# Maparea plan -> câmpul de preț din `settings` (o singură sursă de adevăr).
_PLAN_PRICE_ATTRS: dict[str, str] = {
    "premium": "price_premium",
    "no_ads": "price_no_ads",
    "ai_bot": "price_ai_bot",
    "all_inclusive": "price_all_inclusive",
}

# Maparea plan -> drepturi. `all_inclusive` cumulează toate flag-urile.
_PLAN_ENTITLEMENTS: dict[str, dict[str, bool]] = {
    "premium": {"premium": True, "no_ads": True, "ai_bot": False},
    "no_ads": {"premium": False, "no_ads": True, "ai_bot": False},
    "ai_bot": {"premium": False, "no_ads": False, "ai_bot": True},
    "all_inclusive": {"premium": True, "no_ads": True, "ai_bot": True},
}


def list_plans() -> list[PlanOut]:
    """Catalogul public de planuri; prețurile vin din `settings`."""
    return [
        PlanOut(price_eur=getattr(settings, _PLAN_PRICE_ATTRS[code]), **plan)
        for code, plan in PLANS.items()
    ]


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


def _payment_required(detail: str) -> HTTPException:
    """Eroare uniformă când validarea plății eșuează la un provider live."""
    return HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=detail)


async def _verify_stripe(receipt: str | None) -> None:
    """Verifică o plată Stripe după id-ul sesiunii de checkout (`receipt`).

    Face GET la Stripe API cu basic auth (`stripe_secret_key` ca username) și
    acceptă doar dacă `payment_status`/`status` indică o plată reușită.
    """
    if not receipt:
        raise _payment_required("Lipsește id-ul sesiunii de plată Stripe.")

    url = f"{_STRIPE_SESSION_URL}/{receipt}"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, auth=(settings.stripe_secret_key, ""))
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:  # RO: rețea / status HTTP != 2xx
        logger.warning("Stripe verify failed: %s", exc)
        raise _payment_required("Verificarea plății Stripe a eșuat.") from exc

    # Acceptăm dacă oricare dintre indicatorii de status confirmă plata.
    states = {
        str(data.get("payment_status", "")).lower(),
        str(data.get("status", "")).lower(),
    }
    if not (states & _STRIPE_PAID_STATES):
        raise _payment_required("Plata Stripe nu este confirmată (neplătită).")


async def _verify_app_store(receipt: str | None) -> None:
    """Verifică un receipt App Store prin `verifyReceipt` (status == 0 → valid)."""
    if not receipt:
        raise _payment_required("Lipsește receipt-ul App Store.")

    payload = {
        "receipt-data": receipt,
        "password": settings.app_store_shared_secret,
    }
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(_APP_STORE_VERIFY_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("App Store verify failed: %s", exc)
        raise _payment_required("Verificarea receipt-ului App Store a eșuat.") from exc

    if data.get("status") != 0:
        raise _payment_required(
            f"Receipt App Store invalid (status={data.get('status')})."
        )


async def _verify_purchase(provider: str, receipt: str | None) -> None:
    """Validează achiziția reală în funcție de provider (ridică 402 la eșec)."""
    if provider == "stripe":
        await _verify_stripe(receipt)
    elif provider == "app_store":
        await _verify_app_store(receipt)
    else:
        # RO: 'play' și alți provideri încă neimplementați.
        raise NotImplementedError(
            f"Billing provider '{provider}' nu este implementat încă. "
            "Adaugă validarea receipt-ului pentru acest provider."
        )


async def _activate(
    db: AsyncSession, user: User, plan: str, provider: str
) -> SubscriptionOut:
    """Creează/actualizează abonamentul activ al userului (upsert)."""
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


async def purchase(
    db: AsyncSession, user: User, plan: str, receipt: str | None = None
) -> SubscriptionOut:
    """Cumpără/activează un plan.

    În modul 'stub' (implicit) activează imediat, fără plată reală. La providerii
    live ('stripe', 'app_store') validează întâi `receipt`-ul prin HTTP și doar
    la succes creează abonamentul; altfel ridică 402. `receipt` e opțional pentru
    a nu strica apelul existent din rută (default None → stub activează direct).
    """
    if plan not in PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Plan necunoscut: '{plan}'.",
        )

    provider = settings.billing_provider
    if provider != "stub":
        # RO: validăm plata reală înainte de a marca abonamentul activ.
        await _verify_purchase(provider, receipt)

    return await _activate(db, user, plan, provider)


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
