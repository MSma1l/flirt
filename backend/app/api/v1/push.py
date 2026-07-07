"""Rute Push — sub prefixul /api/v1/push (TZ 6.3). Toate protejate.

`/register` face upsert pe dispozitiv; `/test` trimite o notificare stub către
userul curent (util pentru verificarea integrării client).
"""
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.billing import PushRegisterIn
from app.services import push

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.post("/register", status_code=status.HTTP_204_NO_CONTENT)
async def register(data: PushRegisterIn, db: DbDep, user: UserDep) -> None:
    """Înregistrează/actualizează un dispozitiv de push (protejat)."""
    await push.register_device(db, user, data.token, data.platform)


@router.post("/test", status_code=status.HTTP_204_NO_CONTENT)
async def send_test(db: DbDep, user: UserDep) -> None:
    """Trimite o notificare stub către userul curent (protejat)."""
    await push.send_to_user(
        db, user.id, "FLIRT", "Notificare de test (stub)."
    )
