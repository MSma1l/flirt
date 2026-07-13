"""Teste de regresie pentru întărirea securității (AUTH / CONFIG / RATE-LIMITING).

Acoperă:
  1. Guard-ul de producție (stub / debug / CORS wildcard).
  2. Rate limiting pe endpoint-urile de auth (429 după prag).
  3. Anti brute-force OTP (invalidarea codului după `otp_max_attempts`).
  4. Cooldown cereri OTP (`otp_request_per_hour`).
  5. Anti user-enumeration la login (timing/răspuns uniform).
  6. JWKS strict (kid necunoscut → respins, fără fallback pe prima cheie).

Rulează OFFLINE, pe SQLite, fără chei/coduri reale.
"""
from __future__ import annotations

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from httpx import AsyncClient
from jose import jwt
from jose.backends import RSAKey
from jose.constants import ALGORITHMS
from pydantic import ValidationError

from app.core import ratelimit
from app.core.config import Settings
from app.services import auth_providers

# Marchez explicit doar testele async (mai jos), ca cele sync — guard-ul de config —
# să nu primească inutil marca asyncio.
_aio = pytest.mark.asyncio

BASE = "/api/v1/auth"

# Chei PEM „reale" nu sunt necesare — guard-ul verifică doar că nu-s goale.
_FAKE_PRIV = "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----"
_FAKE_PUB = "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"


def _prod_kwargs(**overrides):
    """Configurare de producție VALIDĂ: integrări live + CHEILE pe care le cer.

    Guard-ul verifică acum și cheile, nu doar modul: `storage_provider="s3"` cu
    `S3_BUCKET` gol trecea înainte și crăpa abia la primul upload, în producție.
    """
    base = dict(
        environment="production",
        postgres_password="a-strong-secret",
        jwt_private_key=_FAKE_PRIV,
        jwt_public_key=_FAKE_PUB,
        database_url="",
        social_auth_mode="live",
        google_client_id="123.apps.googleusercontent.com",
        apple_client_id="md.flirt.app",
        otp_mode="live",
        redis_url="redis://redis:6379/0",
        twilio_account_sid="AC_test",
        twilio_auth_token="tok_test",
        twilio_from="+37312345678",
        billing_provider="stripe",
        stripe_secret_key="sk_test",
        face_verify_provider="rekognition",
        storage_provider="s3",
        s3_bucket="flirt-media",
        s3_region="eu-central-1",
        aws_access_key_id="AKIA_test",
        aws_secret_access_key="secret_test",
        push_provider="expo",
        geo_provider="nominatim",
        geo_user_agent="FLIRT/1.0 (contact@flrt.md)",
        debug=False,
        cors_origins="https://app.flirt.example",
    )
    base.update(overrides)
    return base


# --------------------------------------------------------------------------- #
# 1. Guard de producție
# --------------------------------------------------------------------------- #

def test_production_all_live_ok():
    s = Settings(**_prod_kwargs())
    assert s.environment == "production"


@pytest.mark.parametrize(
    "override",
    [
        {"social_auth_mode": "stub"},
        {"otp_mode": "stub"},
        {"billing_provider": "stub"},
        {"face_verify_provider": "stub"},
        {"storage_provider": "stub"},
        {"push_provider": "stub"},
        {"geo_provider": "stub"},          # lipsea din guard: geocoder fals în prod
        {"s3_bucket": ""},                 # provider live, cheie goală
        {"twilio_auth_token": ""},         # idem
        {"debug": True},
        {"cors_origins": "https://app.flirt.example,*"},
    ],
)
def test_production_unsafe_raises(override):
    with pytest.raises(ValidationError):
        Settings(**_prod_kwargs(**override))


# --------------------------------------------------------------------------- #
# 2. Rate limiting
# --------------------------------------------------------------------------- #

@pytest.fixture
def rate_limit_on():
    """Reactivează rate limiting-ul sub pytest și golește store-ul după test."""
    ratelimit.enable_for_tests()
    yield
    ratelimit.disable_for_tests()


@_aio
async def test_login_rate_limited_after_threshold(client: AsyncClient, rate_limit_on, monkeypatch):
    # Prag mic și determinist.
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 3)

    reg = await client.post(
        f"{BASE}/register", json={"email": "rl@example.com", "password": "password12345"}
    )
    assert reg.status_code == 201

    payload = {"email": "rl@example.com", "password": "password12345"}
    statuses = [
        (await client.post(f"{BASE}/login", json=payload)).status_code for _ in range(5)
    ]
    # Primele 3 trec (200), restul sunt respinse cu 429.
    assert statuses[:3] == [200, 200, 200]
    assert 429 in statuses[3:]


@_aio
async def test_register_rate_limited_after_threshold(client: AsyncClient, rate_limit_on, monkeypatch):
    monkeypatch.setattr(ratelimit.settings, "rate_limit_register_per_hour", 2)

    statuses = []
    for i in range(4):
        resp = await client.post(
            f"{BASE}/register",
            json={"email": f"reg{i}@example.com", "password": "password12345"},
        )
        statuses.append(resp.status_code)
    assert statuses[:2] == [201, 201]
    assert 429 in statuses[2:]


@_aio
async def test_rate_limit_disabled_does_not_throttle(client: AsyncClient, monkeypatch):
    # Fără `rate_limit_on`: sub pytest limitarea e inactivă → nicio respingere.
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 1)
    await client.post(
        f"{BASE}/register", json={"email": "free@example.com", "password": "password12345"}
    )
    payload = {"email": "free@example.com", "password": "password12345"}
    for _ in range(5):
        resp = await client.post(f"{BASE}/login", json=payload)
        assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# 3. Anti brute-force OTP (stub)
# --------------------------------------------------------------------------- #

@_aio
async def test_otp_invalidated_after_max_attempts(monkeypatch):
    auth_providers.reset_stub_otp_state()
    monkeypatch.setattr(auth_providers.settings, "otp_mode", "stub")
    monkeypatch.setattr(auth_providers.settings, "otp_max_attempts", 3)

    phone = "+40711111111"
    await auth_providers.request_otp(phone)
    good = auth_providers.settings.otp_test_code
    wrong = "999999" if good != "999999" else "111111"

    # `otp_max_attempts` încercări greșite.
    for _ in range(3):
        assert await auth_providers.verify_otp(phone, wrong) is False

    # Codul a fost invalidat: nici cel corect nu mai merge.
    assert await auth_providers.verify_otp(phone, good) is False


@_aio
async def test_otp_correct_still_works_before_max(monkeypatch):
    auth_providers.reset_stub_otp_state()
    monkeypatch.setattr(auth_providers.settings, "otp_mode", "stub")
    monkeypatch.setattr(auth_providers.settings, "otp_max_attempts", 3)

    phone = "+40722222222"
    await auth_providers.request_otp(phone)
    good = auth_providers.settings.otp_test_code
    wrong = "999999" if good != "999999" else "111111"

    assert await auth_providers.verify_otp(phone, wrong) is False  # 1 greșeală
    assert await auth_providers.verify_otp(phone, good) is True     # încă valid


# --------------------------------------------------------------------------- #
# 4. Cooldown cereri OTP (stub)
# --------------------------------------------------------------------------- #

@_aio
async def test_otp_request_cooldown(monkeypatch):
    auth_providers.reset_stub_otp_state()
    monkeypatch.setattr(auth_providers.settings, "otp_mode", "stub")
    monkeypatch.setattr(auth_providers.settings, "otp_request_per_hour", 2)

    phone = "+40733333333"
    await auth_providers.request_otp(phone)
    await auth_providers.request_otp(phone)
    with pytest.raises(HTTPException) as exc:
        await auth_providers.request_otp(phone)
    assert exc.value.status_code == 429


# --------------------------------------------------------------------------- #
# 5. Anti user-enumeration (răspuns uniform)
# --------------------------------------------------------------------------- #

@_aio
async def test_login_unknown_vs_wrong_password_uniform(client: AsyncClient):
    await client.post(
        f"{BASE}/register", json={"email": "u1@example.com", "password": "password12345"}
    )
    wrong = await client.post(
        f"{BASE}/login", json={"email": "u1@example.com", "password": "nope-nope-1234"}
    )
    unknown = await client.post(
        f"{BASE}/login", json={"email": "ghost@example.com", "password": "nope-nope-1234"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


# --------------------------------------------------------------------------- #
# 6. JWKS strict (kid necunoscut → respins)
# --------------------------------------------------------------------------- #

_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIV_PEM = _RSA_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)


def _jwks_with_kid(kid: str) -> dict:
    jwk = RSAKey(_RSA_KEY.public_key(), ALGORITHMS.RS256).to_dict()
    jwk["kid"] = kid
    jwk["use"] = "sig"
    return {"keys": [jwk]}


@_aio
async def test_jwks_unknown_kid_rejected(monkeypatch):
    monkeypatch.setattr(auth_providers.settings, "social_auth_mode", "live")
    monkeypatch.setattr(auth_providers.settings, "google_client_id", "google-client")

    # JWKS conține DOAR o cheie cu alt `kid` decât cel din token.
    async def _fake_fetch(url: str) -> dict:
        return _jwks_with_kid("server-kid")

    monkeypatch.setattr(auth_providers, "_fetch_jwks", _fake_fetch)

    token = jwt.encode(
        {"aud": "google-client", "iss": "https://accounts.google.com", "sub": "s1"},
        _PRIV_PEM,
        algorithm="RS256",
        headers={"kid": "token-kid"},  # kid inexistent în JWKS
    )
    with pytest.raises(HTTPException) as exc:
        await auth_providers.verify_google(token)
    assert exc.value.status_code == 401
