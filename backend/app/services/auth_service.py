"""Logica de business a autentificării: register, login, rotație refresh
(cu reuse detection) și logout.

Erorile de flux sunt semnalate prin `HTTPException`, ca rutele să rămână subțiri.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.session import RefreshSession
from app.models.user import User
from app.schemas.auth import TokenPair


async def _issue_token_pair(
    db: AsyncSession, user: User, family_id: str
) -> TokenPair:
    """Emite o pereche access+refresh și persistă o nouă `RefreshSession`.

    NU face commit — apelantul decide granulele de tranzacție.
    """
    sub = str(user.id)
    jti = uuid.uuid4().hex

    access = create_access_token(sub)
    refresh = create_refresh_token(sub=sub, family_id=family_id, jti=jti)

    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    session = RefreshSession(
        user_id=user.id,
        jti=jti,
        family_id=family_id,
        token_hash=hash_token(refresh),  # stocăm doar hash-ul, nu tokenul brut
        expires_at=expires_at,
        revoked=False,
    )
    db.add(session)

    return TokenPair(access_token=access, refresh_token=refresh)


async def register(db: AsyncSession, email: str, password: str) -> TokenPair:
    """Înregistrează un user nou și emite prima pereche de token-uri."""
    normalized = email.strip().lower()

    exists = await db.scalar(select(User).where(User.email == normalized))
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(email=normalized, password_hash=hash_password(password))
    db.add(user)
    await db.flush()  # obținem user.id înainte de a crea sesiunea

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


async def authenticate(db: AsyncSession, email: str, password: str) -> TokenPair:
    """Autentifică userul (login) și emite o pereche de token-uri."""
    normalized = email.strip().lower()

    user = await db.scalar(select(User).where(User.email == normalized))
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    """Revocă toate sesiunile dintr-o familie (folosit la reuse detection)."""
    await db.execute(
        update(RefreshSession)
        .where(RefreshSession.family_id == family_id)
        .values(revoked=True)
    )


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> TokenPair:
    """Rotește un refresh token cu detectarea reutilizării.

    - token invalid/expirat → 401
    - sesiune inexistentă → 401
    - sesiune deja revocată → REUSE: revocă întreaga familie → 401
    - altfel → revocă vechiul jti, emite pereche nouă în aceeași familie
    """
    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid refresh token",
    )

    try:
        payload = decode_token(refresh_token)
    except JWTError:
        raise invalid

    if payload.get("type") != "refresh":
        raise invalid

    jti = payload.get("jti")
    family_id = payload.get("family_id")
    sub = payload.get("sub")
    if not jti or not family_id or not sub:
        raise invalid

    session = await db.scalar(
        select(RefreshSession).where(RefreshSession.jti == jti)
    )
    if session is None:
        raise invalid

    # Reuse detection: un token deja revocat este reutilizat → compromitem
    # întreaga familie și refuzăm.
    if session.revoked:
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise invalid

    # Verificare defensivă: hash-ul trebuie să corespundă tokenului prezentat.
    if session.token_hash != hash_token(refresh_token):
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise invalid

    # Expirare (dublă verificare pe lângă `exp` din JWT).
    if session.expires_at < datetime.now(timezone.utc):
        raise invalid

    user = await db.get(User, session.user_id)
    if user is None:
        raise invalid

    # Rotație: revocăm sesiunea curentă și emitem una nouă în aceeași familie.
    session.revoked = True
    pair = await _issue_token_pair(db, user, family_id=session.family_id)
    await db.commit()
    return pair


async def logout(db: AsyncSession, refresh_token: str) -> None:
    """Revocă sesiunea corespunzătoare refresh token-ului (idempotent)."""
    try:
        payload = decode_token(refresh_token)
    except JWTError:
        # Logout e best-effort; un token invalid nu trebuie să eșueze zgomotos.
        return

    jti = payload.get("jti")
    if not jti:
        return

    session = await db.scalar(
        select(RefreshSession).where(RefreshSession.jti == jti)
    )
    if session is not None and not session.revoked:
        session.revoked = True
        await db.commit()
