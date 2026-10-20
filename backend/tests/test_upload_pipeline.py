"""Pipeline-ul de upload al pozelor (valul 2 de performanță).

Fiecare flux de upload salvează pe disc (storage LOCAL, director temporar):
- poze de profil: original JPEG ≤1600px fără EXIF + `_256.webp` + `_800.webp`;
- story: original ≤1440px + `_256.webp`;
- chat: original JPEG ≤1600px + `_480.webp`;
- coperta de eveniment: original ≤1600px + `_800.webp`;
iar moderarea primește o imagine ≤1024px, nu fișierul întreg.
"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services import photo_moderation, storage
from app.services.ai import AIResult
from app.services.image_variants import variant_key
from tests.test_admin_ad_media import COVER_URL, _make_admin
from tests.test_chat import _chat_id_for, _matched_pair
from tests.test_upload_security import _make_user

API = "/api/v1"


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


def _photo(size=(2400, 1800), fmt="JPEG", with_gps=True) -> bytes:
    """Poză „de telefon": mare, cu EXIF (marcă + GPS)."""
    img = Image.new("RGB", size, (180, 90, 40))
    # Un pic de structură, ca encoderele să nu dea fișiere triviale.
    for x in range(0, size[0], 97):
        img.paste((20, 160, 200), (x, 0, min(x + 40, size[0]), size[1]))
    buf = io.BytesIO()
    if with_gps and fmt == "JPEG":
        exif = Image.Exif()
        exif[0x010F] = "SecretPhoneMaker"
        gps = exif.get_ifd(0x8825)
        gps[1] = "N"
        gps[2] = (47.0, 1.0, 30.0)
        img.save(buf, fmt, exif=exif.tobytes())
    else:
        img.save(buf, fmt)
    return buf.getvalue()


def _key(url: str) -> str:
    return url.split("/media/", 1)[1]


def _open(media_dir, key: str) -> tuple[Image.Image, bytes]:
    data = (media_dir / key).read_bytes()
    return Image.open(io.BytesIO(data)), data


# --------------------------------------------------------------------------- #
# Poze de profil
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_profile_upload_saves_clean_jpeg_and_variants(client, media_dir):
    headers = await _make_user(client, "pipe-profile@example.com")
    raw = _photo()
    assert b"SecretPhoneMaker" in raw

    r = await client.post(
        f"{API}/profiles/photos", files={"file": ("p.png", raw, "image/png")}, headers=headers
    )
    assert r.status_code == 200, r.text
    url = r.json()[-1]
    key = _key(url)
    # URL-ul rămâne `{storage_base_url}/{key}`, cu extensia `.jpg` (original JPEG).
    assert url == f"https://api.flrt.md/media/{key}"
    assert key.startswith("photos/") and key.endswith(".jpg")

    original, data = _open(media_dir, key)
    assert original.format == "JPEG"
    assert max(original.size) == 1600
    assert b"SecretPhoneMaker" not in data
    assert not dict(original.getexif())

    for size in (256, 800):
        variant, _ = _open(media_dir, variant_key(key, size))
        assert variant.format == "WEBP"
        assert max(variant.size) == size


@pytest.mark.asyncio
async def test_profile_upload_corrupt_image_422_and_nothing_saved(client, media_dir):
    headers = await _make_user(client, "pipe-corrupt@example.com")
    # Antet PNG valid (trece de magic-bytes), dar datele sunt trunchiate → decodarea pică.
    broken = _photo(size=(64, 64), fmt="PNG")[:80]
    r = await client.post(
        f"{API}/profiles/photos", files={"file": ("p.png", broken, "image/png")}, headers=headers
    )
    assert r.status_code == 422, r.text
    assert r.json()["detail"] == "Conținutul încărcat nu este o imagine validă."
    assert not any(media_dir.rglob("*.*"))


# --------------------------------------------------------------------------- #
# Story
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_story_upload_saves_1440_original_and_256_variant(client, media_dir):
    headers = await _make_user(client, "pipe-story@example.com")
    r = await client.post(
        f"{API}/stories/media",
        files={"file": ("s.jpg", _photo(), "image/jpeg")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    key = _key(r.json()["media_url"])
    assert key.startswith("stories/") and key.endswith(".jpg")

    original, data = _open(media_dir, key)
    assert original.format == "JPEG" and max(original.size) == 1440
    assert b"SecretPhoneMaker" not in data
    variant, _ = _open(media_dir, variant_key(key, 256))
    assert variant.format == "WEBP" and max(variant.size) == 256
    assert not (media_dir / variant_key(key, 800)).exists()


# --------------------------------------------------------------------------- #
# Chat
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_chat_image_downscaled_with_480_variant(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    r = await client.post(
        f"{API}/chats/{chat_id}/attachments",
        files={"file": ("c.png", _photo(size=(2000, 1000), fmt="PNG"), "image/png")},
        headers=a_headers,
    )
    assert r.status_code == 201, r.text
    att = r.json()["attachment"]
    # PNG-ul static devine JPEG (≤1600px); dimensiunile raportate sunt cele salvate.
    assert att["mime"] == "image/jpeg"
    assert (att["width"], att["height"]) == (1600, 800)
    key = _key(att["url"])
    assert key.endswith(".jpg")

    original, data = _open(media_dir, key)
    assert original.format == "JPEG" and original.size == (1600, 800)
    assert att["size_bytes"] == len(data)
    variant, _ = _open(media_dir, variant_key(key, 480))
    assert variant.format == "WEBP" and variant.size == (480, 240)


@pytest.mark.asyncio
async def test_chat_gif_kept_as_is_without_variant(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    buf = io.BytesIO()
    frames = [Image.new("P", (20, 10), c) for c in (1, 2)]
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:])
    gif = buf.getvalue()
    r = await client.post(
        f"{API}/chats/{chat_id}/attachments",
        files={"file": ("a.gif", gif, "image/gif")},
        headers=a_headers,
    )
    assert r.status_code == 201, r.text
    att = r.json()["attachment"]
    assert att["mime"] == "image/gif"
    key = _key(att["url"])
    assert (media_dir / key).read_bytes() == gif
    assert not (media_dir / variant_key(key, 480)).exists()


# --------------------------------------------------------------------------- #
# Coperta de eveniment
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_event_cover_saves_800_variant(client, db_session, media_dir):
    admin = await _make_admin(client, db_session, "pipe-cover@example.com")
    r = await client.post(
        COVER_URL, files={"file": ("c.jpg", _photo(), "image/jpeg")}, headers=admin
    )
    assert r.status_code == 201, r.text
    key = _key(r.json()["url"])
    assert key.startswith("events/") and key.endswith(".jpg")
    original, data = _open(media_dir, key)
    assert original.format == "JPEG" and max(original.size) == 1600
    assert b"SecretPhoneMaker" not in data
    variant, _ = _open(media_dir, variant_key(key, 800))
    assert variant.format == "WEBP" and max(variant.size) == 800


# --------------------------------------------------------------------------- #
# Moderare: imaginea trimisă providerului e ≤1024px
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_moderation_provider_receives_image_at_most_1024px(
    client, media_dir, monkeypatch
):
    seen: list[tuple[bytes, str]] = []

    async def fake_vision(prompt, image, media_type, **kwargs):
        seen.append((image, media_type))
        return AIResult(text='{"allowed": true, "category": "safe"}')

    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")
    monkeypatch.setattr(photo_moderation.settings, "ai_vision_model", "x")
    monkeypatch.setattr(photo_moderation.ai, "complete_vision", fake_vision)

    headers = await _make_user(client, "pipe-moderation@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("p.jpg", _photo(), "image/jpeg")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert len(seen) == 1
    image, media_type = seen[0]
    assert media_type == "image/jpeg"
    sent = Image.open(io.BytesIO(image))
    assert sent.format == "JPEG"
    assert max(sent.size) <= 1024


def test_downscale_for_moderation_shrinks_large_and_keeps_small():
    big, big_type = photo_moderation.downscale_for_moderation(_photo(), "image/jpeg")
    assert big_type == "image/jpeg"
    assert max(Image.open(io.BytesIO(big)).size) == 1024

    small_png = _photo(size=(300, 200), fmt="PNG")
    out, out_type = photo_moderation.downscale_for_moderation(small_png, "image/png")
    assert (out, out_type) == (small_png, "image/png")

    # Bytes nedecodabili: neschimbați (verdictul rămâne treaba providerului).
    assert photo_moderation.downscale_for_moderation(b"nu e poza", "image/png") == (
        b"nu e poza",
        "image/png",
    )
