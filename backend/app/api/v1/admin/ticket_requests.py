"""Cereri manuale de bilete: coadă, verificare și dovada protejată."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.ticket_order import TicketRequestOut, TicketRequestReviewIn
from app.services import ticket_order_service
from app.services.admin_service import request_ip
from app.services.storage import get_storage

router = APIRouter(tags=["admin"])
DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/ticket-requests", response_model=list[TicketRequestOut])
async def list_ticket_requests(
    db: DbDep, admin: CurrentAdmin, status: str | None = None,
    event_id: uuid.UUID | None = None, created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> list[TicketRequestOut]:
    return await ticket_order_service.list_requests(db, status_filter=status, event_id=event_id, created_from=created_from, created_to=created_to)


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
    result = await get_storage().read(order.payment_proof_url)
    if not result:
        raise HTTPException(status_code=404, detail="Dovada plății nu mai este disponibilă.")
    content, content_type = result
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "private, no-store"})


@router.post("/ticket-requests/{order_id}/review", response_model=TicketRequestOut)
async def review_ticket_request(order_id: uuid.UUID, data: TicketRequestReviewIn, request: Request, db: DbDep, admin: CurrentAdmin) -> TicketRequestOut:
    return await ticket_order_service.review_request(db, admin, order_id, data.status, data.admin_comment, request_ip(request))
