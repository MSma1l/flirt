"""Rute anketă/profil — sub prefixul /api/v1/profiles."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.profile import AnketaIn, ProfileOut, ReferenceOut
from app.services import profile_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/reference", response_model=ReferenceOut)
async def get_reference(db: DbDep) -> ReferenceOut:
    """Opțiunile de referință (genuri, statusuri, limbi, interese) — PUBLIC."""
    return await profile_service.get_reference(db)


@router.get("/me", response_model=ProfileOut)
async def get_my_profile(db: DbDep, user: UserDep) -> ProfileOut:
    """Anketa utilizatorului curent (404 dacă nu a fost completată încă)."""
    profile = await profile_service.get_profile_out(db, user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Anketa nu există încă."
        )
    return profile


@router.put("/me", response_model=ProfileOut)
async def upsert_my_profile(data: AnketaIn, db: DbDep, user: UserDep) -> ProfileOut:
    """Creează sau actualizează anketa; o marchează drept completată."""
    return await profile_service.upsert_anketa(db, user, data)
