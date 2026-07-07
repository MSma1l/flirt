"""Rute Testul de umor — sub prefixul /api/v1/humor (TZ 2.7).

Toate rutele sunt protejate. Rezultatul populează `Profile.humor_vector`,
folosit de algoritmul de compatibilitate.
"""
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.humor import HumorCard, HumorProfileOut, HumorSubmitIn
from app.services import humor_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/quiz", response_model=list[HumorCard])
async def get_quiz(user: UserDep) -> list[HumorCard]:
    """Cardurile quiz-ului de umor (protejat)."""
    return humor_service.get_quiz()


@router.post("/submit", response_model=HumorProfileOut)
async def submit_quiz(
    data: HumorSubmitIn, db: DbDep, user: UserDep
) -> HumorProfileOut:
    """Trimite răspunsurile și salvează vectorul de umor (protejat)."""
    return await humor_service.submit_quiz(db, user, data.answers)


@router.get("/me", response_model=HumorProfileOut)
async def get_my_humor(db: DbDep, user: UserDep) -> HumorProfileOut:
    """Vectorul de umor curent al userului (protejat)."""
    return await humor_service.get_humor(db, user)
