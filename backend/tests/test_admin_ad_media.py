"""Teste pentru upload-ul de media din admin: `POST /api/v1/admin/ads/media`
și `POST /api/v1/admin/events/cover` (același pipeline, `services/admin_media.py`).

Acoperă: jpeg → url + 'image' (și URL-ul trece de schema reclamei la create/patch),
mp4 / webm → 'video', EXIF eliminat, tip nepermis deghizat → 415, audio-only → 415,
prea mare → 413 (poză și video), gol → 422, user normal → 403, fără token → 401,
plus intrarea de audit `ad.media.upload`. Coperta de eveniment: doar imagini
(video → 415), URL-ul merge în `cover_url` la create/update, 403 / 401.
"""
from __future__ import annotations

import io
import struct
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models.admin import AdminAuditLog
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
URL = f"{API}/admin/ads/media"
PASSWORD = "Str0ng-Passw0rd!"


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str = "admin_media@example.com") -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


def _jpeg(with_exif: bool = False, size=(16, 16)) -> bytes:
    from PIL import Image

    img = Image.new("RGB", size, (200, 30, 60))
    out = io.BytesIO()
    if with_exif:
        exif = Image.Exif()
        exif[0x010F] = "SecretCam"  # Make
        img.save(out, format="JPEG", exif=exif.tobytes())
    else:
        img.save(out, format="JPEG")
    return out.getvalue()


def _png() -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", (8, 8), (10, 20, 30, 128)).save(out, format="PNG")
    return out.getvalue()


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _mp4(handler: bytes = b"vide", brand: bytes = b"isom", pad: int = 0) -> bytes:
    """Container ISO-BMFF minimal: ftyp + moov/trak/mdia/hdlr(handler)."""
    ftyp = _box(b"ftyp", brand + b"\x00\x00\x02\x00" + brand + b"mp41")
    hdlr = _box(b"hdlr", b"\x00" * 8 + handler + b"\x00" * 12)
    moov = _box(b"moov", _box(b"trak", _box(b"mdia", hdlr)))
    return ftyp + moov + (_box(b"mdat", b"\x00" * pad) if pad else b"")


def _webm() -> bytes:
    return b"\x1a\x45\xdf\xa3" + b"\x42\x82\x84webm" + b"\x00" * 16 + b"V_VP9" + b"\x00" * 32


async def _upload(client, headers, content: bytes, name: str, ct: str):
    return await client.post(URL, files={"file": (name, content, ct)}, headers=headers)


# --------------------------------------------------------------------------- #
# Cazuri reușite
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_upload_jpeg_then_use_in_ad(client, db_session):
    admin = await _make_admin(client, db_session)

    r = await _upload(client, admin, _jpeg(), "poza.jpg", "image/jpeg")
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["media_type"] == "image"
    url = body["url"]
    base = settings.storage_base_url.rstrip("/")
    assert url.startswith(f"{base}/ads/") and url.endswith(".jpg")
    assert url.startswith(("https://", "http://"))

    # URL-ul trece de schema reclamei (optional_safe_str(AD_URL_MAX_LENGTH)).
    r = await client.post(
        f"{API}/admin/ads",
        json={"title": "Creativ urcat", "image_url": url, "duration_seconds": 10},
        headers=admin,
    )
    assert r.status_code == 201, r.text
    ad = r.json()
    assert ad["image_url"] == url

    r2 = await _upload(client, admin, _mp4(), "clip.mp4", "video/mp4")
    assert r2.status_code == 201, r2.text
    video_url = r2.json()["url"]
    r = await client.patch(
        f"{API}/admin/ads/{ad['id']}", json={"video_url": video_url}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["video_url"] == video_url

    # Auditat: o intrare per upload.
    n = await db_session.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == "ad.media.upload"
        )
    )
    assert n == 2


@pytest.mark.asyncio
async def test_upload_mp4_is_video(client, db_session):
    admin = await _make_admin(client, db_session)
    # Content-Type declarat fals: tipul vine din conținut, nu din header.
    r = await _upload(client, admin, _mp4(), "clip.bin", "application/octet-stream")
    assert r.status_code == 201, r.text
    assert r.json()["media_type"] == "video"
    assert r.json()["url"].endswith(".mp4")


@pytest.mark.asyncio
async def test_upload_mov_and_webm_are_video(client, db_session):
    admin = await _make_admin(client, db_session)
    r = await _upload(client, admin, _mp4(brand=b"qt  "), "clip.mov", "video/quicktime")
    assert r.status_code == 201, r.text
    assert r.json()["media_type"] == "video" and r.json()["url"].endswith(".mov")

    r = await _upload(client, admin, _webm(), "clip.webm", "video/webm")
    assert r.status_code == 201, r.text
    assert r.json()["media_type"] == "video" and r.json()["url"].endswith(".webm")


@pytest.mark.asyncio
async def test_upload_strips_exif(client, db_session, monkeypatch):
    """Poza salvată în storage e re-encodată fără EXIF."""
    from app.services import storage as storage_mod

    saved: dict = {}

    class _Spy(storage_mod.StubStorage):
        async def save(self, key, content, content_type):
            saved.update(key=key, content=content, ct=content_type)
            return await super().save(key, content, content_type)

    monkeypatch.setattr("app.services.admin_media.get_storage", lambda: _Spy())
    admin = await _make_admin(client, db_session)
    raw = _jpeg(with_exif=True)
    assert b"SecretCam" in raw
    r = await _upload(client, admin, raw, "poza.jpg", "image/jpeg")
    assert r.status_code == 201, r.text
    assert saved["key"].startswith("ads/")
    assert saved["ct"] == "image/jpeg"
    assert b"SecretCam" not in saved["content"]


# --------------------------------------------------------------------------- #
# Respingeri
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content,name,ct",
    [
        (b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<<>>\nendobj\n", "poza.jpg", "image/jpeg"),
        (b"doar text, nu o imagine", "poza.jpg", "image/jpeg"),
        (b"<script>alert(1)</script>", "x.mp4", "video/mp4"),
        (b"GIF89a" + b"\x00" * 32, "anim.gif", "image/gif"),
    ],
)
async def test_upload_unsupported_type_415(client, db_session, content, name, ct):
    admin = await _make_admin(client, db_session)
    r = await _upload(client, admin, content, name, ct)
    assert r.status_code == 415, r.text
    assert r.json()["code"] == "unsupported_media_type"


@pytest.mark.asyncio
async def test_upload_audio_only_mp4_415(client, db_session):
    admin = await _make_admin(client, db_session)
    r = await _upload(client, admin, _mp4(handler=b"soun", brand=b"M4A "), "a.mp4", "video/mp4")
    assert r.status_code == 415, r.text
    assert r.json()["code"] == "unsupported_media_type"


@pytest.mark.asyncio
async def test_upload_image_too_large_413(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 1000)
    admin = await _make_admin(client, db_session)
    big = _jpeg(size=(256, 256))
    assert len(big) > 1000
    r = await _upload(client, admin, big, "poza.jpg", "image/jpeg")
    assert r.status_code == 413, r.text
    assert r.json()["code"] == "file_too_large"


@pytest.mark.asyncio
async def test_upload_video_too_large_413(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "story_video_max_bytes", 2000)
    monkeypatch.setattr(settings, "max_upload_bytes", 1000)
    admin = await _make_admin(client, db_session)
    # Peste limita video, dar sub plafonul de citire: verificarea per-tip.
    r = await _upload(client, admin, _mp4(pad=1950), "clip.mp4", "video/mp4")
    assert r.status_code == 413, r.text
    assert r.json()["code"] == "file_too_large"
    # Peste plafonul de citire: refuz înainte de a ști tipul.
    r = await _upload(client, admin, _mp4(pad=5000), "clip.mp4", "video/mp4")
    assert r.status_code == 413, r.text
    assert r.json()["code"] == "file_too_large"


@pytest.mark.asyncio
async def test_upload_empty_422(client, db_session):
    admin = await _make_admin(client, db_session)
    r = await _upload(client, admin, b"", "gol.jpg", "image/jpeg")
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_upload_corrupt_jpeg_422(client, db_session):
    admin = await _make_admin(client, db_session)
    r = await _upload(client, admin, b"\xff\xd8\xff\xe0" + b"\x00" * 64, "x.jpg", "image/jpeg")
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_upload_missing_file_field_422(client, db_session):
    admin = await _make_admin(client, db_session)
    r = await client.post(URL, data={"other": "x"}, files={"nu": ("a", b"a")}, headers=admin)
    assert r.status_code == 422, r.text


# --------------------------------------------------------------------------- #
# Autorizare
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_upload_non_admin_403(client, db_session):
    user = await _register(client, "simplu_media@example.com")
    r = await _upload(client, user, _jpeg(), "poza.jpg", "image/jpeg")
    assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_upload_no_token_401(client):
    r = await _upload(client, {}, _jpeg(), "poza.jpg", "image/jpeg")
    assert r.status_code == 401, r.text


# --------------------------------------------------------------------------- #
# Coperta de eveniment — `POST /admin/events/cover` (doar imagini)
# --------------------------------------------------------------------------- #
COVER_URL = f"{API}/admin/events/cover"


def _event_payload(**extra) -> dict:
    return {
        "title": "Cover Party",
        "starts_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
        "city": "Chișinău",
        "kind": "party",
        **extra,
    }


@pytest.mark.asyncio
async def test_event_cover_upload_then_use_in_event(client, db_session):
    admin = await _make_admin(client, db_session, "admin_cover@example.com")

    r = await client.post(
        COVER_URL, files={"file": ("c.png", _png(), "image/png")}, headers=admin
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["media_type"] == "image"
    url = body["url"]
    base = settings.storage_base_url.rstrip("/")
    assert url.startswith(f"{base}/events/") and url.endswith(".png")

    r = await client.post(
        f"{API}/admin/events", json=_event_payload(cover_url=url), headers=admin
    )
    assert r.status_code == 201, r.text
    event = r.json()
    assert event["cover_url"] == url

    r2 = await client.post(
        COVER_URL, files={"file": ("c.jpg", _jpeg(), "image/jpeg")}, headers=admin
    )
    assert r2.status_code == 201, r2.text
    url2 = r2.json()["url"]
    r = await client.put(
        f"{API}/admin/events/{event['id']}", json={"cover_url": url2}, headers=admin
    )
    assert r.status_code == 200, r.text
    assert r.json()["cover_url"] == url2

    # Coperta se vede și în lista publică (ce randează Mini App-ul).
    r = await client.get(f"{API}/events/", headers=admin)
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    assert any(e.get("cover_url") == url2 for e in items)

    n = await db_session.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == "event.cover.upload"
        )
    )
    assert n == 2


@pytest.mark.asyncio
async def test_event_cover_prod_style_url_passes_schema():
    """Forma URL-ului de producție (local storage sub /media) trece de schema."""
    from app.schemas.admin import AdminEventIn, AdminEventUpdate

    prod = "https://api.flrt.md/media/events/" + "a" * 32 + ".webp"
    assert AdminEventIn(**_event_payload(cover_url=prod)).cover_url == prod
    assert AdminEventUpdate(cover_url=prod).cover_url == prod


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content,name,ct",
    [
        (_mp4(), "clip.mp4", "video/mp4"),
        (_mp4(), "clip.jpg", "image/jpeg"),  # video deghizat în poză
        (_webm(), "clip.webm", "video/webm"),
        (b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "c.jpg", "image/jpeg"),
    ],
)
async def test_event_cover_rejects_non_image_415(client, db_session, content, name, ct):
    admin = await _make_admin(client, db_session, "admin_cover2@example.com")
    r = await client.post(COVER_URL, files={"file": (name, content, ct)}, headers=admin)
    assert r.status_code == 415, r.text
    assert r.json()["code"] == "unsupported_media_type"


@pytest.mark.asyncio
async def test_event_cover_too_large_and_empty(client, db_session, monkeypatch):
    admin = await _make_admin(client, db_session, "admin_cover3@example.com")
    r = await client.post(COVER_URL, files={"file": ("c.jpg", b"", "image/jpeg")}, headers=admin)
    assert r.status_code == 422, r.text

    monkeypatch.setattr(settings, "max_upload_bytes", 1000)
    big = _jpeg(size=(256, 256))
    r = await client.post(COVER_URL, files={"file": ("c.jpg", big, "image/jpeg")}, headers=admin)
    assert r.status_code == 413, r.text
    assert r.json()["code"] == "file_too_large"


@pytest.mark.asyncio
async def test_event_cover_non_admin_403_and_no_token_401(client, db_session):
    user = await _register(client, "simplu_cover@example.com")
    r = await client.post(COVER_URL, files={"file": ("c.jpg", _jpeg(), "image/jpeg")}, headers=user)
    assert r.status_code == 403, r.text
    r = await client.post(COVER_URL, files={"file": ("c.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 401, r.text
