"""Preferințele notificărilor din botul Telegram — /api/v1/notifications/telegram.

Mini App-ul le arată ca patru comutatoare (mesaje, like-uri, povești, match-uri).
Logica trimiterii stă în `services/tg_notify.py`; aici doar citim/scriem flag-urile.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.notifications import TelegramNotificationsIn, TelegramNotificationsOut
from app.services import tg_notify

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
