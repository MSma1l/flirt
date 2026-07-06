"""Rute de autentificare — montate sub /api/v1/auth."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.schemas.auth import (
    LoginIn,
    LogoutIn,
    RefreshIn,
    RegisterIn,
    TokenPair,
    UserOut,
)
from app.services import auth_service

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/register", response_model=TokenPair, status_code=status.HTTP_201_CREATED)
async def register(data: RegisterIn, db: DbSession) -> TokenPair:
    """Creează un cont nou și returnează perechea de token-uri."""
    return await auth_service.register(db, email=data.email, password=data.password)


@router.post("/login", response_model=TokenPair)
async def login(data: LoginIn, db: DbSession) -> TokenPair:
    """Autentifică userul; 401 la credențiale greșite."""
    return await auth_service.authenticate(db, email=data.email, password=data.password)


@router.post("/refresh", response_model=TokenPair)
async def refresh(data: RefreshIn, db: DbSession) -> TokenPair:
    """Rotește refresh token-ul (cu reuse detection)."""
    return await auth_service.rotate_refresh(db, refresh_token=data.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(data: LogoutIn, db: DbSession) -> None:
    """Revocă sesiunea de refresh."""
    await auth_service.logout(db, refresh_token=data.refresh_token)


@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> UserOut:
    """Returnează userul curent (protejat cu access token)."""
    return current_user
