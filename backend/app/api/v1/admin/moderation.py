"""Coada de moderare — `/api/v1/admin/reports*`.

RUTA CEA MAI IMPORTANTĂ OPERAȚIONAL DIN TOT PANOUL. App Store Guideline 1.2
(User-Generated Content) cere ca o aplicație cu conținut generat de utilizatori
să aibă „un mecanism de raportare a conținutului ofensator și o reacție în cel
mult 24 de ore". Fără coada asta, cerința nu poate fi îndeplinită nici măcar
teoretic: rapoartele intrau în `reports` și nu le citea nimeni, niciodată.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import AdminReportOut, ReportStatus, ResolveIn
from app.services import admin_service
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/reports", response_model=list[AdminReportOut])
async def list_reports(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    # Filtrul panoului: 'open' | 'resolved' | 'dismissed'. `open` include și
    # rapoartele `auto_banned` din DB — auto-ascunderea e o măsură automată de
    # urgență, NU un răspuns uman, iar Apple cere unul (Guideline 1.2).
    status: Annotated[ReportStatus | None, Query()] = None,
    pending_only: Annotated[bool, Query()] = False,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AdminReportOut]:
    """Coada de moderare — RAPOARTELE ÎN AȘTEPTARE PRIMELE, apoi cele mai noi.

    Fiecare rând vine cu profilul raportat alăturat (`reported`) și cu numărul de
    raportori DISTINCȚI (trei reclamații de la același om nu înseamnă nimic; trei
    de la trei oameni înseamnă foarte mult).
    """
    items, next_cursor = await admin_service.list_reports(
        db,
        status_filter=status,
        pending_only=pending_only,
        limit=limit,
        cursor=cursor,
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.post("/reports/{report_id}/resolve", response_model=AdminReportOut)
async def resolve_report(
    report_id: uuid.UUID,
    data: ResolveIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminReportOut:
    """Decizia umană: `ban` | `hide` | `dismiss` (sinonime: `ban_user`, `hide_profile`).

    Închide TOATE rapoartele în așteptare împotriva aceluiași user, nu doar rândul
    pe care s-a dat click: altfel cinci reclamații despre aceeași persoană ar cere
    cinci decizii identice, iar coada — singura măsură a SLA-ului de 24h — ar
    rămâne artificial plină după ce cazul a fost deja judecat.
    """
    return await admin_service.resolve_report(
        db, admin, report_id, data, ip=admin_service.request_ip(request)
    )
