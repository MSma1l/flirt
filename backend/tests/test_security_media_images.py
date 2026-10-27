"""Regresii de securitate pe imagini: bombe WebP animate, decompression bombs,
citirea plafonată a upload-urilor și cotele de upload per cont.
"""
from __future__ import annotations

import io
import struct
import time
import zlib

import pytest
from PIL import Image

from app.api.v1 import profiles as profiles_api
from app.api.v1 import stories as stories_api
from app.api.v1 import chat as chat_api
from app.core import ratelimit
from app.core.config import settings
from app.services import chat_media, image_variants, photo_moderation
from app.services.photo_moderation import LocalPhotoModerator, ModerationVerdict

API = "/api/v1"


# --------------------------------------------------------------------------- #
# Fabrici de fișiere „ostile"
# --------------------------------------------------------------------------- #


def _chunk(fourcc: bytes, payload: bytes) -> bytes:
    pad = b"\x00" if len(payload) & 1 else b""
    return fourcc + struct.pack("<I", len(payload)) + payload + pad


def _riff(chunks: bytes) -> bytes:
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WEBP" + chunks


def _tiny_vp8l_chunk() -> bytes:
    """Chunk-ul VP8L al unei imagini WebP lossless 1×1 (codat de Pillow)."""
    buf = io.BytesIO()
    Image.new("RGBA", (1, 1), (255, 0, 0, 255)).save(buf, "WEBP", lossless=True)
    data = buf.getvalue()
    idx = data.index(b"VP8L")
    size = struct.unpack("<I", data[idx + 4 : idx + 8])[0]
    return data[idx : idx + 8 + size + (size & 1)]


def _u24(n: int) -> bytes:
    return n.to_bytes(3, "little")


def _animated_webp_bomb(width: int, height: int, frames: int) -> bytes:
    """WebP animat de câțiva KB: canvas uriaș, multe cadre 1×1 (aproape gratuite
    în fișier, dar fiecare re-encodat la mărimea canvas-ului)."""
    vp8x = bytes([0x02 | 0x10]) + b"\x00\x00\x00" + _u24(width - 1) + _u24(height - 1)
    anim = b"\x00\x00\x00\x00" + b"\x00\x00"
    frame = _tiny_vp8l_chunk()
    anmf = _u24(0) + _u24(0) + _u24(0) + _u24(0) + _u24(40) + b"\x00" + frame
    body = _chunk(b"VP8X", vp8x) + _chunk(b"ANIM", anim)
    body += _chunk(b"ANMF", anmf) * frames
    return _riff(body)


def _png_header_only(width: int, height: int) -> bytes:
    """PNG valid ca antet (IHDR) care declară `width`×`height` px — câțiva octeți."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data)) + kind + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(b"\x00" * 64)) + chunk(b"IEND", b"")
    )


def _legit_animated_webp_with_exif() -> bytes:
    frames = [Image.new("RGB", (64, 48), c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    exif = Image.Exif()
    exif[0x010F] = "SecretPhoneMaker"  # Make
    buf = io.BytesIO()
    frames[0].save(
        buf, "WEBP", save_all=True, append_images=frames[1:], duration=100,
        loop=0, exif=exif.tobytes(), xmp=b"<x:xmpmeta>GPS secret</x:xmpmeta>",
    )
    return buf.getvalue()


def _jpeg(size=(32, 32)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 100, 50)).save(buf, "JPEG")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# 3. WebP animat: bomba de CPU e refuzată din antete, fără re-encodare
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "width,height,frames",
    [
        (16383, 16383, 3),  # canvas uriaș
        (1000, 1000, 500),  # prea multe cadre
        (2000, 2000, 60),  # cadre × pixeli peste plafonul total
    ],
)
def test_animated_webp_bomb_rejected_fast(width, height, frames):
    bomb = _animated_webp_bomb(width, height, frames)
    assert len(bomb) < 64 * 1024  # fișierul e mic — costul era în antete
    start = time.monotonic()
    with pytest.raises(Exception) as exc:
        chat_media.validate_attachment(bomb, None)
    assert getattr(exc.value, "status_code", None) == 413
    assert time.monotonic() - start < 1.0


def test_animated_webp_never_reencoded(monkeypatch):
    """Nicio cale nu mai cheamă `save(save_all=True)` pe un WebP animat."""
    calls = []
    original_save = Image.Image.save

    def spy(self, *args, **kwargs):
        calls.append(kwargs.get("save_all"))
        return original_save(self, *args, **kwargs)

    content = _legit_animated_webp_with_exif()
    monkeypatch.setattr(Image.Image, "save", spy)
    media = chat_media.validate_attachment(content, None)
    assert True not in calls
    assert media.mime == "image/webp"


def test_legit_animated_webp_kept_animated_without_metadata():
    content = _legit_animated_webp_with_exif()
    assert b"EXIF" in content and b"XMP " in content  # premisa testului

    media = chat_media.validate_attachment(content, None)

    assert media.kind == "image" and media.mime == "image/webp"
    assert (media.width, media.height) == (64, 48)
    assert b"EXIF" not in media.content and b"XMP " not in media.content
    assert b"SecretPhoneMaker" not in media.content and b"GPS secret" not in media.content
    with Image.open(io.BytesIO(media.content)) as img:
        assert img.n_frames == 3
        assert not img.info.get("exif") and not img.info.get("xmp")


def test_truncated_animated_webp_rejected():
    content = _legit_animated_webp_with_exif()
    with pytest.raises(Exception) as exc:
        chat_media.validate_attachment(content[: len(content) // 2], None)
    assert getattr(exc.value, "status_code", None) in (413, 422)


# --------------------------------------------------------------------------- #
# 5. Decompression bombs: plafon global + verificare înainte de decodare
# --------------------------------------------------------------------------- #


def test_global_pillow_limit_is_set():
    assert Image.MAX_IMAGE_PIXELS == image_variants.PILLOW_MAX_IMAGE_PIXELS
    assert Image.MAX_IMAGE_PIXELS <= 60_000_000


def test_image_variants_no_longer_uses_catch_warnings():
    import inspect

    assert "catch_warnings" not in inspect.getsource(image_variants._open_checked)


@pytest.mark.parametrize("side", [8_000, 30_000])
def test_moderation_downscale_does_not_decode_bomb(side, monkeypatch):
    bomb = _png_header_only(side, side)
    loads = []
    monkeypatch.setattr(Image.Image, "load", lambda self: loads.append(1))
    out, media_type = photo_moderation.downscale_for_moderation(bomb, "image/png")
    assert out == bomb and media_type == "image/png"
    assert loads == []


def test_local_moderator_does_not_decode_bomb(monkeypatch):
    bomb = _png_header_only(9_000, 9_000)
    converts = []
    monkeypatch.setattr(Image.Image, "convert", lambda self, *a, **k: converts.append(1))
    with pytest.raises(ValueError):
        LocalPhotoModerator()._skin_ratio(bomb)
    assert converts == []


class _CountingModerator:
    def __init__(self) -> None:
        self.calls = 0

    async def check(self, image: bytes, media_type: str) -> ModerationVerdict:
        self.calls += 1
        return ModerationVerdict(allowed=True, raw_label="ok")


async def _profile_user(client, email="bomb@example.com"):
    from tests.test_stories import _make_user

    return await _make_user(client, email, "B")


@pytest.mark.asyncio
@pytest.mark.parametrize("side", [8_000, 30_000])
async def test_profile_upload_bomb_rejected_before_moderation(client, monkeypatch, side):
    headers, _ = await _profile_user(client)
    moderator = _CountingModerator()
    monkeypatch.setattr(profiles_api, "get_photo_moderator", lambda: moderator)

    resp = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _png_header_only(side, side), "image/png")},
        headers=headers,
    )
    assert resp.status_code == 413, resp.text
    assert moderator.calls == 0


@pytest.mark.asyncio
async def test_story_upload_bomb_rejected_before_moderation(client, monkeypatch):
    headers, _ = await _profile_user(client)
    moderator = _CountingModerator()
    monkeypatch.setattr(stories_api, "get_photo_moderator", lambda: moderator)
    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.png", _png_header_only(9_000, 9_000), "image/png")},
        headers=headers,
    )
    assert resp.status_code == 413, resp.text
    assert moderator.calls == 0


# --------------------------------------------------------------------------- #
# 6. Citire plafonată (fără `read()` nelimitat)
# --------------------------------------------------------------------------- #


class _FakeUpload:
    def __init__(self, data: bytes, size: int | None) -> None:
        self._data = data
        self.size = size
        self.read_args: list = []

    async def read(self, n: int = -1) -> bytes:
        self.read_args.append(n)
        return self._data if n < 0 else self._data[:n]


@pytest.mark.asyncio
async def test_read_upload_capped_uses_size_and_limit():
    big = _FakeUpload(b"x" * 10, size=10_000_000)
    with pytest.raises(Exception) as exc:
        await profiles_api.read_upload_capped(big, 1000)
    assert exc.value.status_code == 413
    assert big.read_args == []  # refuzat din `size`, fără să citească nimic

    unknown = _FakeUpload(b"x" * 5000, size=None)
    with pytest.raises(Exception) as exc:
        await profiles_api.read_upload_capped(unknown, 1000)
    assert exc.value.status_code == 413
    assert unknown.read_args == [1001]  # niciodată `read()` fără plafon

    ok = _FakeUpload(b"x" * 10, size=10)
    assert await profiles_api.read_upload_capped(ok, 1000) == b"x" * 10


@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/profiles/photos", "/stories/media", "/profiles/verify-face"])
async def test_oversized_upload_413(client, monkeypatch, path):
    headers, _ = await _profile_user(client)
    monkeypatch.setattr(settings, "max_upload_bytes", 2048)
    monkeypatch.setattr(settings, "face_verify_requires_consent", False)
    moderator = _CountingModerator()
    monkeypatch.setattr(profiles_api, "get_photo_moderator", lambda: moderator)
    monkeypatch.setattr(stories_api, "get_photo_moderator", lambda: moderator)
    resp = await client.post(
        f"{API}{path}",
        files={"file": ("x.jpg", _jpeg((400, 400)) + b"\x00" * 4096, "image/jpeg")},
        headers=headers,
    )
    assert resp.status_code == 413, resp.text
    assert moderator.calls == 0


# --------------------------------------------------------------------------- #
# 7. Cote per CONT înainte de citire / moderare plătită
# --------------------------------------------------------------------------- #


@pytest.fixture
def rate_limits_on():
    ratelimit.enable_for_tests()
    yield
    ratelimit.disable_for_tests()


@pytest.mark.asyncio
async def test_profile_photo_quota_per_user(client, monkeypatch):
    headers, _ = await _profile_user(client)
    moderator = _CountingModerator()
    monkeypatch.setattr(profiles_api, "get_photo_moderator", lambda: moderator)
    monkeypatch.setattr(profiles_api, "PHOTO_UPLOADS_PER_HOUR", 1)
    monkeypatch.setattr(settings, "max_photos", 20)
    ratelimit.enable_for_tests()
    try:
        first = await client.post(
            f"{API}/profiles/photos",
            files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, headers=headers,
        )
        assert first.status_code == 200, first.text
        second = await client.post(
            f"{API}/profiles/photos",
            files={"file": ("b.jpg", _jpeg(), "image/jpeg")}, headers=headers,
        )
        assert second.status_code == 429, second.text
        assert "Retry-After" in second.headers
        assert moderator.calls == 1  # al doilea nu a ajuns la moderarea plătită
    finally:
        ratelimit.disable_for_tests()


@pytest.mark.asyncio
async def test_profile_max_photos_checked_before_moderation(client, monkeypatch):
    headers, _ = await _profile_user(client)
    current = len((await client.get(f"{API}/profiles/me", headers=headers)).json()["photos"])
    monkeypatch.setattr(settings, "max_photos", current)
    moderator = _CountingModerator()
    monkeypatch.setattr(profiles_api, "get_photo_moderator", lambda: moderator)
    resp = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert moderator.calls == 0


@pytest.mark.asyncio
async def test_story_media_quota_per_user(client, monkeypatch, rate_limits_on):
    from tests.test_stories import _make_user

    ratelimit.disable_for_tests()  # crearea userului nu consumă din cote
    headers, _ = await _make_user(client, "s@example.com", "S")
    ratelimit.enable_for_tests()
    moderator = _CountingModerator()
    monkeypatch.setattr(stories_api, "get_photo_moderator", lambda: moderator)
    monkeypatch.setattr(stories_api, "STORY_UPLOADS_PER_HOUR", 2)
    codes = []
    for _ in range(3):
        resp = await client.post(
            f"{API}/stories/media",
            files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, headers=headers,
        )
        codes.append(resp.status_code)
    assert codes == [200, 200, 429]
    assert moderator.calls == 2


@pytest.mark.asyncio
async def test_chat_attachment_quota_per_user(client, monkeypatch, rate_limits_on):
    from tests.test_chat import _chat_id_for, _matched_pair

    ratelimit.disable_for_tests()
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    ratelimit.enable_for_tests()
    monkeypatch.setattr(chat_api, "CHAT_ATTACHMENTS_PER_HOUR", 1)
    codes = []
    for _ in range(2):
        resp = await client.post(
            f"{API}/chats/{chat_id}/attachments",
            files={"file": ("a.jpg", _jpeg(), "image/jpeg")}, headers=a_headers,
        )
        codes.append(resp.status_code)
    assert codes == [201, 429]


@pytest.mark.asyncio
async def test_user_quota_is_keyed_by_user_not_ip(rate_limits_on):
    """Alt IP nu resetează cota; alt user are cota lui."""
    for _ in range(2):
        await ratelimit.enforce_user_quota("t", "user-1", 2, 3600)
    with pytest.raises(Exception) as exc:
        await ratelimit.enforce_user_quota("t", "user-1", 2, 3600)
    assert exc.value.status_code == 429
    await ratelimit.enforce_user_quota("t", "user-2", 2, 3600)
