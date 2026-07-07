"""Teste pentru ramura LIVE a `auth_providers` (Google/Apple JWKS + OTP Twilio/Redis).

Totul rulează OFFLINE: nu se face niciun apel de rețea și nu se folosesc chei/coduri
reale. Mock-uim fetch-ul JWKS, clientul Redis și clientul HTTP Twilio (`httpx`).
Modul live se activează prin monkeypatch pe `settings`.
"""
from __future__ import annotations

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwt
from jose.backends import RSAKey
from jose.constants import ALGORITHMS

from app.services import auth_providers

pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# Utilitare: cheie RSA de test + JWKS + token semnat (fără chei reale)
# --------------------------------------------------------------------------- #

_TEST_KID = "test-key-1"
# O singură cheie RSA efemeră pe tot modulul (rapid, deterministă în cadrul rulării).
_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_PRIV_PEM = _RSA_KEY.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)


def _public_jwks() -> dict:
    """JWKS (set de chei publice) derivat din cheia RSA de test, cu `kid` cunoscut."""
    jwk = RSAKey(_RSA_KEY.public_key(), ALGORITHMS.RS256).to_dict()
    jwk["kid"] = _TEST_KID
    jwk["use"] = "sig"
    return {"keys": [jwk]}


def _sign_id_token(*, aud: str, iss: str, email: str = "user@example.com", sub: str = "sub-123") -> str:
    """Semnează un id_token RS256 cu cheia privată de test."""
    claims = {"aud": aud, "iss": iss, "email": email, "sub": sub}
    return jwt.encode(claims, _PRIV_PEM, algorithm="RS256", headers={"kid": _TEST_KID})


@pytest.fixture
def live_social(monkeypatch):
    """Activează modul social LIVE + client_id-uri de test + JWKS mock-uit."""
    monkeypatch.setattr(auth_providers.settings, "social_auth_mode", "live")
    monkeypatch.setattr(auth_providers.settings, "google_client_id", "google-client")
    monkeypatch.setattr(auth_providers.settings, "apple_client_id", "apple-client")

    async def _fake_fetch_jwks(url: str) -> dict:
        # Întoarce mereu cheia publică de test — nicio rețea.
        return _public_jwks()

    monkeypatch.setattr(auth_providers, "_fetch_jwks", _fake_fetch_jwks)


# --------------------------------------------------------------------------- #
# Google / Apple — verificare id_token LIVE
# --------------------------------------------------------------------------- #

async def test_verify_google_live_returns_email(live_social):
    token = _sign_id_token(
        aud="google-client",
        iss="https://accounts.google.com",
        email="Alice@Gmail.com",
    )
    result = await auth_providers.verify_google(token)
    assert result["sub"] == "sub-123"
    assert result["email"] == "alice@gmail.com"  # normalizat lowercase


async def test_verify_google_live_accepts_bare_issuer(live_social):
    # Google acceptă și issuer-ul fără schema `https://`.
    token = _sign_id_token(aud="google-client", iss="accounts.google.com")
    result = await auth_providers.verify_google(token)
    assert result["email"] == "user@example.com"


async def test_verify_google_live_wrong_audience_401(live_social):
    token = _sign_id_token(aud="ALT-client", iss="https://accounts.google.com")
    with pytest.raises(HTTPException) as exc:
        await auth_providers.verify_google(token)
    assert exc.value.status_code == 401


async def test_verify_google_live_wrong_issuer_401(live_social):
    token = _sign_id_token(aud="google-client", iss="https://evil.example.com")
    with pytest.raises(HTTPException) as exc:
        await auth_providers.verify_google(token)
    assert exc.value.status_code == 401


async def test_verify_apple_live_returns_email(live_social):
    token = _sign_id_token(
        aud="apple-client",
        iss="https://appleid.apple.com",
        email="bob@icloud.com",
        sub="apple-sub-9",
    )
    result = await auth_providers.verify_apple(token)
    assert result["sub"] == "apple-sub-9"
    assert result["email"] == "bob@icloud.com"


async def test_verify_apple_live_wrong_audience_401(live_social):
    # Token cu audience de Google → invalid pentru Apple.
    token = _sign_id_token(aud="google-client", iss="https://appleid.apple.com")
    with pytest.raises(HTTPException) as exc:
        await auth_providers.verify_apple(token)
    assert exc.value.status_code == 401


async def test_verify_google_live_garbage_token_401(live_social):
    with pytest.raises(HTTPException) as exc:
        await auth_providers.verify_google("not-a-jwt")
    assert exc.value.status_code == 401


# --------------------------------------------------------------------------- #
# OTP LIVE — Redis (in-memory fake) + Twilio (httpx fake)
# --------------------------------------------------------------------------- #

class _FakeRedis:
    """Client Redis async minimal, in-memory (set/get/delete cu suport `ex`)."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value
        if ex is not None:
            self.ttls[key] = ex

    async def get(self, key: str):
        return self.store.get(key)

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)
        self.ttls.pop(key, None)

    async def aclose(self) -> None:  # închiderea e no-op pentru fake
        pass


class _FakeResponse:
    def raise_for_status(self) -> None:
        pass


class _FakeHTTPClient:
    """Fake `httpx.AsyncClient` care înregistrează POST-ul Twilio, fără rețea."""

    calls: list[dict] = []

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        pass

    async def post(self, url, *, auth=None, data=None):
        _FakeHTTPClient.calls.append({"url": url, "auth": auth, "data": data})
        return _FakeResponse()


@pytest.fixture
def live_otp(monkeypatch):
    """Activează OTP LIVE + Redis fake + Twilio (httpx) fake + settings de test."""
    monkeypatch.setattr(auth_providers.settings, "otp_mode", "live")
    monkeypatch.setattr(auth_providers.settings, "otp_ttl_seconds", 300)
    monkeypatch.setattr(auth_providers.settings, "redis_url", "redis://fake:6379/0")
    monkeypatch.setattr(auth_providers.settings, "twilio_account_sid", "AC_test")
    monkeypatch.setattr(auth_providers.settings, "twilio_auth_token", "tok_test")
    monkeypatch.setattr(auth_providers.settings, "twilio_from", "+10000000000")

    fake = _FakeRedis()
    monkeypatch.setattr(auth_providers, "_get_redis", lambda: fake)

    _FakeHTTPClient.calls = []
    monkeypatch.setattr(auth_providers.httpx, "AsyncClient", _FakeHTTPClient)

    return fake


async def test_request_otp_live_stores_and_sends_sms(live_otp):
    phone = "+40712345678"
    await auth_providers.request_otp(phone)

    key = auth_providers._OTP_REDIS_PREFIX + phone
    stored = live_otp.store.get(key)
    assert stored is not None
    assert stored.isdigit() and len(stored) == 6      # cod numeric de 6 cifre
    assert live_otp.ttls[key] == 300                  # TTL setat din settings

    # SMS-ul Twilio a fost „trimis" prin httpx-ul fake, cu auth și payload corect.
    assert len(_FakeHTTPClient.calls) == 1
    call = _FakeHTTPClient.calls[0]
    assert "AC_test" in call["url"] and call["url"].endswith("/Messages.json")
    assert call["auth"] == ("AC_test", "tok_test")
    assert call["data"]["From"] == "+10000000000"
    assert call["data"]["To"] == phone
    assert stored in call["data"]["Body"]


async def test_verify_otp_live_correct_wrong_and_single_use(live_otp):
    phone = "+40799999999"
    await auth_providers.request_otp(phone)
    code = live_otp.store[auth_providers._OTP_REDIS_PREFIX + phone]

    # Cod greșit → False (codul rămâne valid).
    assert await auth_providers.verify_otp(phone, "000000" if code != "000000" else "111111") is False

    # Cod corect → True.
    assert await auth_providers.verify_otp(phone, code) is True

    # Single-use: al doilea apel cu același cod → False (consumat din Redis).
    assert await auth_providers.verify_otp(phone, code) is False


async def test_verify_otp_live_unknown_phone_false(live_otp):
    assert await auth_providers.verify_otp("+40700000000", "123456") is False
