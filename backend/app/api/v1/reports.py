"""Rute Moderare / Raportări — sub prefixul /api/v1/reports (TZ 5.5 + 10)."""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import user_ratelimit
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.moderation import ReportIn, ReportOut
from app.services import moderation_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

# Câte rapoarte poate depune un user pe zi (`settings.rate_limit_reports_per_day`).
# Un om real raportează rar; un script care inundă coada de moderare nu.
REPORTS_PER_DAY_DEFAULT = 10
DAY_SECONDS = 24 * 60 * 60


@router.post("/", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def create_report(data: ReportIn, db: DbDep, user: UserDep) -> ReportOut:
    """Depune o raportare; idempotentă, cu auto-ascundere la prag (protejat).

    Limitată per user (implicit 10/zi) → 429 la depășire.
    """
    await user_ratelimit.enforce(
        "reports",
        user.id,
        user_ratelimit.limit_from_settings(
            "rate_limit_reports_per_day", REPORTS_PER_DAY_DEFAULT
        ),
        DAY_SECONDS,
        detail="Ai trimis prea multe raportări azi. Încearcă din nou mâine.",
    )
    return await moderation_service.create_report(db, user, data)


@router.get("/mine", response_model=list[ReportOut])
async def list_mine(db: DbDep, user: UserDep) -> list[ReportOut]:
    """Rapoartele depuse de userul curent (protejat)."""
    return await moderation_service.list_my_reports(db, user)
