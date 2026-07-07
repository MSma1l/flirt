"""Teste de regresie de securitate pentru upload/poze (pentest fixes).

Acoperă: allowlist content-type + magic-bytes (anti stored-XSS), limită dimensiune,
URL-uri de poze https + validare listă/lungime, anti-HTML pe text (anti-XSS stocat).
"""
import base64
from datetime import date

import pytest

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25

# PNG 1x1 valid (recunoscut de imghdr și PIL).
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _token(payload: dict) -> str:
    for k in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(k), str):
            return payload[k]
    raise AssertionError("no token")


def _anketa(name: str, photos=None) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "languages": ["ro"],
        "about": "Salut.",
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": photos if photos is not None else [],
    }


async def _make_user(client, email: str):
    r = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Pass!"}
    )
    assert r.status_code in (200, 201), r.text
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    r = await client.put(f"{API}/profiles/me", json=_anketa("A"), headers=headers)
    assert r.status_code == 200, r.text
    return headers


# --- Upload: content-type / magic-bytes ---------------------------------------
@pytest.mark.asyncio
async def test_upload_rejects_html_content_type(client):
    """Upload cu content-type text/html (vector stored-XSS) → 422."""
    headers = await _make_user(client, "u1@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.html", b"<script>alert(1)</script>", "text/html")},
        headers=headers,
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_upload_rejects_non_image_bytes(client):
    """Content-type imagine declarat, dar conținut ne-imagine (magic-bytes) → 422."""
    headers = await _make_user(client, "u2@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", b"this is not a real image", "image/png")},
        headers=headers,
    )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_upload_accepts_valid_png(client):
    """Un PNG real trece validarea și e adăugat."""
    headers = await _make_user(client, "u3@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list) and len(r.json()) == 1


@pytest.mark.asyncio
async def test_upload_rejects_oversized(client, monkeypatch):
    """Fișier peste limita de dimensiune → 413."""
    from app.api.v1 import profiles

    monkeypatch.setattr(profiles.settings, "max_upload_bytes", 10)
    headers = await _make_user(client, "u4@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},  # > 10 bytes
        headers=headers,
    )
    assert r.status_code == 413, r.text


# --- Anketă: URL-uri poze + anti-XSS text -------------------------------------
@pytest.mark.asyncio
async def test_anketa_rejects_non_https_photo_url(client):
    """URL de poză non-https în anketă → 422 (allowlist https)."""
    r = await client.post(
        f"{API}/auth/register",
        json={"email": "u5@example.com", "password": "Str0ng-Pass!"},
    )
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    body = _anketa("A", photos=["http://evil.example/x.jpg"])
    r = await client.put(f"{API}/profiles/me", json=body, headers=headers)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_anketa_rejects_too_many_photos(client):
    """Mai multe poze decât max_photos → 422."""
    from app.core.config import settings

    r = await client.post(
        f"{API}/auth/register",
        json={"email": "u6@example.com", "password": "Str0ng-Pass!"},
    )
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    photos = [f"https://cdn.flirt.local/photos/x/{i}.jpg" for i in range(settings.max_photos + 3)]
    r = await client.put(f"{API}/profiles/me", json=_anketa("A", photos=photos), headers=headers)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_anketa_rejects_html_in_about(client):
    """Text cu marcaj HTML în 'about' (anti-XSS stocat) → 422."""
    r = await client.post(
        f"{API}/auth/register",
        json={"email": "u7@example.com", "password": "Str0ng-Pass!"},
    )
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    body = _anketa("A")
    body["about"] = "<script>alert(1)</script>"
    r = await client.put(f"{API}/profiles/me", json=body, headers=headers)
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_anketa_rejects_empty_name(client):
    """Nume gol / doar spații → 422 (non-gol obligatoriu)."""
    r = await client.post(
        f"{API}/auth/register",
        json={"email": "u8@example.com", "password": "Str0ng-Pass!"},
    )
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    body = _anketa("A")
    body["name"] = "   "
    r = await client.put(f"{API}/profiles/me", json=body, headers=headers)
    assert r.status_code == 422, r.text
