"""Rute publice pentru CUMPĂRAREA de BILETE ONLINE la evenimente prin transfer
bancar cu verificare manuală de admin (user autentificat).

Include-ul se face FĂRĂ prefix (vezi `router.py`): rutele își declară căile
absolute (`/events/{event_id}/ticket-orders` și `/ticket-orders/*`), ca să stea
lângă restul API-ului v1 fără a se amesteca cu routerul de evenimente.

`/ticket-orders/mine` e declarată ÎNAINTE de `/ticket-orders/{order_id}` ca ruta
parametrizată să nu o „înghită".
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.ticket_order import (
    DeclareIn,
    TicketOrderCreateOut,
    TicketOrderOut,
)
from app.services import ticket_order_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post(
    "/events/{event_id}/ticket-orders",
    response_model=TicketOrderCreateOut,
    status_code=status.HTTP_201_CREATED,
    tags=["ticket-orders"],
)
async def create_ticket_order(
    event_id: uuid.UUID, db: DbDep, user: UserDep
) -> TicketOrderCreateOut:
    """Cere un bilet la un eveniment cu preț → comandă + instrucțiuni de plată.

    400 dacă evenimentul nu are `ticket_price` setat (biletul online indisponibil).
    """
    return await ticket_order_service.create_order(db, user, event_id)


@router.post(
    "/ticket-orders/{order_id}/declare",
    response_model=TicketOrderOut,
    tags=["ticket-orders"],
)
async def declare_payment(
    order_id: uuid.UUID, data: DeclareIn, db: DbDep, user: UserDep
) -> TicketOrderOut:
    """Declară „am plătit": `awaiting_payment` → `payment_declared` (doar proprietarul)."""
    return await ticket_order_service.declare(db, user, order_id, data.note)


@router.get(
    "/ticket-orders/mine",
    response_model=list[TicketOrderOut],
    tags=["ticket-orders"],
)
async def list_my_ticket_orders(db: DbDep, user: UserDep) -> list[TicketOrderOut]:
    """Comenzile userului (cel mai recent primul). `ticket_code` doar când e aprobată."""
    return await ticket_order_service.list_mine(db, user)


@router.get(
    "/ticket-orders/{order_id}",
    response_model=TicketOrderCreateOut,
    tags=["ticket-orders"],
)
async def get_my_ticket_order(
    order_id: uuid.UUID, db: DbDep, user: UserDep
) -> TicketOrderCreateOut:
    """O comandă a userului + instrucțiuni de plată cât timp e neplătită.

    `payment` e prezent doar în `awaiting_payment`; în verificare/aprobat/respins e
    `null` (userul nu mai are ce plăti). `ticket_code` apare doar când e aprobată.
    """
    return await ticket_order_service.get_mine(db, user, order_id)
