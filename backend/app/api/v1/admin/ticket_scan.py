"""Scanarea biletelor la intrare — `/api/v1/admin/tickets/*` și
`/api/v1/admin/events/{id}/admissions`.

Folosite de pagina „Scanner" din panoul de admin, deschisă pe telefonul
staff-ului (fără aplicație instalată). Protecția (`require_admin`) se aplică pe
`include_router` în `admin/__init__.py`; orice admin poate scana.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.schemas.ticket_scan import (
    AdmissionOut,
    ScanStatsOut,
    TicketScanIn,
    TicketScanOut,
)
from app.services import ticket_scan_service
from app.services.admin_service import request_ip

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Per IP, fereastră de 60s (prag în config) — oprește ghicirea în masă de coduri.
_scan_rl = rate_limit("ticket_scan", "rate_limit_ticket_scan_per_min", 60)


@router.post(
    "/tickets/scan",
    response_model=TicketScanOut,
    dependencies=[Depends(_scan_rl)],
)
async def scan_ticket(
    data: TicketScanIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> TicketScanOut:
    """Verifică biletul la intrare și îl admite dacă e valid.

    Răspunde mereu 200 cu `result` (refuzurile sunt rezultate normale ale
    scanării, nu erori HTTP); 404 doar dacă evenimentul ales nu există.
    """
    return await ticket_scan_service.scan(
        db, admin, data.code, data.event_id, ip=request_ip(request)
    )


@router.get("/tickets/scan-stats", response_model=ScanStatsOut)
async def scan_stats(
    db: DbDep, admin: CurrentAdmin, event_id: Annotated[uuid.UUID, Query()]
) -> ScanStatsOut:
    """Contorul live „intrați / vânduți" pentru eveniment."""
    return await ticket_scan_service.scan_stats(db, event_id)


@router.get("/events/{event_id}/admissions", response_model=list[AdmissionOut])
async def list_admissions(
    event_id: uuid.UUID,
    db: DbDep,
    admin: CurrentAdmin,
    limit: Annotated[int, Query(ge=1, le=200)] = ticket_scan_service.ADMISSIONS_DEFAULT_LIMIT,
) -> list[AdmissionOut]:
    """Intrările recente la eveniment (cele mai noi primele)."""
    return await ticket_scan_service.list_admissions(db, event_id, limit)
