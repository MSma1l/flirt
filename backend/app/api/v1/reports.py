"""Rute Moderare / Raportări — sub prefixul /api/v1/reports (TZ 5.5 + 10)."""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.moderation import ReportIn, ReportOut
from app.services import moderation_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def create_report(data: ReportIn, db: DbDep, user: UserDep) -> ReportOut:
    """Depune o raportare; idempotentă, cu auto-ban la prag (protejat)."""
    return await moderation_service.create_report(db, user, data)


@router.get("/mine", response_model=list[ReportOut])
async def list_mine(db: DbDep, user: UserDep) -> list[ReportOut]:
    """Rapoartele depuse de userul curent (protejat)."""
    return await moderation_service.list_my_reports(db, user)
