"""Rute Evenimente + Flirt Passport — sub prefixul /api/v1/events (TZ secț. 8).

`/passport` e declarat ÎNAINTE de `/{event_id}` ca să nu fie „înghițit" de
ruta parametrizată.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.event import EventOut, GoingIn, PassportStampOut
from app.services import event_service
from app.services.pagination import EVENTS_MAX_LIMIT, MAX_CURSOR_LENGTH

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=list[EventOut])
async def list_events(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: Annotated[int | None, Query(ge=1, le=EVENTS_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> list[EventOut]:
    """Evenimentele viitoare cu numărul de participanți (protejat).

    Paginare pe cursor (convenția `/feed`): cursorul paginii următoare vine în
    header-ul `X-Next-Cursor`.
    """
    page = await event_service.list_events(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.get("/passport", response_model=list[PassportStampOut])
async def list_passport(db: DbDep, user: UserDep) -> list[PassportStampOut]:
    """Ștampilele Flirt Passport ale userului curent (protejat)."""
    return await event_service.list_passport(db, user)


@router.get("/{event_id}", response_model=EventOut)
async def get_event(event_id: uuid.UUID, db: DbDep, user: UserDep) -> EventOut:
    """Detaliile unui eveniment sau 404 (protejat)."""
    return await event_service.get_event(db, user, event_id)


@router.post("/{event_id}/going", response_model=EventOut)
async def set_going(
    event_id: uuid.UUID, data: GoingIn, db: DbDep, user: UserDep
) -> EventOut:
    """Marchează / anulează participarea la un eveniment (protejat)."""
    return await event_service.set_going(db, user, event_id, data.going)


@router.post(
    "/{event_id}/checkin",
    response_model=PassportStampOut,
    status_code=status.HTTP_201_CREATED,
)
async def checkin(
    event_id: uuid.UUID, db: DbDep, user: UserDep
) -> PassportStampOut:
    """Check-in la eveniment → ștampilă Flirt Passport idempotentă (protejat)."""
    return await event_service.checkin(db, user, event_id)
