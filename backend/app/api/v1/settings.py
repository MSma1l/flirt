"""Rute setări + ștergere cont — sub prefixul /api/v1/settings (TZ secț. 6)."""
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.account import (
    AccountDeletionOut,
    SettingsIn,
    SettingsOut,
)
from app.services import account_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/", response_model=SettingsOut)
async def get_settings(db: DbDep, user: UserDep) -> SettingsOut:
    """Setările userului curent, cu valori implicite dacă lipsesc (protejat)."""
    return await account_service.get_settings(db, user)


@router.put("/", response_model=SettingsOut)
async def update_settings(
    data: SettingsIn, db: DbDep, user: UserDep
) -> SettingsOut:
    """Actualizează parțial setările userului curent (protejat)."""
    return await account_service.update_settings(db, user, data)


@router.post("/account/delete", response_model=AccountDeletionOut)
async def request_account_deletion(
    db: DbDep, user: UserDep
) -> AccountDeletionOut:
    """Cere ștergerea contului cu perioadă de grație din config (protejat)."""
    return await account_service.request_account_deletion(db, user)


@router.post("/account/delete/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_account_deletion(db: DbDep, user: UserDep) -> Response:
    """Anulează cererea de ștergere a contului (protejat)."""
    await account_service.cancel_account_deletion(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
