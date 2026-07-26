"""Unit teste DIRECTE pentru `auth_service` — apel de serviciu, nu API.

Țintesc ramurile de securitate ale fluxului: register (duplicat 409), authenticate
(parolă greșită / user inexistent / banat / require_role), login social get-or-create
+ ban, și rotația refresh cu TOATE ramurile de reuse detection (revocat, hash greșit,
expirat, banat) + logout idempotent. Apel direct = liniile serviciului se acoperă.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
)
from app.models.session import RefreshSession
from app.models.user import ROLE_ADMIN, ROLE_USER, User
from app.services import auth_service as S

PASSWORD = "Str0ng-Passw0rd!"


async def _get_user(db, email) -> User:
    return await db.scalar(select(User).where(User.email == email))


# --------------------------------------------------------------------------- #
# register
# --------------------------------------------------------------------------- #
async def test_register_issues_token_pair(db_session):
    pair = await S.register(db_session, "Reg@Example.com", PASSWORD)
    assert pair.access_token and pair.refresh_token
    # Emailul e normalizat (lower + trim).
    user = await _get_user(db_session, "reg@example.com")
    assert user is not None


async def test_register_duplicate_email_409(db_session):
    await S.register(db_session, "dup@example.com", PASSWORD)
    with pytest.raises(HTTPException) as exc:
        await S.register(db_session, "  DUP@example.com ", PASSWORD)
    assert exc.value.status_code == 409


# --------------------------------------------------------------------------- #
# authenticate
# --------------------------------------------------------------------------- #
async def test_authenticate_success(db_session):
    await S.register(db_session, "auth_ok@example.com", PASSWORD)
    pair = await S.authenticate(db_session, "auth_ok@example.com", PASSWORD)
    assert pair.access_token and pair.refresh_token


async def test_authenticate_wrong_password_401(db_session):
    await S.register(db_session, "auth_wrong@example.com", PASSWORD)
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, "auth_wrong@example.com", "nope-nope-1A!")
    assert exc.value.status_code == 401


async def test_authenticate_unknown_user_401(db_session):
    # User inexistent → tot 401 (verificare dummy, fără oracol de enumerare).
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, "ghost@example.com", PASSWORD)
    assert exc.value.status_code == 401


async def test_authenticate_banned_403(db_session):
    await S.register(db_session, "auth_banned@example.com", PASSWORD)
    user = await _get_user(db_session, "auth_banned@example.com")
    user.banned_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, "auth_banned@example.com", PASSWORD)
    assert exc.value.status_code == 403


async def test_authenticate_require_role_mismatch_403(db_session):
    await S.register(db_session, "auth_role@example.com", PASSWORD)
    # User obișnuit cere rolul admin → 403.
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(
            db_session, "auth_role@example.com", PASSWORD, require_role=ROLE_ADMIN
        )
    assert exc.value.status_code == 403


async def test_authenticate_require_role_match_ok(db_session):
    await S.register(db_session, "auth_admin@example.com", PASSWORD)
    user = await _get_user(db_session, "auth_admin@example.com")
    user.role = ROLE_ADMIN
    await db_session.commit()
    pair = await S.authenticate(
        db_session, "auth_admin@example.com", PASSWORD, require_role=ROLE_ADMIN
    )
    assert pair.access_token


# --------------------------------------------------------------------------- #
# login_with_identity (get-or-create pentru identități externe)
# --------------------------------------------------------------------------- #
async def test_login_with_identity_creates_user(db_session):
    email = "google_12345@ext.flirt"
    pair = await S.login_with_identity(db_session, email)
    assert pair.refresh_token
    user = await _get_user(db_session, email)
    assert user is not None
    assert user.profile_completed is False


async def test_login_with_identity_reuses_existing_user(db_session):
    email = "google_67890@ext.flirt"
    await S.login_with_identity(db_session, email)
    user1 = await _get_user(db_session, email)
    await S.login_with_identity(db_session, email)  # al doilea login, același user
    user2 = await _get_user(db_session, email)
    assert user1.id == user2.id


async def test_login_with_identity_banned_403(db_session):
    email = "google_banned@ext.flirt"
    await S.login_with_identity(db_session, email)
    user = await _get_user(db_session, email)
    user.banned_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.login_with_identity(db_session, email)
    assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# rotate_refresh
# --------------------------------------------------------------------------- #
async def test_rotate_refresh_happy(db_session):
    pair = await S.register(db_session, "rot_ok@example.com", PASSWORD)
    new_pair = await S.rotate_refresh(db_session, pair.refresh_token)
    assert new_pair.refresh_token != pair.refresh_token


async def test_rotate_refresh_invalid_token_401(db_session):
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, "not-a-jwt")
    assert exc.value.status_code == 401


async def test_rotate_refresh_wrong_type_401(db_session):
    # Un access token (type="access") nu poate rota refresh-ul.
    access = create_access_token(str(uuid.uuid4()))
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, access)
    assert exc.value.status_code == 401


async def test_rotate_refresh_missing_claims_401(db_session):
    # Token de tip refresh dar fără jti/family (encode direct pe cheia de test).
    from jose import jwt

    from app.core.config import settings as cfg

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": str(uuid.uuid4()),
            "iat": now,
            "exp": now + timedelta(days=1),
            "type": "refresh",
        },
        cfg.jwt_private_key,
        algorithm=cfg.jwt_algorithm,
    )
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, token)
    assert exc.value.status_code == 401


async def test_rotate_refresh_session_not_found_401(db_session):
    # Token valid ca semnătură dar fără sesiune în DB (jti necunoscut).
    token = create_refresh_token(
        sub=str(uuid.uuid4()), family_id=uuid.uuid4().hex, jti=uuid.uuid4().hex
    )
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, token)
    assert exc.value.status_code == 401


async def test_rotate_refresh_reuse_revokes_family(db_session):
    pair = await S.register(db_session, "rot_reuse@example.com", PASSWORD)
    # Prima rotație e OK; vechea sesiune devine revocată.
    await S.rotate_refresh(db_session, pair.refresh_token)
    # Reutilizarea vechiului token → reuse detection → 401 + familie revocată.
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, pair.refresh_token)
    assert exc.value.status_code == 401


async def test_rotate_refresh_token_hash_mismatch_revokes_family(db_session):
    user = await _register_user(db_session, "rot_hash@example.com")
    # Sesiune reală, dar prezentăm un token cu ACELAȘI jti și string DIFERIT →
    # hash nepotrivit → revocă familia + 401.
    session = RefreshSession(
        user_id=user.id,
        jti="fixed-jti-hash",
        family_id="fam-hash",
        token_hash=hash_token("the-real-token"),
        expires_at=datetime.now(timezone.utc) + timedelta(days=10),
        revoked=False,
    )
    db_session.add(session)
    await db_session.commit()
    forged = create_refresh_token(
        sub=str(user.id), family_id="fam-hash", jti="fixed-jti-hash"
    )
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, forged)
    assert exc.value.status_code == 401


async def test_rotate_refresh_expired_session_401(db_session):
    user = await _register_user(db_session, "rot_expired@example.com")
    jti = "expired-jti"
    token = create_refresh_token(sub=str(user.id), family_id="fam-exp", jti=jti)
    session = RefreshSession(
        user_id=user.id,
        jti=jti,
        family_id="fam-exp",
        token_hash=hash_token(token),
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),  # deja expirat
        revoked=False,
    )
    db_session.add(session)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, token)
    assert exc.value.status_code == 401


async def test_rotate_refresh_banned_user_403(db_session):
    pair = await S.register(db_session, "rot_banned@example.com", PASSWORD)
    user = await _get_user(db_session, "rot_banned@example.com")
    user.banned_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, pair.refresh_token)
    assert exc.value.status_code == 403


# --------------------------------------------------------------------------- #
# logout
# --------------------------------------------------------------------------- #
async def test_logout_revokes_session(db_session):
    pair = await S.register(db_session, "logout_ok@example.com", PASSWORD)
    await S.logout(db_session, pair.refresh_token)
    sessions = (await db_session.scalars(select(RefreshSession))).all()
    assert all(s.revoked for s in sessions)


async def test_logout_invalid_token_noop(db_session):
    # Token invalid → best-effort, nu ridică.
    await S.logout(db_session, "garbage")


async def test_logout_missing_jti_noop(db_session):
    from jose import jwt

    from app.core.config import settings as cfg

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": "x", "iat": now, "exp": now + timedelta(days=1), "type": "refresh"},
        cfg.jwt_private_key,
        algorithm=cfg.jwt_algorithm,
    )
    await S.logout(db_session, token)  # fără jti → no-op


async def _register_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password(PASSWORD), role=ROLE_USER)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
