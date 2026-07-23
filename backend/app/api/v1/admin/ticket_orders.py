"""Coada de bilete + date bancare — `/api/v1/admin/ticket-orders*`,
`/api/v1/admin/payment-settings`.

Protecția (`require_admin`) se aplică O SINGURĂ DATĂ, pe `include_router` în
`admin/__init__.py` — nu rută cu rută (vezi comentariul de acolo).

ORDINEA RUTELOR: `/payment-settings` e distinctă de `/ticket-orders/*`, deci nu
există captură greșită. Coada e ordonată DECLARED-FIRST (comenzile în care userul
a declarat plata primesc verificarea manuală prima).
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.ticket_order import (
    AdminTicketOrderOut,
    PaymentSettingsIn,
    PaymentSettingsOut,
    RejectIn,
)
from app.services import ticket_order_service
from app.services.admin_service import request_ip
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/ticket-orders", response_model=list[AdminTicketOrderOut])
async def list_ticket_orders(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AdminTicketOrderOut]:
    """Comenzile de bilet — DECLARATE primele, apoi cele mai recente.

    Paginare pe cursor (convenția listelor de admin): cursorul paginii următoare
    vine în header-ul `X-Next-Cursor`.
    """
    items, next_cursor = await ticket_order_service.list_orders(
        db, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


# --- Date bancare globale (ÎNAINTE de rutele parametrizate) --------------------
@router.get("/payment-settings", response_model=PaymentSettingsOut)
async def get_payment_settings(db: DbDep, admin: CurrentAdmin) -> PaymentSettingsOut:
    """Datele bancare globale (singleton). Creat leneș cu placeholder-uri dacă lipsește."""
    return await ticket_order_service.get_payment_settings(db)


@router.put("/payment-settings", response_model=PaymentSettingsOut)
async def update_payment_settings(
    data: PaymentSettingsIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> PaymentSettingsOut:
    """Actualizează datele bancare globale (auditat: `payment_settings.update`)."""
    return await ticket_order_service.update_payment_settings(
        db, data, actor=admin, ip=request_ip(request)
    )


# --- Decizii pe comenzi -------------------------------------------------------
@router.post("/ticket-orders/{order_id}/approve", response_model=AdminTicketOrderOut)
async def approve_ticket_order(
    order_id: uuid.UUID, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdminTicketOrderOut:
    """Aprobă → generează `ticket_code` unic (auditat: `ticket_order.approve`).

    409 dacă comanda e deja aprobată/respinsă.
    """
    return await ticket_order_service.approve(
        db, admin, order_id, ip=request_ip(request)
    )


@router.post("/ticket-orders/{order_id}/reject", response_model=AdminTicketOrderOut)
async def reject_ticket_order(
    order_id: uuid.UUID,
    data: RejectIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminTicketOrderOut:
    """Respinge → `admin_note=reason` (auditat: `ticket_order.reject`).

    409 dacă comanda e deja aprobată/respinsă.
    """
    return await ticket_order_service.reject(
        db, admin, order_id, data.reason, ip=request_ip(request)
    )
