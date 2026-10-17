"""Cereri manuale de bilete: coadă, verificare și dovada protejată."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH
from app.db.session import get_db
from app.schemas.ticket_order import (
    TicketRequestOut,
    TicketRequestReviewIn,
    TicketStatusCountsOut,
)
from app.api.v1.admin.ticket_orders import parse_status_filter
from app.services import ticket_order_service
from app.services.admin_service import request_ip
from app.api.v1.ticket_orders import proof_file_response

router = APIRouter(tags=["admin"])
DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/ticket-requests", response_model=list[TicketRequestOut])
async def list_ticket_requests(
    db: DbDep, admin: CurrentAdmin, response: Response,
    status: Annotated[str | None, Query(max_length=300)] = None,
    event_id: uuid.UUID | None = None, created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[TicketRequestOut]:
    """Cererile, cele mai recente primele. Paginare pe cursor (convenția listelor
    de admin): cursorul paginii următoare vine în header-ul `X-Next-Cursor`.
    `?status=a,b` (sau o singură stare; 422 pe o stare necunoscută)."""
    items, next_cursor = await ticket_order_service.list_requests_page(
        db, statuses=parse_status_filter(status), event_id=event_id,
        created_from=created_from, created_to=created_to, limit=limit, cursor=cursor,
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


# ÎNAINTE de `/ticket-requests/{order_id}`: altfel „counts" ar fi capturat ca id.
@router.get("/ticket-requests/counts", response_model=TicketStatusCountsOut)
async def count_ticket_requests(
    db: DbDep, admin: CurrentAdmin, event_id: uuid.UUID | None = None,
) -> TicketStatusCountsOut:
    """Câte cereri are fiecare stare (tab-urile cozii), cu filtrele listei
    (`event_id`; fără stare/cursor). Un singur `GROUP BY`."""
    return TicketStatusCountsOut(
        **await ticket_order_service.count_requests(db, event_id=event_id)
    )


@router.get("/ticket-requests/{order_id}", response_model=TicketRequestOut)
async def get_ticket_request(order_id: uuid.UUID, db: DbDep, admin: CurrentAdmin) -> TicketRequestOut:
    order = await ticket_order_service._get_order_or_404(db, order_id)
    if order.full_name is None:
        raise HTTPException(status_code=404, detail="Ticket request not found")
    event = await ticket_order_service._get_event_or_404(db, order.event_id)
    return ticket_order_service._to_request_out(order, event)


@router.get("/ticket-requests/{order_id}/payment-proof")
async def get_ticket_request_proof(order_id: uuid.UUID, db: DbDep, admin: CurrentAdmin) -> Response:
    order = await ticket_order_service._get_order_or_404(db, order_id)
    if order.full_name is None or not order.payment_proof_url:
        raise HTTPException(status_code=404, detail="Dovada plății nu există.")
    return await proof_file_response(order.payment_proof_url)


@router.post("/ticket-requests/{order_id}/review", response_model=TicketRequestOut)
async def review_ticket_request(order_id: uuid.UUID, data: TicketRequestReviewIn, request: Request, db: DbDep, admin: CurrentAdmin) -> TicketRequestOut:
    return await ticket_order_service.review_request(db, admin, order_id, data.status, data.admin_comment, request_ip(request))
