"""Invitații speciale + praguri de fidelitate — `/api/v1/admin/loyalty/*`.

Protecția (`require_admin`) se aplică O SINGURĂ DATĂ, pe `include_router` în
`admin/__init__.py` — nu rută cu rută (vezi comentariul de acolo).

ORDINEA RUTELOR: `/loyalty/tiers` e un segment distinct de `/loyalty/invites*`,
deci nu există captură greșită; iar `/loyalty/invites` (colecția) e declarată
înaintea lui `/loyalty/invites/{invite_id}/revoke`.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.loyalty import AdminInviteOut, InviteIn, TiersIn, TiersOut
from app.services import loyalty
from app.services.admin_service import request_ip
from app.services.pagination import ADMIN_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


# --- Praguri / trepte ---------------------------------------------------------
@router.get("/loyalty/tiers", response_model=TiersOut)
async def get_tiers(db: DbDep, admin: CurrentAdmin) -> TiersOut:
    """Scara de trepte + plafonul de reducere (singleton, creat leneș din config)."""
    return await loyalty.get_tiers(db)


@router.put("/loyalty/tiers", response_model=TiersOut)
async def update_tiers(
    data: TiersIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> TiersOut:
    """Rescrie TOATĂ scara de trepte + plafonul (auditat: `loyalty.tiers.update`).

    Aici e motivul pentru care pragurile nu stau în cod: o schimbare de prag sau
    de procent e un PUT, nu un deploy.
    """
    return await loyalty.update_tiers(db, data, actor=admin, ip=request_ip(request))


# --- Invitații ----------------------------------------------------------------
@router.post(
    "/loyalty/invites",
    response_model=AdminInviteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_invite(
    data: InviteIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdminInviteOut:
    """Emite o invitație → cod generat pe SERVER (auditat: `loyalty.invite.create`).

    Codul apare în răspuns (adminul trebuie să îl transmită invitatului), dar NU
    în jurnalul de audit. 400 la expirare în trecut / prea îndepărtată,
    `max_uses` peste plafon sau treaptă minimă inexistentă; 404 eveniment lipsă.
    """
    return await loyalty.create_invite(db, data, actor=admin, ip=request_ip(request))


@router.get("/loyalty/invites", response_model=list[AdminInviteOut])
async def list_invites(
    db: DbDep,
    admin: CurrentAdmin,
    response: Response,
    event_id: Annotated[uuid.UUID | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=ADMIN_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[AdminInviteOut]:
    """Invitațiile cu starea folosirii (`used_count` / `uses_left` / `status`).

    Filtru opțional `?event_id=`. Paginare pe cursor (convenția listelor de
    admin): cursorul paginii următoare vine în header-ul `X-Next-Cursor`.
    """
    items, next_cursor = await loyalty.list_invites(
        db, event_id=event_id, limit=limit, cursor=cursor
    )
    if next_cursor:
        response.headers["X-Next-Cursor"] = next_cursor
    return items


@router.post("/loyalty/invites/{invite_id}/revoke", response_model=AdminInviteOut)
async def revoke_invite(
    invite_id: uuid.UUID, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdminInviteOut:
    """Revocă o invitație (auditat: `loyalty.invite.revoke`).

    Revocare SOFT și idempotentă: folosirile deja consumate rămân valabile, dar
    codul nu mai poate fi folosit de nimeni altcineva. 404 dacă nu există.
    """
    return await loyalty.revoke_invite(db, invite_id, actor=admin, ip=request_ip(request))
