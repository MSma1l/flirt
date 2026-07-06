"""Teste pentru modulul de anketă/profil (rulează pe SQLite in-memory)."""
from datetime import date

import pytest

API = "/api/v1"


def _extract_token(payload: dict) -> str | None:
    """Extrage un access token din răspunsuri de forme uzuale."""
    if not isinstance(payload, dict):
        return None
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    # Uneori token-ul e imbricat (ex: {"tokens": {...}} sau {"data": {...}})
    for nested in ("tokens", "data", "auth"):
        if isinstance(payload.get(nested), dict):
            token = _extract_token(payload[nested])
            if token:
                return token
    return None


async def _auth_headers(client) -> dict[str, str]:
    """Înregistrează un user și întoarce headerele cu Bearer token."""
    email = "user_anketa@example.com"
    password = "Str0ng-Passw0rd!"
    body = {"email": email, "password": password}

    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())

    # Dacă register nu întoarce direct token-ul, încearcă login.
    if token is None:
        resp = await client.post(f"{API}/auth/login", json=body)
        assert resp.status_code == 200, resp.text
        token = _extract_token(resp.json())

    assert token, "Nu am putut obține un access token din modulul auth."
    return {"Authorization": f"Bearer {token}"}


def _valid_anketa() -> dict:
    """O anketă validă (vârstă peste minim, toate câmpurile obligatorii)."""
    return {
        "name": "Ivan",
        "birth_date": "2000-01-01",
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "street": "Str. Florilor",
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": "Îmi place să călătoresc.",
        "dating_statuses": ["serious", "friendship"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


@pytest.mark.asyncio
async def test_reference_public_non_empty(client):
    """GET /reference este public și întoarce liste ne-goale."""
    resp = await client.get(f"{API}/profiles/reference")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data["genders"]) > 0
    assert len(data["interests"]) > 0
    assert len(data["dating_statuses"]) > 0
    # interesele au slug + etichete
    assert "slug" in data["interests"][0]


@pytest.mark.asyncio
async def test_upsert_and_get_me(client):
    """PUT /me cu anketă validă → 200 completed; apoi GET /me întoarce datele."""
    headers = await _auth_headers(client)

    resp = await client.put(
        f"{API}/profiles/me", json=_valid_anketa(), headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["completed"] is True
    assert data["name"] == "Ivan"
    assert data["age"] >= 16
    assert set(data["interests"]) == {"sport", "travel"}

    resp = await client.get(f"{API}/profiles/me", headers=headers)
    assert resp.status_code == 200, resp.text
    got = resp.json()
    assert got["city"] == "Chișinău"
    assert got["languages"] == ["ru", "ro"]
    assert got["completed"] is True


@pytest.mark.asyncio
async def test_get_me_before_anketa_is_404(client):
    """GET /me înainte de completarea anketei → 404."""
    headers = await _auth_headers(client)
    resp = await client.get(f"{API}/profiles/me", headers=headers)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_underage_rejected(client):
    """Vârstă sub minimul de înregistrare → 422."""
    headers = await _auth_headers(client)
    body = _valid_anketa()
    # născut acum ~10 ani → sub 16
    body["birth_date"] = date(date.today().year - 10, 1, 1).isoformat()

    resp = await client.put(f"{API}/profiles/me", json=body, headers=headers)
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_about_too_long_rejected(client):
    """about peste 500 de caractere → 422."""
    headers = await _auth_headers(client)
    body = _valid_anketa()
    body["about"] = "x" * 501

    resp = await client.put(f"{API}/profiles/me", json=body, headers=headers)
    assert resp.status_code == 422, resp.text
