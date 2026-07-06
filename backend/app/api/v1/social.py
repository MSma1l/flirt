"""Rute favorite + black list — sub prefixul /api/v1/social (TZ secț. 6)."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.account import BlockOut, FavoriteOut, TargetIn
from app.services import account_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


# --- Favorite ----------------------------------------------------------------
@router.get("/favorites", response_model=list[FavoriteOut])
async def list_favorites(db: DbDep, user: UserDep) -> list[FavoriteOut]:
    """Lista de favorite a userului curent (protejat)."""
    return await account_service.list_favorites(db, user)


@router.post("/favorites", status_code=status.HTTP_201_CREATED)
async def add_favorite(
    data: TargetIn, db: DbDep, user: UserDep
) -> Response:
    """Adaugă un user la favorite (protejat)."""
    await account_service.add_favorite(db, user, data.target_user_id)
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("/favorites/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_favorite(
    target_user_id: uuid.UUID, db: DbDep, user: UserDep
) -> Response:
    """Scoate un user din favorite (protejat)."""
    await account_service.remove_favorite(db, user, target_user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Black list --------------------------------------------------------------
@router.get("/blocks", response_model=list[BlockOut])
async def list_blocks(db: DbDep, user: UserDep) -> list[BlockOut]:
    """Lista de useri blocați (protejat)."""
    return await account_service.list_blocks(db, user)


@router.post("/blocks", status_code=status.HTTP_201_CREATED)
async def add_block(
    data: TargetIn, db: DbDep, user: UserDep
) -> Response:
    """Blochează un user (protejat)."""
    await account_service.add_block(db, user, data.target_user_id)
    return Response(status_code=status.HTTP_201_CREATED)


@router.delete("/blocks/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_block(
    target_user_id: uuid.UUID, db: DbDep, user: UserDep
) -> Response:
    """Deblochează un user (protejat)."""
    await account_service.remove_block(db, user, target_user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
