"""Regresii de securitate pentru autentificare (atac → 4xx).

1. Pre-hijack de cont Telegram prin emailul sintetic `telegram_{id}@ext.flirt`.
2. Purjarea GDPR golește identitatea Telegram / codurile; conturile purjate nu
   sunt refolosite la login și nu pot roti refresh-ul.
3. JWT cu `iss` / `aud` (audiențe distincte admin / app) + tranziție legacy.
4. Rotația refresh-ului citește sesiunea cu `SELECT ... FOR UPDATE`.
5. Blocare per cont după eșecuri, admin refuzat pe `/auth/login`, refresh de
   admin plafonat la 12h absolut.
6. Rate limit pe `/auth/google`, `/auth/apple`, `/auth/refresh`.
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import event, func, select

from app.core import ratelimit
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
)
from app.db.session import engine as app_engine
from app.models.session import RefreshSession
from app.models.user import ROLE_ADMIN, User
from app.services import auth_service as S
from app.services import telegram_auth
from app.services.account_service import purge_user_data
from tests.test_auth_telegram import FAKE_BOT_TOKEN, _build_init_data

pytestmark = pytest.mark.asyncio

AUTH = "/api/v1/auth"
ADMIN_LOGIN = "/api/v1/admin/login"
PASSWORD = "Str0ng-Passw0rd!"


@pytest.fixture(autouse=True)
def _telegram_live(monkeypatch):
    monkeypatch.setattr(settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN)
    monkeypatch.setattr(settings, "telegram_init_data_max_age_seconds", 86_400)
    telegram_auth.reset_replay_state()
    S.reset_lockouts()
    yield
    telegram_auth.reset_replay_state()
    S.reset_lockouts()


@pytest.fixture
def limits_on(monkeypatch):
    """Rate limiting + lockout active; plafoanele PER IP ridicate, ca să
    măsurăm doar blocarea per cont."""
    monkeypatch.setattr(settings, "rate_limit_login_per_min", 1000)
    monkeypatch.setattr(settings, "rate_limit_admin_login_per_min", 1000)
    ratelimit.enable_for_tests()
    S.reset_lockouts()
    yield
    ratelimit.disable_for_tests()
    S.reset_lockouts()


async def _tg_login(client, telegram_id: int, query_id: str | None = None):
    init = _build_init_data(
        telegram_id=telegram_id, query_id=query_id or uuid.uuid4().hex
    )
    return await client.post(f"{AUTH}/telegram", json={"init_data": init})


async def _user_by_email(db, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == email))


async def _make_admin(db, email: str) -> User:
    await S.register(db, email, PASSWORD)
    user = await _user_by_email(db, email)
    user.role = ROLE_ADMIN
    await db.commit()
    return user


# --------------------------------------------------------------------------- #
# 1. Pre-hijack Telegram
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "email",
    [
        "telegram_424242@ext.flirt",
        "Telegram_424242@EXT.FLIRT",
        "google_abc@ext.flirt",
        "x@sub.ext.flirt",
        "deleted+abc@deleted.invalid",
    ],
)
async def test_register_with_reserved_domain_is_rejected(client, db_session, email):
    resp = await client.post(
        f"{AUTH}/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code == 422
    assert await _user_by_email(db_session, email.lower()) is None


async def test_login_with_reserved_domain_is_rejected(client):
    resp = await client.post(
        f"{AUTH}/login",
        json={"email": "telegram_424242@ext.flirt", "password": PASSWORD},
    )
    assert resp.status_code == 422


async def test_register_service_rejects_reserved_domain(db_session):
    with pytest.raises(HTTPException) as exc:
        await S.register(db_session, "telegram_77@ext.flirt", PASSWORD)
    assert exc.value.status_code == 422


async def test_preregistered_synthetic_row_loses_attacker_access(client, db_session):
    """Rând `telegram_{id}@ext.flirt` creat de atacator (înainte de fix) cu parola
    lui: după intrarea victimei din Mini App, parola și sesiunile atacatorului
    nu mai funcționează."""
    victim_tg = 5_550_001
    email = f"telegram_{victim_tg}@ext.flirt"
    attacker = User(email=email, password_hash=hash_password(PASSWORD))
    db_session.add(attacker)
    await db_session.flush()
    attacker_pair = await S._issue_token_pair(db_session, attacker, uuid.uuid4().hex)
    await db_session.commit()

    resp = await _tg_login(client, victim_tg)
    assert resp.status_code == 200, resp.text

    await db_session.refresh(attacker)
    assert attacker.telegram_user_id == victim_tg
    # Parola atacatorului nu mai e valabilă (verificat la nivel de serviciu —
    # schema refuză oricum domeniul rezervat cu 422).
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, email, PASSWORD)
    assert exc.value.status_code == 401
    # Refresh-ul atacatorului e revocat.
    refreshed = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": attacker_pair.refresh_token}
    )
    assert refreshed.status_code == 401


async def test_synthetic_row_linked_to_other_telegram_id_is_not_taken(
    client, db_session
):
    tg_id = 5_550_002
    other = User(
        email=f"telegram_{tg_id}@ext.flirt",
        password_hash=hash_password(uuid.uuid4().hex),
        telegram_user_id=9_999_999,
    )
    db_session.add(other)
    await db_session.commit()

    resp = await _tg_login(client, tg_id)
    assert resp.status_code == 409
    await db_session.refresh(other)
    assert other.telegram_user_id == 9_999_999


# --------------------------------------------------------------------------- #
# 2. GDPR purge + conturi șterse
# --------------------------------------------------------------------------- #
async def test_purge_clears_telegram_identity_and_codes(client, db_session):
    tg_id = 6_660_001
    assert (await _tg_login(client, tg_id)).status_code == 200
    user = await db_session.scalar(select(User).where(User.telegram_user_id == tg_id))
    user.payment_code = "PAY123"
    user.passport_token = "pt" + uuid.uuid4().hex[:8]
    await db_session.commit()
    user_id = user.id

    await purge_user_data(db_session, user_id)
    await db_session.commit()

    purged = await db_session.get(User, user_id)
    await db_session.refresh(purged)
    assert purged.telegram_user_id is None
    assert purged.telegram_linked_at is None
    assert purged.telegram_language is None
    assert purged.payment_code is None
    assert purged.passport_token is None
    assert purged.is_deleted


async def test_telegram_login_after_purge_creates_fresh_account(client, db_session):
    tg_id = 6_660_002
    assert (await _tg_login(client, tg_id)).status_code == 200
    old = await db_session.scalar(select(User).where(User.telegram_user_id == tg_id))
    old_id = old.id
    await purge_user_data(db_session, old_id)
    await db_session.commit()

    resp = await _tg_login(client, tg_id)
    assert resp.status_code == 200, resp.text
    new = await db_session.scalar(select(User).where(User.telegram_user_id == tg_id))
    assert new.id != old_id
    assert not new.is_deleted


async def test_legacy_purged_row_with_telegram_id_is_not_reused(client, db_session):
    """Purjare de dinainte de fix: rândul șters încă are `telegram_user_id`."""
    tg_id = 6_660_003
    assert (await _tg_login(client, tg_id)).status_code == 200
    old = await db_session.scalar(select(User).where(User.telegram_user_id == tg_id))
    old_id = old.id
    await purge_user_data(db_session, old_id)
    old = await db_session.get(User, old_id)
    old.telegram_user_id = tg_id  # starea veche, nepurjată complet
    await db_session.commit()

    resp = await _tg_login(client, tg_id)
    assert resp.status_code == 200, resp.text

    me = await client.get(
        f"{AUTH}/me",
        headers={"Authorization": f"Bearer {resp.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["id"] != str(old_id)

    old = await db_session.get(User, old_id)
    await db_session.refresh(old)
    assert old.telegram_user_id is None
    assert old.email.endswith("@deleted.invalid")
    assert old.telegram_language is None


async def test_refresh_of_deleted_account_is_rejected(client, db_session):
    pair = await S.register(db_session, "gone_refresh@example.com", PASSWORD)
    user = await _user_by_email(db_session, "gone_refresh@example.com")
    # Marcaj de ștergere fără ca sesiunile să fi fost șterse (date vechi).
    user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    resp = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": pair.refresh_token}
    )
    assert resp.status_code == 401


async def test_password_login_of_deleted_account_is_rejected(db_session):
    await S.register(db_session, "gone_login@example.com", PASSWORD)
    user = await _user_by_email(db_session, "gone_login@example.com")
    user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, "gone_login@example.com", PASSWORD)
    assert exc.value.status_code == 401


async def test_identity_login_of_deleted_account_is_rejected(db_session):
    email = "google_deleted@ext.flirt"
    await S.login_with_identity(db_session, email)
    user = await _user_by_email(db_session, email)
    user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.login_with_identity(db_session, email)
    assert exc.value.status_code == 401


async def test_purged_user_with_empty_hash_does_not_500(db_session):
    """`password_hash=""` (purjare) → 401, nu ValueError din passlib."""
    await S.register(db_session, "empty_hash@example.com", PASSWORD)
    user = await _user_by_email(db_session, "empty_hash@example.com")
    user.password_hash = ""
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await S.authenticate(db_session, "empty_hash@example.com", PASSWORD)
    assert exc.value.status_code == 401


# --------------------------------------------------------------------------- #
# 3. JWT iss / aud
# --------------------------------------------------------------------------- #
def _sign(claims: dict) -> str:
    return jwt.encode(claims, settings.jwt_private_key, algorithm=settings.jwt_algorithm)


def _base_claims(sub: str) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=5),
        "jti": uuid.uuid4().hex,
        "type": "access",
    }


async def test_issued_tokens_carry_iss_and_app_audience(db_session):
    pair = await S.register(db_session, "aud_user@example.com", PASSWORD)
    for token in (pair.access_token, pair.refresh_token):
        claims = jwt.get_unverified_claims(token)
        assert claims["iss"] == settings.jwt_issuer
        assert claims["aud"] == settings.jwt_audience_app


async def test_admin_tokens_carry_admin_audience(client, db_session):
    await _make_admin(db_session, "aud_admin@example.com")
    resp = await client.post(
        ADMIN_LOGIN, json={"email": "aud_admin@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    access = jwt.get_unverified_claims(resp.json()["access_token"])
    assert access["aud"] == settings.jwt_audience_admin
    # Audiența poate fi restrânsă explicit: un token de app nu trece ca admin.
    user_token = create_access_token(str(uuid.uuid4()))
    with pytest.raises(JWTError):
        decode_token(user_token, audiences=(settings.jwt_audience_admin,))
    decode_token(resp.json()["access_token"], audiences=(settings.jwt_audience_admin,))


@pytest.mark.parametrize(
    "extra",
    [
        {"iss": "evil-issuer", "aud": "flirt-app"},
        {"iss": "flirt-api", "aud": "other-service"},
        {"iss": "flirt-api", "aud": ["other-service"]},
        {"aud": "flirt-app"},  # doar unul dintre claim-uri → nu e legacy
        {"iss": "flirt-api"},
    ],
)
async def test_foreign_iss_or_aud_is_rejected(client, db_session, extra):
    await S.register(db_session, "aud_victim@example.com", PASSWORD)
    user = await _user_by_email(db_session, "aud_victim@example.com")
    token = _sign({**_base_claims(str(user.id)), **extra})
    resp = await client.get(f"{AUTH}/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


async def test_legacy_token_without_iss_aud_only_during_transition(
    client, db_session, monkeypatch
):
    await S.register(db_session, "legacy@example.com", PASSWORD)
    user = await _user_by_email(db_session, "legacy@example.com")
    token = _sign(_base_claims(str(user.id)))
    headers = {"Authorization": f"Bearer {token}"}

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    monkeypatch.setattr(settings, "jwt_legacy_tokens_accepted_until", future)
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 200

    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    monkeypatch.setattr(settings, "jwt_legacy_tokens_accepted_until", past)
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 401

    monkeypatch.setattr(settings, "jwt_legacy_tokens_accepted_until", "")
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 401

    monkeypatch.setattr(settings, "jwt_legacy_tokens_accepted_until", "nu-e-o-data")
    assert (await client.get(f"{AUTH}/me", headers=headers)).status_code == 401


# --------------------------------------------------------------------------- #
# 4. Rotația refresh — FOR UPDATE
# --------------------------------------------------------------------------- #
async def test_rotate_refresh_locks_session_row(db_session):
    pair = await S.register(db_session, "race@example.com", PASSWORD)
    statements: list[str] = []

    def _capture(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    sync_engine = app_engine.sync_engine
    event.listen(sync_engine, "before_cursor_execute", _capture)
    try:
        await S.rotate_refresh(db_session, pair.refresh_token)
    finally:
        event.remove(sync_engine, "before_cursor_execute", _capture)

    locked = [
        s for s in statements
        if "FROM refresh_sessions" in s and "FOR UPDATE" in s
    ]
    assert locked, statements
    # Reutilizarea tokenului rotit rămâne refuzată.
    with pytest.raises(HTTPException) as exc:
        await S.rotate_refresh(db_session, pair.refresh_token)
    assert exc.value.status_code == 401


# --------------------------------------------------------------------------- #
# 5. Lockout per cont, admin pe /auth/login, refresh de admin 12h
# --------------------------------------------------------------------------- #
async def _fail_login(client, url: str, email: str, n: int) -> None:
    for _ in range(n):
        resp = await client.post(url, json={"email": email, "password": "Wrong-pass-1!"})
        assert resp.status_code == 401, resp.text


async def test_account_locks_after_repeated_failures(client, db_session, limits_on):
    await S.register(db_session, "lock_me@example.com", PASSWORD)
    await S.register(db_session, "other@example.com", PASSWORD)
    await _fail_login(client, f"{AUTH}/login", "lock_me@example.com", 5)

    # Chiar și cu parola corectă: blocat.
    resp = await client.post(
        f"{AUTH}/login", json={"email": "LOCK_ME@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 429
    # Alt cont, același IP: neafectat.
    resp = await client.post(
        f"{AUTH}/login", json={"email": "other@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200


async def test_lockout_applies_to_unknown_emails_too(client, limits_on):
    """Fără oracol: un email inexistent se comportă identic."""
    await _fail_login(client, f"{AUTH}/login", "ghost@example.com", 5)
    resp = await client.post(
        f"{AUTH}/login", json={"email": "ghost@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 429


async def test_lockout_shared_between_admin_and_user_login(
    client, db_session, limits_on
):
    await _make_admin(db_session, "boss@example.com")
    await _fail_login(client, f"{AUTH}/login", "boss@example.com", 3)
    await _fail_login(client, ADMIN_LOGIN, "boss@example.com", 2)
    resp = await client.post(
        ADMIN_LOGIN, json={"email": "boss@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 429


async def test_lockout_expires(client, db_session, limits_on, monkeypatch):
    await S.register(db_session, "expire@example.com", PASSWORD)
    monkeypatch.setattr(settings, "account_lockout_minutes", 1 / 60)  # 1 secundă
    await _fail_login(client, f"{AUTH}/login", "expire@example.com", 5)
    blocked = await client.post(
        f"{AUTH}/login", json={"email": "expire@example.com", "password": PASSWORD}
    )
    assert blocked.status_code == 429
    time.sleep(1.1)
    ok = await client.post(
        f"{AUTH}/login", json={"email": "expire@example.com", "password": PASSWORD}
    )
    assert ok.status_code == 200


async def test_success_resets_failure_counter(client, db_session, limits_on):
    await S.register(db_session, "reset@example.com", PASSWORD)
    await _fail_login(client, f"{AUTH}/login", "reset@example.com", 4)
    ok = await client.post(
        f"{AUTH}/login", json={"email": "reset@example.com", "password": PASSWORD}
    )
    assert ok.status_code == 200
    await _fail_login(client, f"{AUTH}/login", "reset@example.com", 4)
    ok = await client.post(
        f"{AUTH}/login", json={"email": "reset@example.com", "password": PASSWORD}
    )
    assert ok.status_code == 200


async def test_admin_cannot_login_through_public_login(client, db_session):
    admin = await _make_admin(db_session, "panel_only@example.com")
    count_q = select(func.count()).select_from(RefreshSession).where(
        RefreshSession.user_id == admin.id
    )
    before = await db_session.scalar(count_q)
    resp = await client.post(
        f"{AUTH}/login", json={"email": "panel_only@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 403
    # Login-ul refuzat nu lasă în urmă nicio sesiune de refresh.
    assert await db_session.scalar(count_q) == before
    resp = await client.post(
        ADMIN_LOGIN, json={"email": "panel_only@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200


async def test_admin_refresh_lifetime_is_capped(client, db_session):
    await _make_admin(db_session, "short@example.com")
    resp = await client.post(
        ADMIN_LOGIN, json={"email": "short@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200
    claims = jwt.get_unverified_claims(resp.json()["refresh_token"])
    max_secs = settings.admin_refresh_token_expire_hours * 3600
    assert claims["exp"] - claims["iat"] <= max_secs + 5

    # Rotația NU prelungește plafonul (același auth_time, același exp).
    rotated = await client.post(
        f"{AUTH}/refresh", json={"refresh_token": resp.json()["refresh_token"]}
    )
    assert rotated.status_code == 200
    new_claims = jwt.get_unverified_claims(rotated.json()["refresh_token"])
    assert new_claims["auth_time"] == claims["auth_time"]
    assert new_claims["exp"] <= claims["auth_time"] + max_secs + 1

    # Utilizator obișnuit: tot 7 zile.
    pair = await S.register(db_session, "long@example.com", PASSWORD)
    user_claims = jwt.get_unverified_claims(pair.refresh_token)
    assert user_claims["exp"] - user_claims["iat"] > max_secs


async def test_admin_session_older_than_cap_cannot_rotate(client, db_session):
    admin = await _make_admin(db_session, "stale_admin@example.com")
    now = datetime.now(timezone.utc)
    jti = uuid.uuid4().hex
    family = uuid.uuid4().hex
    token = create_refresh_token(
        str(admin.id),
        family_id=family,
        jti=jti,
        audience=settings.jwt_audience_admin,
        expires_at=now + timedelta(hours=1),
        auth_time=int((now - timedelta(hours=13)).timestamp()),
    )
    db_session.add(
        RefreshSession(
            user_id=admin.id,
            jti=jti,
            family_id=family,
            token_hash=hash_token(token),
            expires_at=now + timedelta(hours=1),
            revoked=False,
        )
    )
    await db_session.commit()

    resp = await client.post(f"{AUTH}/refresh", json={"refresh_token": token})
    assert resp.status_code == 401


# --------------------------------------------------------------------------- #
# 6. Rate limit pe /auth/google, /auth/apple, /auth/refresh
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize("provider", ["google", "apple"])
async def test_social_login_is_rate_limited(client, monkeypatch, provider):
    monkeypatch.setattr(settings, "social_auth_mode", "stub")
    monkeypatch.setattr(settings, "rate_limit_social_login_per_min", 2)
    ratelimit.enable_for_tests()
    try:
        codes = []
        for i in range(3):
            resp = await client.post(
                f"{AUTH}/{provider}", json={"id_token": f"stub:rl{i}@gmail.com"}
            )
            codes.append(resp.status_code)
    finally:
        ratelimit.disable_for_tests()
    assert codes[:2] == [200, 200], codes
    assert codes[2] == 429


async def test_refresh_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_refresh_per_min", 2)
    ratelimit.enable_for_tests()
    try:
        codes = [
            (
                await client.post(
                    f"{AUTH}/refresh", json={"refresh_token": "garbage"}
                )
            ).status_code
            for _ in range(3)
        ]
    finally:
        ratelimit.disable_for_tests()
    assert codes == [401, 401, 429]
