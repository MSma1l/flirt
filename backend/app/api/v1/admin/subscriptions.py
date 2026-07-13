"""Abonamente în panoul de admin — listare + acordare manuală (suport clienți)."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import (
    AdminSubscriptionOut,
    GrantSubscriptionByEmailIn,
    GrantSubscriptionIn,
)
from app.services import admin_service
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/subscriptions", response_model=list[AdminSubscriptionOut])
async def list_subscriptions(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    plan: Annotated[str | None, Query()] = None,
    # `status` e numele parametrului din API, dar în cod ar umbri `fastapi.status`
    # (importat peste tot în proiect) → îl legăm explicit la un alt nume local.
    status_filter: Annotated[str | None, Query(alias="status")] = None,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AdminSubscriptionOut]:
    """Abonamentele, paginat, cu emailul userului adus prin JOIN (fără N+1).

    Filtre opționale: `?plan=premium`, `?status=active`.
    """
    items, next_cursor = await admin_service.list_subscriptions(
        db, plan=plan, status_filter=status_filter, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.post("/subscriptions", response_model=AdminSubscriptionOut)
async def grant_subscription_by_email(
    data: GrantSubscriptionByEmailIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminSubscriptionOut:
    """Acordă manual un abonament identificând userul după EMAIL.

    Forma folosită de panou: suportul lucrează cu emailul pe care i-l dă clientul,
    nu cu un UUID pe care ar trebui să-l caute întâi. 404 dacă emailul nu există —
    un mesaj clar, nu o acordare tăcută către nimeni.

    Aceleași reguli ca varianta pe id: plan validat contra catalogului `billing`,
    durată plafonată la `admin_grant_max_days`, provider `manual`, intrare în audit.
    """
    return await admin_service.grant_subscription_by_email(
        db,
        admin,
        data.email,
        GrantSubscriptionIn(plan=data.plan, days=data.days, reason=data.reason),
        ip=admin_service.request_ip(request),
    )


@router.post(
    "/users/{user_id}/grant-subscription", response_model=AdminSubscriptionOut
)
async def grant_subscription(
    user_id: uuid.UUID,
    data: GrantSubscriptionIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminSubscriptionOut:
    """Acordă manual un abonament (compensații, VIP, teste interne).

    Planul e validat contra catalogului real din `billing.PLANS` (400 la un plan
    inventat). Durata e plafonată la `admin_grant_max_days` — un `days=36500`
    scris din greșeală nu are voie să devină un abonament pe viață. Providerul e
    marcat `admin_grant`, ca abonamentele DĂRUITE să nu se amestece cu cele
    PLĂTITE în raportarea de venit.
    """
    return await admin_service.grant_subscription(
        db, admin, user_id, data, ip=admin_service.request_ip(request)
    )
