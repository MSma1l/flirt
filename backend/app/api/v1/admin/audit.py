"""Jurnalul de audit — `GET /api/v1/admin/audit-log`.

CITIRE ȘI ATÂT. Nu există `DELETE`, nu există `PUT`, nu există „curăță jurnalul".
Un jurnal de audit pe care adminul suspect îl poate șterge nu e un jurnal, e o
decorațiune: exact persoana pe care ar trebui să o incrimineze e cea care ar
avea acces să îl golească.

Append-only e garantat prin construcție — nicio rută de scriere/ștergere nu
există în tot pachetul `admin/`, iar singurul cod care scrie în tabelă e
`admin_service.audit()`, apelat de acțiunile auditate.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import AuditLogOut
from app.services import admin_service
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/audit-log", response_model=list[AuditLogOut])
async def list_audit_log(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    action: Annotated[str | None, Query()] = None,
    target_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AuditLogOut]:
    """Cine, ce, asupra cui, când, de la ce IP — cele mai noi intrări primele.

    Filtre: `?action=user.ban`, `?target_id=<uuid>` (istoricul acțiunilor asupra
    unei ținte — indexul `ix_admin_audit_target` există exact pentru asta).
    """
    items, next_cursor = await admin_service.list_audit_log(
        db, action=action, target_id=target_id, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items
