"""Rute de autentificare — montate sub /api/v1/auth."""
from __future__ import annotations

from typing import Annotated

import re

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.schemas.auth import (
    LoginIn,
    LogoutIn,
    PhoneRequestIn,
    PhoneVerifyIn,
    RefreshIn,
    RegisterIn,
    SocialLoginIn,
    TokenPair,
    UserOut,
)
from app.services import auth_providers, auth_service

router = APIRouter()

DbSession = Annotated[AsyncSession, Depends(get_db)]

# Dependency-uri de rate limiting, per IP + endpoint (praguri din `settings`).
_login_rl = rate_limit("login", "rate_limit_login_per_min", 60)
_register_rl = rate_limit("register", "rate_limit_register_per_hour", 3600)
_otp_request_rl = rate_limit("otp_request", "otp_request_per_hour", 3600)
_otp_verify_rl = rate_limit("otp_verify", "rate_limit_login_per_min", 60)


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_register_rl)],
)
async def register(data: RegisterIn, db: DbSession) -> TokenPair:
    """Creează un cont nou și returnează perechea de token-uri."""
    return await auth_service.register(db, email=data.email, password=data.password)


@router.post("/login", response_model=TokenPair, dependencies=[Depends(_login_rl)])
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


def _phone_key(phone: str) -> str:
    """Normalizează un număr de telefon la un identificator stabil (doar cifre)."""
    return re.sub(r"\D", "", phone)


@router.post("/google", response_model=TokenPair)
async def google_login(data: SocialLoginIn, db: DbSession) -> TokenPair:
    """Google Sign-In: validează id_token-ul și autentifică (get-or-create)."""
    claims = await auth_providers.verify_google(data.id_token)
    # Email derivat determinist ca să refolosim modelul User existent.
    email = f"google_{claims['sub']}@ext.flirt"
    return await auth_service.login_with_identity(db, email=email)


@router.post("/apple", response_model=TokenPair)
async def apple_login(data: SocialLoginIn, db: DbSession) -> TokenPair:
    """Apple Sign-In: validează id_token-ul și autentifică (get-or-create)."""
    claims = await auth_providers.verify_apple(data.id_token)
    email = f"apple_{claims['sub']}@ext.flirt"
    return await auth_service.login_with_identity(db, email=email)


@router.post(
    "/phone/request",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(_otp_request_rl)],
)
async def phone_request(data: PhoneRequestIn) -> None:
    """Trimite un cod OTP către numărul de telefon (în stub, codul de test)."""
    await auth_providers.request_otp(data.phone)


@router.post(
    "/phone/verify",
    response_model=TokenPair,
    dependencies=[Depends(_otp_verify_rl)],
)
async def phone_verify(data: PhoneVerifyIn, db: DbSession) -> TokenPair:
    """Verifică OTP-ul; la cod corect autentifică (get-or-create), altfel 401."""
    ok = await auth_providers.verify_otp(data.phone, data.code)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP code",
        )
    email = f"phone_{_phone_key(data.phone)}@ext.flirt"
    return await auth_service.login_with_identity(db, email=email)


@router.get("/me", response_model=UserOut)
async def me(current_user: CurrentUser) -> UserOut:
    """Returnează userul curent (protejat cu access token)."""
    return current_user
