"""Rute feed de swipe / match-uri — sub prefixul /api/v1/feed (TZ secț. 4)."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.feed import FeedCard, MatchOut, SwipeIn, SwipeResult, UndoResult
from app.services import feed_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=list[FeedCard])
async def get_feed(db: DbDep, user: UserDep) -> list[FeedCard]:
    """Feed-ul de candidate pentru swipe, sortat după compatibilitate (protejat)."""
    return await feed_service.get_feed(db, user)


@router.post("/swipe", response_model=SwipeResult)
async def swipe(data: SwipeIn, db: DbDep, user: UserDep) -> SwipeResult:
    """Înregistrează un like/dislike; întoarce dacă a produs match (protejat)."""
    return await feed_service.swipe(
        db, user, data.target_user_id, data.action, data.message
    )


@router.post("/undo", response_model=UndoResult)
async def undo(db: DbDep, user: UserDep) -> UndoResult:
    """Anulează ultimul swipe al userului curent (TZ 4.4, protejat)."""
    return await feed_service.undo_last_swipe(db, user)


@router.get("/matches", response_model=list[MatchOut])
async def get_matches(db: DbDep, user: UserDep) -> list[MatchOut]:
    """Lista match-urilor userului curent (protejat)."""
    return await feed_service.get_matches(db, user)
