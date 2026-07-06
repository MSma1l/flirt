"""Rută bilet Flirt Party — sub prefixul /api/v1/ticket (TZ secț. 6)."""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.account import TicketOut
from app.services import account_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=TicketOut)
async def get_ticket(db: DbDep, user: UserDep) -> TicketOut:
    """Biletul userului; îl emite lazily dacă lipsește (protejat)."""
    return await account_service.get_or_issue_ticket(db, user)
