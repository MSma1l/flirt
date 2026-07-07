"""Teste pentru modulul de autentificare (rulează pe SQLite via fixtura `client`)."""
import pytest
from httpx import AsyncClient

from app.core.config import settings

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/auth"


async def _register(client: AsyncClient, email: str, password: str = "supersecret123"):
    return await client.post(
        f"{BASE}/register", json={"email": email, "password": password}
    )


async def test_register_returns_201_and_tokens(client: AsyncClient):
    resp = await _register(client, "alice@example.com")
    assert resp.status_code == 201
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_register_duplicate_returns_409(client: AsyncClient):
    await _register(client, "bob@example.com")
    resp = await _register(client, "bob@example.com")
    assert resp.status_code == 409


async def test_login_correct_and_wrong(client: AsyncClient):
    await _register(client, "carol@example.com", "password12345")

    ok = await client.post(
        f"{BASE}/login",
        json={"email": "carol@example.com", "password": "password12345"},
    )
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    bad = await client.post(
        f"{BASE}/login",
        json={"email": "carol@example.com", "password": "wrong-password"},
    )
    assert bad.status_code == 401


async def test_me_with_and_without_token(client: AsyncClient):
    reg = await _register(client, "dave@example.com")
    access = reg.json()["access_token"]

    ok = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert ok.status_code == 200
    assert ok.json()["email"] == "dave@example.com"

    unauth = await client.get(f"{BASE}/me")
    assert unauth.status_code == 401


async def test_refresh_returns_new_tokens(client: AsyncClient):
    reg = await _register(client, "erin@example.com")
    refresh_token = reg.json()["refresh_token"]

    resp = await client.post(
        f"{BASE}/refresh", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    # Noul refresh token trebuie să difere de cel folosit.
    assert body["refresh_token"] != refresh_token


async def test_refresh_reuse_detection(client: AsyncClient):
    reg = await _register(client, "frank@example.com")
    refresh_token = reg.json()["refresh_token"]

    # Prima utilizare: OK, rotește token-ul.
    first = await client.post(
        f"{BASE}/refresh", json={"refresh_token": refresh_token}
    )
    assert first.status_code == 200

    # A doua utilizare a ACELUIAȘI token: reuse detectat → 401.
    second = await client.post(
        f"{BASE}/refresh", json={"refresh_token": refresh_token}
    )
    assert second.status_code == 401


async def _assert_token_pair(body: dict) -> None:
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_google_stub_login_and_me(client: AsyncClient):
    # În modul stub tokenul de test ESTE emailul (sau `stub:{email}`).
    resp = await client.post(
        f"{BASE}/google", json={"id_token": "stub:heidi@gmail.com"}
    )
    assert resp.status_code == 200
    body = resp.json()
    await _assert_token_pair(body)

    # Userul nou-creat poate accesa ruta protejată /me.
    me = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["profile_completed"] is False


async def test_google_stub_login_is_idempotent(client: AsyncClient):
    # Aceeași identitate → get-or-create: același user, autentificări repetate OK.
    first = await client.post(f"{BASE}/google", json={"id_token": "ivan@gmail.com"})
    second = await client.post(f"{BASE}/google", json={"id_token": "ivan@gmail.com"})
    assert first.status_code == 200
    assert second.status_code == 200


async def test_apple_stub_login_and_me(client: AsyncClient):
    resp = await client.post(f"{BASE}/apple", json={"id_token": "judy@icloud.com"})
    assert resp.status_code == 200
    body = resp.json()
    await _assert_token_pair(body)

    me = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


async def test_phone_request_then_verify(client: AsyncClient):
    phone = "+40712345678"

    req = await client.post(f"{BASE}/phone/request", json={"phone": phone})
    assert req.status_code == 204

    ver = await client.post(
        f"{BASE}/phone/verify",
        json={"phone": phone, "code": settings.otp_test_code},
    )
    assert ver.status_code == 200
    body = ver.json()
    await _assert_token_pair(body)

    me = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200


async def test_phone_verify_wrong_code_returns_401(client: AsyncClient):
    phone = "+40799999999"

    req = await client.post(f"{BASE}/phone/request", json={"phone": phone})
    assert req.status_code == 204

    bad = await client.post(
        f"{BASE}/phone/verify",
        json={"phone": phone, "code": "999999" if settings.otp_test_code != "999999" else "111111"},
    )
    assert bad.status_code == 401


async def test_logout_revokes_session(client: AsyncClient):
    reg = await _register(client, "grace@example.com")
    refresh_token = reg.json()["refresh_token"]

    out = await client.post(
        f"{BASE}/logout", json={"refresh_token": refresh_token}
    )
    assert out.status_code == 204

    # După logout, refresh-ul trebuie respins.
    resp = await client.post(
        f"{BASE}/refresh", json={"refresh_token": refresh_token}
    )
    assert resp.status_code == 401
