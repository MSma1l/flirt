"""Teste pentru scheletele de integrare externă în modul STUB (fără rețea).

Acoperă serviciile reale: geo, storage, auth_providers, billing, push. Importă
serviciile direct și folosește `client` acolo unde fluxul e HTTP.
"""
import uuid
from datetime import datetime, timezone

import pytest

from app.core.config import settings
from app.services import auth_providers, billing, geo, push, storage
from app.services.storage import StubStorage, get_storage

API = "/api/v1"


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


# --- Geo ---------------------------------------------------------------------
def test_haversine_symmetry_and_identity():
    """`haversine_km` e simetrică și dă 0 pe punct identic."""
    # Punct identic → 0.
    assert geo.haversine_km(47.0, 28.0, 47.0, 28.0) == pytest.approx(0.0)
    # Simetrie: d(A,B) == d(B,A).
    d_ab = geo.haversine_km(47.0105, 28.8638, 44.4268, 26.1025)
    d_ba = geo.haversine_km(44.4268, 26.1025, 47.0105, 28.8638)
    assert d_ab == pytest.approx(d_ba)
    assert d_ab > 0


@pytest.mark.asyncio
async def test_distance_km_between_known_and_unknown_cities():
    """Distanță între orașe cunoscute > 0; oraș necunoscut → None."""
    known = await geo.distance_km_between("Chișinău", None, "București", None)
    assert known is not None
    assert known > 0

    unknown = await geo.distance_km_between("Chișinău", None, "Necunoscutopol", None)
    assert unknown is None


# --- Storage -----------------------------------------------------------------
@pytest.mark.asyncio
async def test_stub_storage_save_returns_base_url():
    """`StubStorage.save` întoarce un URL care conține `storage_base_url`."""
    url = await StubStorage().save("poza.jpg", b"binary", "image/jpeg")
    assert settings.storage_base_url in url
    assert url.endswith("poza.jpg")


def test_get_storage_stub_and_unknown_provider(monkeypatch):
    """`get_storage()` întoarce StubStorage; provider necunoscut → NotImplementedError."""
    assert isinstance(get_storage(), StubStorage)

    monkeypatch.setattr(storage.settings, "storage_provider", "dropbox")
    with pytest.raises(NotImplementedError):
        get_storage()


# --- Auth providers ----------------------------------------------------------
@pytest.mark.asyncio
async def test_social_stub_returns_email():
    """`verify_google`/`verify_apple` în stub întorc emailul din tokenul de test."""
    claims_g = await auth_providers.verify_google("stub:ion@example.com")
    assert claims_g["email"] == "ion@example.com"

    claims_a = await auth_providers.verify_apple("maria@example.com")
    assert claims_a["email"] == "maria@example.com"


@pytest.mark.asyncio
async def test_otp_request_verify_correct_and_wrong_code():
    """OTP: request + verify cu codul de test → True; cod greșit → False."""
    phone = "+37360000000"
    await auth_providers.request_otp(phone)

    # Cod greșit → False (nu consumă codul valid).
    assert await auth_providers.verify_otp(phone, "999999") is False
    # Cod corect (cel de test) → True.
    assert await auth_providers.verify_otp(phone, settings.otp_test_code) is True
    # După consum (single-use) codul nu mai e valid.
    assert await auth_providers.verify_otp(phone, settings.otp_test_code) is False


# --- Billing -----------------------------------------------------------------
@pytest.mark.asyncio
async def test_entitlements_reflect_purchased_plan_and_expiry(client):
    """`entitlements` reflectă planul cumpărat; `purchase` setează expires_at în viitor."""
    headers = await _register(client, "billing@example.com")

    # Înainte de cumpărare: fără drepturi.
    before = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert before.json() == {"premium": False, "no_ads": False, "ai_bot": False}

    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "ai_bot"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    sub = resp.json()
    assert sub["expires_at"] is not None

    # expires_at trebuie să fie în viitor.
    expires = datetime.fromisoformat(sub["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    assert expires > datetime.now(timezone.utc)

    # Entitlements reflectă exact planul ai_bot.
    after = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert after.json() == {"premium": False, "no_ads": False, "ai_bot": True}


# --- Push --------------------------------------------------------------------
@pytest.mark.asyncio
async def test_register_device_is_idempotent(client, db_session):
    """`register_device` e idempotent: același token de 2 ori → un singur rând."""
    from sqlalchemy import func, select

    from app.models.device import PushDevice
    from app.models.user import User

    headers = await _register(client, "push@example.com")
    # Recuperăm userul din DB ca să apelăm serviciul direct.
    me = await client.get(f"{API}/auth/me", headers=headers)
    user = await db_session.get(User, uuid.UUID(me.json()["id"]))

    await push.register_device(db_session, user, "device-token-A", "ios")
    # Al doilea apel cu același token → upsert, doar schimbă platforma.
    await push.register_device(db_session, user, "device-token-A", "android")

    count = await db_session.scalar(
        select(func.count())
        .select_from(PushDevice)
        .where(PushDevice.user_id == user.id, PushDevice.token == "device-token-A")
    )
    assert count == 1, "Același token nu trebuie să creeze rânduri duplicate."
