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

# RO: Hash Argon2 „dummy", constant, pentru a rula MEREU o verificare de parolă
# la login — chiar și când userul nu există — ca timpul de răspuns să nu dezvăluie
# existența contului (anti user-enumeration prin timing).
# EN: constant dummy hash so login timing is uniform whether the user exists or not.
_DUMMY_PASSWORD_HASH = hash_password("timing-uniform-dummy-password")

# RO: Cont banat de moderare — refuzat la login și la rotația refresh-ului.
# Verificarea se face DUPĂ validarea parolei, ca să nu devină un oracol de
# enumerare („acest email există și e banat" spus unui atacator fără parolă).
_BANNED_EXC = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Account is banned",
)


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


async def authenticate(
    db: AsyncSession,
    email: str,
    password: str,
    *,
    require_role: str | None = None,
) -> TokenPair:
    """Autentifică userul (login) și emite o pereche de token-uri.

    `require_role` (opțional) cere ca userul să aibă EXACT rolul dat, altfel 403.
    Îl folosește login-ul panoului de admin (`POST /admin/login`), care are un
    rate limit mai strict decât login-ul obișnuit.

    Verificarea rolului se face DUPĂ parolă (ca banul): un 403 înaintea validării
    parolei ar fi un oracol — un atacator ar putea inventaria conturile de admin
    fără să știe nicio parolă. Și se face ÎNAINTE de emiterea token-urilor: un
    login de admin respins nu are voie să lase în urmă o sesiune de refresh
    valabilă 30 de zile.
    """
    normalized = email.strip().lower()

    user = await db.scalar(select(User).where(User.email == normalized))
    # Rulăm verify_password MEREU (pe hash-ul real sau pe cel dummy) pentru timing
    # uniform, apoi întoarcem un 401 generic, identic pentru „user inexistent" și
    # „parolă greșită" — fără oracol de enumerare.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    password_ok = verify_password(password, password_hash)
    if user is None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if user.is_banned:
        raise _BANNED_EXC
    if require_role is not None and user.role != require_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


async def login_with_identity(db: AsyncSession, email: str) -> TokenPair:
    """Get-or-create pentru o identitate externă (Apple/Google/telefon).

    `email` este un email derivat determinist (ex. `google_{sub}@ext.flirt` sau
    `phone_{msisdn}@ext.flirt`), ca să refolosim modelul `User` existent fără a-l
    modifica. Nu există parolă utilizabilă: userul se autentifică doar prin
    provider, așa că stocăm un hash aleator, imposibil de reprodus.
    """
    normalized = email.strip().lower()

    user = await db.scalar(select(User).where(User.email == normalized))
    if user is None:
        user = User(
            email=normalized,
            password_hash=hash_password(uuid.uuid4().hex),  # parolă inutilizabilă
            profile_completed=False,
        )
        db.add(user)
        await db.flush()  # obținem user.id înainte de a crea sesiunea
    elif user.is_banned:
        # Login social/OTP nu are voie să ocolească banul (altfel „ștergi appul,
        # intri cu Google" și contul banat revine la viață).
        raise _BANNED_EXC

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

    # Expirare (dublă verificare pe lângă `exp` din JWT). Pe SQLite datetime-ul
    # revine „naive"; îl tratăm ca UTC pentru o comparație corectă.
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise invalid

    user = await db.get(User, session.user_id)
    if user is None:
        raise invalid
    if user.is_banned:
        # Fără asta, un cont banat își putea prelungi la nesfârșit accesul
        # rotind refresh token-ul emis înainte de ban.
        session.revoked = True
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise _BANNED_EXC

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
