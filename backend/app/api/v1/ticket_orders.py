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
from app.core.config import settings
from app.services import ticket_order_service
from app.api.v1.profiles import _validate_image_upload
from app.services.storage import ext_for_content_type, get_storage

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


# --------------------------------------------------------------------------- #
# Dovada plății (chitanța): imagine SAU PDF — ajutoare comune (și pentru admin)
# --------------------------------------------------------------------------- #
_PDF_MAGIC = b"%PDF-"
_PDF_DECLARED_TYPES = {"application/pdf", "application/x-pdf"}


def validate_proof_upload(content: bytes, declared_content_type: str) -> tuple[str, str]:
    """Validează o chitanță și întoarce `(content_type sigur, extensie)`.

    Imaginile trec prin validatorul existent (allowlist + magic-bytes); un PDF
    trebuie DECLARAT ca PDF și să înceapă cu `%PDF-`. Aceeași limită de mărime.
    """
    if declared_content_type in _PDF_DECLARED_TYPES or content[:5] == _PDF_MAGIC:
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Fișier prea mare (max {settings.max_upload_bytes} bytes).",
            )
        if declared_content_type not in _PDF_DECLARED_TYPES or not content.startswith(_PDF_MAGIC):
            raise HTTPException(status_code=422, detail="Conținutul încărcat nu este un PDF valid.")
        return "application/pdf", "pdf"
    safe_ct = _validate_image_upload(content, declared_content_type)
    ext = ext_for_content_type(safe_ct)
    if not ext:  # defensiv; validatorul a verificat deja allowlist-ul
        raise HTTPException(status_code=422, detail="Tip de fișier nepermis.")
    return safe_ct, ext


async def read_proof_form(request: Request) -> tuple[bytes, str, str | None]:
    """Citește `file` (+ opțional `method`) dintr-un multipart/form-data."""
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise HTTPException(status_code=422, detail="Se așteaptă multipart/form-data cu câmpul 'file'.")
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="Lipsește câmpul 'file'.")
    method = form.get("method")
    return await upload.read(), upload.content_type or "", method if isinstance(method, str) else None


async def store_proof(order_id: uuid.UUID, content: bytes, declared_content_type: str) -> str:
    safe_ct, ext = validate_proof_upload(content, declared_content_type)
    # UUID server-side, fără filename controlat de utilizator și namespace separat.
    key = f"ticket-proofs/{order_id}/{uuid.uuid4().hex}.{ext}"
    return await get_storage().save(key, content, safe_ct)


async def proof_file_response(proof_url: str | None) -> Response:
    """Răspunsul cu fișierul dovezii (privat, fără cache, fără sniffing)."""
    if not proof_url:
        raise HTTPException(status_code=404, detail="Dovada plății nu există.")
    result = await get_storage().read(proof_url)
    if not result:
        raise HTTPException(status_code=404, detail="Dovada plății nu mai este disponibilă.")
    content, content_type = result
    headers = {"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}
    if proof_url.lower().endswith(".pdf"):
        content_type = "application/pdf"
        headers["Content-Disposition"] = 'inline; filename="dovada-plata.pdf"'
    return Response(content=content, media_type=content_type, headers=headers)


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
    content, declared, _method = await read_proof_form(request)
    proof_url = await store_proof(order_id, content, declared)
    return await ticket_order_service.submit_payment_proof(db, user, order_id, proof_url)


@router.get("/ticket-requests/{order_id}", response_model=TicketRequestOut, tags=["ticket-requests"])
async def get_my_ticket_request(order_id: uuid.UUID, db: DbDep, user: UserDep) -> TicketRequestOut:
    return await ticket_order_service.get_my_request(db, user, order_id)


@router.get("/ticket-requests/{order_id}/payment-proof", tags=["ticket-requests"])
async def get_my_ticket_payment_proof(order_id: uuid.UUID, db: DbDep, user: UserDep) -> Response:
    order = await ticket_order_service._get_own_order_or_404(db, user, order_id)
    return await proof_file_response(order.payment_proof_url)


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


@router.post(
    "/ticket-orders/{order_id}/payment-proof",
    response_model=TicketOrderOut,
    tags=["ticket-orders"],
)
async def upload_ticket_order_proof(
    order_id: uuid.UUID, request: Request, db: DbDep, user: UserDep
) -> TicketOrderOut:
    """Chitanța plății (imagine jpeg/png/webp sau PDF) → comanda trece în verificare.

    Multipart: `file` (obligatoriu) + `method` (`mia` | `iban`, opțional). Merge pe
    orice comandă proprie care mai așteaptă plata (directă sau cerere); o dovadă
    nouă o înlocuiește pe cea veche. `declare` rămâne pentru aplicația nativă.
    """
    # Autorizare + stare ÎNAINTE de a citi bytes (fără fișiere orfane).
    await ticket_order_service.ensure_can_upload_order_proof(db, user, order_id)
    content, declared, method = await read_proof_form(request)
    proof_url = await store_proof(order_id, content, declared)
    return await ticket_order_service.submit_order_proof(db, user, order_id, proof_url, method)


@router.get("/ticket-orders/{order_id}/payment-proof", tags=["ticket-orders"])
async def get_my_ticket_order_proof(order_id: uuid.UUID, db: DbDep, user: UserDep) -> Response:
    order = await ticket_order_service._get_own_order_or_404(db, user, order_id)
    return await proof_file_response(order.payment_proof_url)


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
