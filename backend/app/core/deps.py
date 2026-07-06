"""Dependențe FastAPI pentru autentificare — extragerea userului curent."""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User

# tokenUrl e doar informativ pentru OpenAPI; login-ul real e la /api/v1/auth/login.
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/auth/login",
    auto_error=True,
)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Decodează access token-ul, validează tipul și încarcă userul din DB."""
    try:
        payload = decode_token(token)
    except JWTError:
        raise _credentials_exc

    # Acceptăm strict token-uri de tip "access".
    if payload.get("type") != "access":
        raise _credentials_exc

    sub = payload.get("sub")
    if not sub:
        raise _credentials_exc

    try:
        user_id = uuid.UUID(str(sub))
    except (ValueError, TypeError):
        raise _credentials_exc

    user = await db.get(User, user_id)
    if user is None:
        raise _credentials_exc
    return user


# Alias pentru injectare rapidă în rute.
CurrentUser = Annotated[User, Depends(get_current_user)]
