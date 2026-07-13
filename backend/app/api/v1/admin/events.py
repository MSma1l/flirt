"""CRUD de evenimente — `/api/v1/admin/events*`.

ACESTA E UN GOL FUNCȚIONAL REAL, NU O ÎMBUNĂTĂȚIRE:
`POST /events` nu există nicăieri în API-ul public, iar seed-ul demo
(`event_service.seed_events`) se oprește explicit când `environment == "production"`.
Cu alte cuvinte, până la aceste rute, producția nu avea NICIO cale de a crea un
eveniment — secțiunea „Evenimente" din aplicație s-ar fi lansat goală și ar fi
rămas goală, la nesfârșit. Rutele de mai jos sunt singurul mod în care un
eveniment real ajunge în baza de producție.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import AdminEventIn, AdminEventOut, AdminEventUpdate
from app.services import admin_service
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/events", response_model=list[AdminEventOut])
async def list_events(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AdminEventOut]:
    """Toate evenimentele, INCLUSIV cele trecute (cel mai recent primul).

    `GET /events` (public) arată doar viitorul — userul nu are ce face cu o
    petrecere de acum trei luni. Adminul are: o editează, o șterge, o refolosește.
    """
    items, next_cursor = await admin_service.list_events(
        db, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.post(
    "/events", response_model=AdminEventOut, status_code=status.HTTP_201_CREATED
)
async def create_event(
    data: AdminEventIn,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminEventOut:
    """Creează un eveniment real (singura cale de a face asta în producție)."""
    return await admin_service.create_event(
        db, admin, data, ip=admin_service.request_ip(request)
    )


@router.put("/events/{event_id}", response_model=AdminEventOut)
async def update_event(
    event_id: uuid.UUID,
    data: AdminEventUpdate,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> AdminEventOut:
    """Editare PARȚIALĂ — se scriu doar câmpurile trimise efectiv.

    Un PUT care schimbă doar ora NU șterge descrierea (vezi `exclude_unset` din
    serviciu). 422 dacă payload-ul e gol, 404 dacă evenimentul nu există.
    """
    return await admin_service.update_event(
        db, admin, event_id, data, ip=admin_service.request_ip(request)
    )


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: uuid.UUID,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> None:
    """Șterge evenimentul + participările + ștampilele lui (fără orfani)."""
    await admin_service.delete_event(
        db, admin, event_id, ip=admin_service.request_ip(request)
    )
