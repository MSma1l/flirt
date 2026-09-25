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

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.ticket_order import (
    DeclareIn,
    TicketOrderCreateOut,
    TicketOrderOut,
    TicketRequestCreateIn,
    TicketRequestCreateOut,
    TicketRequestOut,
)
from app.services import ticket_order_service
from app.api.v1.profiles import _validate_image_upload
from app.services.storage import ext_for_content_type, get_storage

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/events/{event_id}/ticket-requests", response_model=TicketRequestCreateOut, status_code=status.HTTP_201_CREATED, tags=["ticket-requests"])
async def create_ticket_request(event_id: uuid.UUID, data: TicketRequestCreateIn, db: DbDep, user: UserDep) -> TicketRequestCreateOut:
    return await ticket_order_service.create_request(db, user, event_id, data)


@router.get("/ticket-requests/mine", response_model=list[TicketRequestOut], tags=["ticket-requests"])
async def list_my_ticket_requests(db: DbDep, user: UserDep) -> list[TicketRequestOut]:
    return await ticket_order_service.list_my_requests(db, user)


@router.post("/ticket-requests/{order_id}/payment-proof", response_model=TicketRequestOut, tags=["ticket-requests"])
async def upload_ticket_payment_proof(order_id: uuid.UUID, request: Request, db: DbDep, user: UserDep) -> TicketRequestOut:
    # Authorize before accepting bytes/storage, avoiding orphan files caused by an
    # attacker posting a large valid image against somebody else's request.
    await ticket_order_service.get_my_request(db, user, order_id)
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise HTTPException(status_code=422, detail="Se așteaptă multipart/form-data cu câmpul 'file'.")
    form = await request.form(); upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="Lipsește câmpul 'file'.")
    content = await upload.read()
    safe_ct = _validate_image_upload(content, upload.content_type or "")
    ext = ext_for_content_type(safe_ct)
    if not ext:  # defensive; validatorul a verificat deja allowlist-ul
        raise HTTPException(status_code=422, detail="Tip de fișier nepermis.")
    # UUID server-side, fără filename controlat de utilizator și namespace separat.
    key = f"ticket-proofs/{order_id}/{uuid.uuid4().hex}.{ext}"
    proof_url = await get_storage().save(key, content, safe_ct)
    return await ticket_order_service.submit_payment_proof(db, user, order_id, proof_url)


@router.get("/ticket-requests/{order_id}", response_model=TicketRequestOut, tags=["ticket-requests"])
async def get_my_ticket_request(order_id: uuid.UUID, db: DbDep, user: UserDep) -> TicketRequestOut:
    return await ticket_order_service.get_my_request(db, user, order_id)


@router.get("/ticket-requests/{order_id}/payment-proof", tags=["ticket-requests"])
async def get_my_ticket_payment_proof(order_id: uuid.UUID, db: DbDep, user: UserDep) -> Response:
    order = await ticket_order_service._get_own_order_or_404(db, user, order_id)
    if not order.payment_proof_url:
        raise HTTPException(status_code=404, detail="Dovada plății nu există.")
    result = await get_storage().read(order.payment_proof_url)
    if not result:
        raise HTTPException(status_code=404, detail="Dovada plății nu mai este disponibilă.")
    content, content_type = result
    return Response(content=content, media_type=content_type, headers={"Cache-Control": "private, no-store"})


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
