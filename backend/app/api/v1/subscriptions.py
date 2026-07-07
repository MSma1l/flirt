"""Rute Subscriptions — sub prefixul /api/v1/subscriptions (TZ 9).

`/plans` e public (catalog); restul e protejat. În modul 'stub', `/purchase`
activează planul imediat, fără plată reală.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.billing import (
    EntitlementsOut,
    PlanOut,
    PurchaseIn,
    SubscriptionOut,
)
from app.services import billing

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/plans", response_model=list[PlanOut])
async def list_plans() -> list[PlanOut]:
    """Catalogul de planuri (public)."""
    return billing.list_plans()


@router.get("/me", response_model=SubscriptionOut | None)
async def my_subscription(db: DbDep, user: UserDep) -> SubscriptionOut | None:
    """Abonamentul curent al userului, sau null (protejat)."""
    return await billing.get_subscription(db, user)


@router.post("/purchase", response_model=SubscriptionOut)
async def purchase(data: PurchaseIn, db: DbDep, user: UserDep) -> SubscriptionOut:
    """Cumpără/activează un plan (protejat)."""
    return await billing.purchase(db, user, data.plan)


@router.get("/entitlements", response_model=EntitlementsOut)
async def entitlements(db: DbDep, user: UserDep) -> EntitlementsOut:
    """Drepturile derivate din abonamentul activ (protejat)."""
    return await billing.entitlements(db, user)
