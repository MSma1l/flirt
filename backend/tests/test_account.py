"""Teste pentru modulul cont/setări (rulează pe SQLite in-memory, TZ secț. 6)."""
from datetime import date, datetime

import pytest

from app.core.config import settings

API = "/api/v1"

# An determinist pentru un profil adult (~25 ani).
_ADULT_YEAR = date.today().year - 25


def _anketa(name: str) -> dict:
    """O anketă validă minimă pentru completarea profilului."""
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
        "interests": ["sport"],
        "photos": [],
    }


def _extract_token(payload: dict) -> str | None:
    """Extrage un access token din răspunsuri de forme uzuale."""
    if not isinstance(payload, dict):
        return None
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    for nested in ("tokens", "data", "auth"):
        if isinstance(payload.get(nested), dict):
            token = _extract_token(payload[nested])
            if token:
                return token
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    """Înregistrează un user și întoarce headerele cu Bearer token."""
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    if token is None:
        resp = await client.post(f"{API}/auth/login", json=body)
        assert resp.status_code == 200, resp.text
        token = _extract_token(resp.json())
    assert token, "Nu am putut obține un access token."
    return {"Authorization": f"Bearer {token}"}


async def _me_id(client, headers: dict) -> str:
    """Id-ul userului curent."""
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


# --- Setări ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_settings_default_then_update(client):
    """GET întoarce valorile implicite; PUT le schimbă și persistă."""
    headers = await _register(client, "s@example.com")

    resp = await client.get(f"{API}/settings/", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Raza implicită vine din config, nu hardcodat.
    assert data["search_radius_km"] == settings.search_radius_default_km
    # Toate notificările pornite implicit.
    assert data["notifications"], "Ar trebui să existe flag-uri de notificări."
    assert all(v is True for v in data["notifications"].values())

    # Schimbăm tema și raza.
    new_radius = settings.search_radius_default_km + 25
    resp = await client.put(
        f"{API}/settings/",
        json={"theme": "dark", "search_radius_km": new_radius},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    updated = resp.json()
    assert updated["theme"] == "dark"
    assert updated["search_radius_km"] == new_radius

    # Persistă între cereri.
    resp = await client.get(f"{API}/settings/", headers=headers)
    data = resp.json()
    assert data["theme"] == "dark"
    assert data["search_radius_km"] == new_radius


# --- Favorite ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_favorites_add_list_remove(client):
    """POST adaugă un favorit, GET îl conține, DELETE îl scoate."""
    a_headers = await _register(client, "fa@example.com")
    b_headers = await _register(client, "fb@example.com")
    b_id = await _me_id(client, b_headers)

    resp = await client.post(
        f"{API}/social/favorites",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    resp = await client.get(f"{API}/social/favorites", headers=a_headers)
    assert resp.status_code == 200, resp.text
    ids = {f["target_user_id"] for f in resp.json()}
    assert b_id in ids

    resp = await client.delete(
        f"{API}/social/favorites/{b_id}", headers=a_headers
    )
    assert resp.status_code == 204, resp.text

    resp = await client.get(f"{API}/social/favorites", headers=a_headers)
    ids = {f["target_user_id"] for f in resp.json()}
    assert b_id not in ids


# --- Black list --------------------------------------------------------------
@pytest.mark.asyncio
async def test_blocks_add_list_remove(client):
    """POST blochează, GET conține, DELETE deblochează."""
    a_headers = await _register(client, "ba@example.com")
    b_headers = await _register(client, "bb@example.com")
    b_id = await _me_id(client, b_headers)

    resp = await client.post(
        f"{API}/social/blocks",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    resp = await client.get(f"{API}/social/blocks", headers=a_headers)
    assert resp.status_code == 200, resp.text
    ids = {b["blocked_id"] for b in resp.json()}
    assert b_id in ids

    resp = await client.delete(f"{API}/social/blocks/{b_id}", headers=a_headers)
    assert resp.status_code == 204, resp.text

    resp = await client.get(f"{API}/social/blocks", headers=a_headers)
    ids = {b["blocked_id"] for b in resp.json()}
    assert b_id not in ids


# --- Bilet Flirt Party -------------------------------------------------------
@pytest.mark.asyncio
async def test_ticket_is_idempotent(client):
    """Primul GET emite un cod ne-gol; al doilea întoarce ACELAȘI cod."""
    headers = await _register(client, "t@example.com")

    resp = await client.get(f"{API}/ticket/", headers=headers)
    assert resp.status_code == 200, resp.text
    first = resp.json()
    assert first["code"], "Codul biletului nu trebuie să fie gol."
    assert first["used"] is False

    resp = await client.get(f"{API}/ticket/", headers=headers)
    assert resp.status_code == 200, resp.text
    second = resp.json()
    assert second["code"] == first["code"], "Biletul trebuie să fie idempotent."


# --- Ștergere cont -----------------------------------------------------------
@pytest.mark.asyncio
async def test_account_deletion_and_cancel(client):
    """delete → purge_after ≈ requested_at + grace zile; cancel → 204."""
    headers = await _register(client, "d@example.com")

    resp = await client.post(f"{API}/settings/account/delete", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    requested_at = datetime.fromisoformat(data["requested_at"])
    purge_after = datetime.fromisoformat(data["purge_after"])
    delta_days = (purge_after - requested_at).total_seconds() / 86400
    assert abs(delta_days - settings.account_deletion_grace_days) < 0.01

    resp = await client.post(
        f"{API}/settings/account/delete/cancel", headers=headers
    )
    assert resp.status_code == 204, resp.text


@pytest.mark.asyncio
async def test_account_deletion_revokes_sessions_and_hides_profile(client):
    """I4: ștergerea contului revocă sesiunile de refresh și ascunde profilul."""
    # Viewer A (profil complet) — ca să verificăm dispariția din feed.
    a_body = {"email": "viewer@example.com", "password": "Str0ng-Passw0rd!"}
    a_resp = await client.post(f"{API}/auth/register", json=a_body)
    a_headers = {"Authorization": f"Bearer {a_resp.json()['access_token']}"}
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa("Viewer"), headers=a_headers
    )
    assert resp.status_code == 200, resp.text

    # Userul D care își va șterge contul (profil complet + refresh token).
    d_body = {"email": "delete-me@example.com", "password": "Str0ng-Passw0rd!"}
    d_resp = await client.post(f"{API}/auth/register", json=d_body)
    d_tokens = d_resp.json()
    d_refresh = d_tokens["refresh_token"]
    d_headers = {"Authorization": f"Bearer {d_tokens['access_token']}"}
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa("DeleteMe"), headers=d_headers
    )
    assert resp.status_code == 200, resp.text
    d_id = await _me_id(client, d_headers)

    # Înainte de ștergere: D e vizibil în feed-ul lui A.
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert d_id in {c["user_id"] for c in resp.json()}

    # D cere ștergerea contului.
    resp = await client.post(f"{API}/settings/account/delete", headers=d_headers)
    assert resp.status_code == 200, resp.text

    # Sesiunile de refresh sunt revocate → refresh-ul e respins.
    resp = await client.post(
        f"{API}/auth/refresh", json={"refresh_token": d_refresh}
    )
    assert resp.status_code == 401, resp.text

    # Profilul e ascuns → D nu mai apare în feed-ul lui A.
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert d_id not in {c["user_id"] for c in resp.json()}

    # Setările reflectă profile_hidden=True (creat dacă lipsea).
    resp = await client.get(f"{API}/settings/", headers=d_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["profile_hidden"] is True
