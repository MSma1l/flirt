"""Notificări — sub /api/v1/notifications.

  - `/telegram`: preferințele botului (patru comutatoare: mesaje, like-uri,
    povești, match-uri). Logica trimiterii stă în `services/tg_notify.py`.
  - `/activity`: centrul de activitate din aplicație — statistici (vizualizări,
    like-uri, super like-uri, dislike-uri, match-uri), cronologia evenimentelor
    și numărul de necitite pentru badge. Logica stă în `activity_service.py`.
"""
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.notifications import (
    ActivityPage,
    ActivityReadIn,
    ActivityUnreadOut,
    TelegramNotificationsIn,
    TelegramNotificationsOut,
)
from app.services import activity_service, tg_notify
from app.services.pagination import MAX_CURSOR_LENGTH, SOCIAL_MAX_LIMIT

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/telegram", response_model=TelegramNotificationsOut)
async def get_telegram_notifications(user: UserDep) -> TelegramNotificationsOut:
    """Preferințele curente (protejat)."""
    return TelegramNotificationsOut(**tg_notify.get_preferences(user))


@router.put("/telegram", response_model=TelegramNotificationsOut)
async def update_telegram_notifications(
    data: TelegramNotificationsIn, db: DbDep, user: UserDep
) -> TelegramNotificationsOut:
    """Update parțial; întoarce obiectul complet (protejat)."""
    prefs = await tg_notify.update_preferences(db, user, data.changes())
    return TelegramNotificationsOut(**prefs)


@router.get("/activity", response_model=ActivityPage)
async def get_activity(
    db: DbDep,
    user: UserDep,
    limit: Annotated[int | None, Query(ge=1, le=SOCIAL_MAX_LIMIT)] = None,
    cursor: Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)] = None,
) -> ActivityPage:
    """Centrul de activitate (protejat): statistici + cronologie + necitite.

    Cursorul paginii următoare e `next_cursor` din corp (lista amestecă trei
    surse, deci nu e un id de rând ca în `X-Next-Cursor`).
    """
    return await activity_service.list_activity(db, user, limit=limit, cursor=cursor)


@router.get("/activity/unread", response_model=ActivityUnreadOut)
async def get_activity_unread(db: DbDep, user: UserDep) -> ActivityUnreadOut:
    """Doar numărul de necitite — ținta poll-ului de badge (protejat)."""
    return ActivityUnreadOut(unread=await activity_service.unread_count(db, user))


@router.post("/activity/read", response_model=ActivityUnreadOut)
async def mark_activity_read(
    db: DbDep, user: UserDep, data: ActivityReadIn | None = None
) -> ActivityUnreadOut:
    """Marchează activitatea citită până la `up_to` (implicit acum) (protejat)."""
    unread = await activity_service.mark_read(
        db, user, data.up_to if data is not None else None
    )
    return ActivityUnreadOut(unread=unread)
