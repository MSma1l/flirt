"""Cazuri limită de securitate: auth guards, tipuri de token, izolarea chat-ului."""
from datetime import date, datetime, timedelta, timezone

import pytest
from jose import JWTError, jwt

from app.core.security import decode_token
from tests.conftest import upload_photo

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register_raw(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    """Înregistrează un user și întoarce răspunsul JSON complet (cu ambele tokenuri)."""
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _register(client, email: str) -> dict:
    """Headerele Bearer pentru un user nou."""
    data = await _register_raw(client, email)
    return {"Authorization": f"Bearer {_extract_token(data)}"}


async def _me_id(client, headers: dict) -> str:
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "street": None,
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    # Un profil fără poze nu apare în feedul nimănui (principiu al
    # aplicației) — anketa singură nu e de ajuns. Al doilea pas, exact ca în
    # aplicația reală: PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


# --- Rute protejate fără / cu token invalid ----------------------------------
@pytest.mark.asyncio
async def test_protected_route_without_token_is_401(client):
    """Fără header Authorization → 401 pe o rută protejată."""
    resp = await client.get(f"{API}/auth/me")
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_protected_route_with_invalid_token_is_401(client):
    """Token invalid sau trunchiat → 401 (nu 500)."""
    # Token complet aiurea.
    resp = await client.get(
        f"{API}/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert resp.status_code == 401, resp.text

    # Token valid ca formă, dar trunchiat (semnătură ruptă).
    good = await _register(client, "trunc@example.com")
    truncated = good["Authorization"][:-6]  # tăiem câteva caractere din semnătură
    resp = await client.get(f"{API}/auth/me", headers={"Authorization": truncated})
    assert resp.status_code == 401, resp.text


# --- Refresh cu token de tip greșit ------------------------------------------
@pytest.mark.asyncio
async def test_refresh_rejects_access_token(client):
    """Refresh cu un access token (type='access') → respins (401)."""
    data = await _register_raw(client, "typemix@example.com")
    access = _extract_token(data)
    assert access

    resp = await client.post(f"{API}/auth/refresh", json={"refresh_token": access})
    assert resp.status_code == 401, resp.text


# --- decode_token respinge o cheie străină -----------------------------------
def test_decode_token_rejects_foreign_key():
    """Un token semnat cu ALTĂ cheie privată → JWTError la decode_token."""
    # Cheie RSA străină, complet diferită de cea din test/settings.
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    foreign_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    foreign_pem = foreign_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()

    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": "00000000-0000-0000-0000-000000000000",
            "iat": now,
            "exp": now + timedelta(minutes=15),
            "type": "access",
        },
        foreign_pem,
        algorithm="RS256",
    )

    with pytest.raises(JWTError):
        decode_token(token)


# --- Izolarea chat-ului: non-participant nu accesează mesajele ---------------
@pytest.mark.asyncio
async def test_non_participant_cannot_read_chat_messages(client):
    """Un user care nu e în chat nu poate citi mesajele → 404/403."""
    a_headers, a_id = await _make_user(client, "a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "b@example.com", "Bob")

    # A și B fac match → apare un chat.
    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    chat_id = resp.json()["chat_id"]
    assert chat_id is not None

    # Un al treilea user, complet străin de chat.
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=c_headers)
    assert resp.status_code in (403, 404), resp.text

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "intrus"},
        headers=c_headers,
    )
    assert resp.status_code in (403, 404), resp.text
