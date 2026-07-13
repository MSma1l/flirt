"""Gestiunea userilor din panoul de admin — `/api/v1/admin/users*`.

Rutele care SCHIMBĂ STAREA (ban, unban, ștergere) scriu obligatoriu în
`AdminAuditLog`, în aceeași tranzacție cu acțiunea (vezi `admin_service`).
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import (
    AdminReportOut,
    AdminUserDetail,
    AdminUserOut,
    BanIn,
    DeleteUserIn,
    SEARCH_MAX_LENGTH,
    UserStatusFilter,
)
from app.services import admin_service
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Plafonul de paginare e impus DE FASTAPI (`le=ADMIN_MAX_LIMIT`), nu doar de
# serviciu: `?limit=999999` primește 422 înainte să atingă baza de date.
LimitQuery = Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)]


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    q: Annotated[str | None, Query(max_length=SEARCH_MAX_LENGTH)] = None,
    # Filtrul principal al panoului. `reported` = are cel puțin un raport împotriva
    # lui — starea pe care un moderator o caută cel mai des.
    status: Annotated[UserStatusFilter | None, Query()] = None,
    role: Annotated[str | None, Query()] = None,
    banned: Annotated[bool | None, Query()] = None,
    verified: Annotated[bool | None, Query()] = None,
    completed: Annotated[bool | None, Query()] = None,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[AdminUserOut]:
    """Căutare (email / nume) + filtrare (status, rol, banat, verificat, complet).

    Cursorul paginii următoare vine în header-ul `X-Next-Cursor` (convenția
    întregului API — vezi `/feed`, `/chats`, `/events`).
    """
    items, next_cursor = await admin_service.list_users(
        db,
        q=q,
        status_filter=status,
        role=role,
        banned=banned,
        verified=verified,
        completed=completed,
        limit=limit,
        cursor=cursor,
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.get("/users/{user_id}", response_model=AdminUserDetail)
async def get_user(
    user_id: uuid.UUID, db: DbDep, admin: CurrentAdmin
) -> AdminUserDetail:
    """Fișa completă a unui user (404 dacă nu există).

    Include contoare de activitate și abonamentul curent — dar NICIUN secret:
    sesiunile apar doar ca NUMĂR, nu cu `token_hash`, iar `password_hash` nu
    figurează în schema de răspuns.
    """
    return await admin_service.get_user_detail(db, user_id)


@router.get("/users/{user_id}/reports", response_model=list[AdminReportOut])
async def list_user_reports(
    user_id: uuid.UUID,
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[AdminReportOut]:
    """Istoricul rapoartelor depuse ÎMPOTRIVA acestui user (paginat)."""
    items, next_cursor = await admin_service.list_user_reports(
        db, user_id, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.post("/users/{user_id}/ban", response_model=AdminUserDetail)
async def ban_user(
    user_id: uuid.UUID,
    data: BanIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminUserDetail:
    """Banează un cont: revocă sesiunile, îl scoate din feed, refuză login-ul.

    Nu doar un flag — vezi `admin_service.ban_user` pentru cele trei efecte.
    400 dacă adminul încearcă să se banească pe sine (s-ar încuia singur afară).
    """
    return await admin_service.ban_user(
        db,
        admin,
        user_id,
        reason=data.reason,
        ip=admin_service.request_ip(request),
    )


@router.post("/users/{user_id}/unban", response_model=AdminUserDetail)
async def unban_user(
    user_id: uuid.UUID,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminUserDetail:
    """Ridică banul: contul redevine funcțional și reapare în feed."""
    return await admin_service.unban_user(
        db, admin, user_id, ip=admin_service.request_ip(request)
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
    # Corpul e OPȚIONAL: `DELETE` cu body nu e suportat uniform de clienții HTTP,
    # iar panoul nu trimite niciunul. Când e trimis, motivul intră în audit.
    data: DeleteUserIn | None = None,
) -> None:
    """Ștergere GDPR imediată și IREVERSIBILĂ (refolosește `account_service`).

    400 dacă adminul încearcă să-și șteargă propriul cont.
    """
    await admin_service.delete_user(
        db,
        admin,
        user_id,
        reason=data.reason if data else None,
        ip=admin_service.request_ip(request),
    )
