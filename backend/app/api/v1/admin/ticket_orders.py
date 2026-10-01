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

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.api.v1.profiles import _validate_image_upload
from app.api.v1.ticket_orders import proof_file_response, read_proof_form
from app.models.ticket_order import TICKET_ORDER_STATUSES
from app.schemas.ticket_order import (
    AdminStatusChangeIn,
    AdminTicketOrderOut,
    PaymentSettingsIn,
    PaymentSettingsOut,
    RejectIn,
)
from app.services import ticket_order_service
from app.services.admin_service import request_ip
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH
from app.services.storage import get_storage

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/ticket-orders", response_model=list[AdminTicketOrderOut])
async def list_ticket_orders(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
    status: Annotated[str | None, Query(max_length=300)] = None,
) -> list[AdminTicketOrderOut]:
    """Comenzile de bilet — cele DE VERIFICAT primele, apoi cele mai recente.

    Paginare pe cursor (convenția listelor de admin): cursorul paginii următoare
    vine în header-ul `X-Next-Cursor`. Filtru aditiv `?status=a,b` (422 pe o
    stare necunoscută).
    """
    statuses = [s.strip() for s in status.split(",") if s.strip()] if status else None
    if statuses and any(s not in TICKET_ORDER_STATUSES for s in statuses):
        raise HTTPException(status_code=422, detail="Stare necunoscută în filtru.")
    items, next_cursor = await ticket_order_service.list_orders(
        db, limit=limit, cursor=cursor, statuses=statuses
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


# --- Codul QR MIA ---------------------------------------------------------------
# Limita proprie (mai mică decât a pozelor): un QR e o imagine mică.
MIA_QR_MAX_BYTES = 5 * 1024 * 1024
# Plafon anti „decompression bomb" + latura maximă după re-encodare.
_MIA_QR_MAX_PIXELS = 25_000_000
_MIA_QR_MAX_SIDE = 2000


def clean_qr_image(content: bytes) -> bytes:
    """Re-encodează QR-ul ca PNG fără metadate (EXIF/XMP/text), cu orientarea
    aplicată în pixeli și latura plafonată. 422 dacă imaginea nu se poate citi."""
    import io

    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(content)) as img:
            width, height = img.size
            if width * height > _MIA_QR_MAX_PIXELS:
                raise HTTPException(status_code=413, detail="Imaginea are dimensiuni prea mari.")
            img.load()
            clean = ImageOps.exif_transpose(img)
            if clean.mode not in ("RGB", "RGBA", "L", "LA"):
                clean = clean.convert("RGBA" if "A" in clean.getbands() else "RGB")
            clean.thumbnail((_MIA_QR_MAX_SIDE, _MIA_QR_MAX_SIDE))
            # O imagine NOUĂ din pixeli: nimic din `info` (metadate) nu trece.
            fresh = Image.new(clean.mode, clean.size)
            fresh.paste(clean)
            out = io.BytesIO()
            fresh.save(out, format="PNG", optimize=True)
            return out.getvalue()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — orice imagine stricată → 422 clar
        raise HTTPException(status_code=422, detail="Imaginea QR nu poate fi citită.") from exc


@router.post("/payment-settings/mia-qr", response_model=PaymentSettingsOut)
async def upload_mia_qr(
    request: Request, db: DbDep, admin: CurrentAdmin
) -> PaymentSettingsOut:
    """Încarcă/înlocuiește codul QR MIA (multipart `file`: png/jpeg/webp, ≤ 5 MB).

    Conținutul real e verificat (magic-bytes), apoi re-encodat PNG fără metadate
    și salvat sub o cheie aleatoare. Vechiul QR se șterge. Auditat.
    """
    content, declared, _ = await read_proof_form(request)
    if len(content) > MIA_QR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Fișier prea mare (max 5 MB).")
    _validate_image_upload(content, declared)
    png = clean_qr_image(content)
    key = f"photos/payment-qr/{uuid.uuid4().hex}.png"
    url = await get_storage().save(key, png, "image/png")
    return await ticket_order_service.set_mia_qr(db, url, actor=admin, ip=request_ip(request))


@router.delete("/payment-settings/mia-qr", response_model=PaymentSettingsOut)
async def delete_mia_qr(
    request: Request, db: DbDep, admin: CurrentAdmin
) -> PaymentSettingsOut:
    """Scoate codul QR MIA (409 dacă ar rămâne fără nicio metodă de plată)."""
    return await ticket_order_service.remove_mia_qr(db, actor=admin, ip=request_ip(request))


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


# --- Detaliu, dovadă și schimbare manuală de stare -----------------------------
@router.get("/ticket-orders/{order_id}", response_model=AdminTicketOrderOut)
async def get_ticket_order(
    order_id: uuid.UUID, db: DbDep, admin: CurrentAdmin
) -> AdminTicketOrderOut:
    """Detaliul unei comenzi (inclusiv `allowed_statuses` pentru corecții)."""
    return await ticket_order_service.get_admin_order(db, order_id)


@router.get("/ticket-orders/{order_id}/payment-proof")
async def get_ticket_order_proof(
    order_id: uuid.UUID, db: DbDep, admin: CurrentAdmin
) -> Response:
    """Chitanța încărcată de user (imagine sau PDF), privată, fără cache."""
    order = await ticket_order_service._get_order_or_404(db, order_id)
    return await proof_file_response(order.payment_proof_url)


@router.post("/ticket-orders/{order_id}/status", response_model=AdminTicketOrderOut)
async def change_ticket_order_status(
    order_id: uuid.UUID,
    data: AdminStatusChangeIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminTicketOrderOut:
    """Schimbare manuală de stare (auditată). 409 pe o tranziție nepermisă."""
    return await ticket_order_service.change_status(
        db, admin, order_id, data.status, data.note, ip=request_ip(request)
    )
