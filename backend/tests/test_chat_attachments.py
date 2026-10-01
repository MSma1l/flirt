"""Teste pentru atașamentele media din chat (poză / video / mesaj vocal)."""
import io
import struct

import pytest
from PIL import Image

from app.core.config import settings
from app.services import storage
from tests.test_chat import API, _chat_id_for, _make_user, _matched_pair


# --- Fixture-uri de conținut -------------------------------------------------
def _box(kind: bytes, payload: bytes) -> bytes:
    """Un box ISO-BMFF: size(4) + tip(4) + payload."""
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _mp4(handler: bytes, brand: bytes = b"isom", duration_s: int = 3) -> bytes:
    """MP4 minimal: ftyp + moov(mvhd + trak/mdia/hdlr) + mdat."""
    ftyp = _box(b"ftyp", brand + b"\x00\x00\x02\x00" + brand + b"mp41")
    # mvhd v0: version+flags, creation, modification, timescale, duration, rest.
    mvhd = _box(b"mvhd", b"\x00" * 4 + b"\x00" * 8 + struct.pack(">II", 1000, duration_s * 1000) + b"\x00" * 80)
    hdlr = _box(b"hdlr", b"\x00" * 4 + b"\x00" * 4 + handler + b"\x00" * 12 + b"\x00")
    moov = _box(b"moov", mvhd + _box(b"trak", _box(b"mdia", hdlr)))
    return ftyp + moov + _box(b"mdat", b"\x00" * 64)


def _webm_opus() -> bytes:
    """WebM audio minimal (header EBML + DocType webm + codec A_OPUS)."""
    return b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm" + b"\x00" * 32 + b"\x86\x86A_OPUS" + b"\x00" * 64


def _jpeg_with_gps() -> bytes:
    """JPEG cu EXIF (marcă telefon + coordonate GPS)."""
    exif = Image.Exif()
    exif[0x010F] = "SecretPhoneMaker"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (47.0, 1.0, 30.0)
    buf = io.BytesIO()
    Image.new("RGB", (64, 32), "red").save(buf, "JPEG", exif=exif.tobytes())
    return buf.getvalue()


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    """Storage LOCAL pe un director temporar — verificăm bytes-ii salvați."""
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


def _stored_bytes(media_dir, url: str) -> bytes:
    key = url.split("/media/", 1)[1]
    return (media_dir / key).read_bytes()


async def _post(client, chat_id, headers, content, *, name="f.bin", ct="application/octet-stream", data=None):
    return await client.post(
        f"{API}/chats/{chat_id}/attachments",
        files={"file": (name, content, ct)},
        data=data or {},
        headers=headers,
    )


# --- Teste -------------------------------------------------------------------
@pytest.mark.asyncio
async def test_upload_image_strips_exif(client, media_dir):
    (a_headers, a_id), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    raw = _jpeg_with_gps()
    assert b"SecretPhoneMaker" in raw

    resp = await _post(client, chat_id, a_headers, raw, name="x.png", ct="image/png",
                       data={"caption": "uite  "})
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["kind"] == "image"
    assert msg["body"] == "uite"
    assert msg["sender_id"] == a_id
    att = msg["attachment"]
    # Tipul vine din conținut (JPEG), nu din Content-Type-ul declarat (png).
    assert att["mime"] == "image/jpeg"
    assert (att["width"], att["height"]) == (64, 32)
    assert att["duration_ms"] is None
    assert att["url"].startswith("https://api.flrt.md/media/chat-media/")
    # Cheie neghicibilă: token hex de 32 de caractere.
    assert len(att["url"].rsplit("/", 1)[1].split(".")[0]) == 32

    stored = _stored_bytes(media_dir, att["url"])
    assert att["size_bytes"] == len(stored)
    assert b"SecretPhoneMaker" not in stored
    assert b"Exif" not in stored
    assert not dict(Image.open(io.BytesIO(stored)).getexif())

    # Destinatarul vede mesajul în conversație + previzualizarea în listă.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.json()[-1]["attachment"]["url"] == att["url"]
    summary = (await client.get(f"{API}/chats/", headers=b_headers)).json()[0]
    assert summary["last_message_kind"] == "image"
    assert summary["last_message"] == "uite"
    assert summary["unread_count"] == 1


@pytest.mark.asyncio
async def test_upload_voice_webm_and_m4a(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await _post(client, chat_id, a_headers, _webm_opus(), data={"duration_ms": "4200"})
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["kind"] == "voice"
    assert msg["body"] == ""
    assert msg["attachment"]["mime"] == "audio/webm"
    assert msg["attachment"]["duration_ms"] == 4200

    # m4a (audio-only mp4): durata reală din `mvhd` are prioritate.
    resp = await _post(client, chat_id, a_headers, _mp4(b"soun", brand=b"M4A ", duration_s=7),
                       data={"duration_ms": "1"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["kind"] == "voice"
    assert resp.json()["attachment"]["mime"] == "audio/mp4"
    assert resp.json()["attachment"]["duration_ms"] == 7000

    summary = (await client.get(f"{API}/chats/", headers=a_headers)).json()[0]
    assert summary["last_message_kind"] == "voice"
    assert summary["last_message"] == ""


@pytest.mark.asyncio
async def test_upload_video(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    content = _mp4(b"vide")
    resp = await _post(client, chat_id, a_headers, content, name="v.mp4", ct="video/mp4")
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["kind"] == "video"
    assert msg["attachment"]["mime"] == "video/mp4"
    assert msg["attachment"]["duration_ms"] == 3000
    # Video-ul nu se transcodează.
    assert _stored_bytes(media_dir, msg["attachment"]["url"]) == content


@pytest.mark.asyncio
async def test_unsupported_type_415(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    # PDF deghizat în imagine: Content-Type-ul declarat nu contează.
    resp = await _post(client, chat_id, a_headers, b"%PDF-1.4 fake", name="a.jpg", ct="image/jpeg")
    assert resp.status_code == 415, resp.text
    assert "nepermis" in resp.json()["detail"]
    # HEIC (container ISO-BMFF de imagine) nu e acceptat ca video.
    resp = await _post(client, chat_id, a_headers, _mp4(b"pict", brand=b"heic"))
    assert resp.status_code == 415, resp.text


@pytest.mark.asyncio
async def test_empty_file_422(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await _post(client, chat_id, a_headers, b"")
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_too_large_413(client, media_dir, monkeypatch):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    monkeypatch.setattr(settings, "chat_image_max_bytes", 100)
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps())
    assert resp.status_code == 413, resp.text
    assert "prea mare" in resp.json()["detail"]

    monkeypatch.setattr(settings, "chat_video_max_bytes", 100)
    resp = await _post(client, chat_id, a_headers, _mp4(b"vide"))
    assert resp.status_code == 413, resp.text

    # Mesaj vocal peste 5 minute (durata declarată) → 413.
    resp = await _post(client, chat_id, a_headers, _webm_opus(), data={"duration_ms": "300001"})
    assert resp.status_code == 413, resp.text
    assert "lung" in resp.json()["detail"]

    # Peste plafonul global de citire (cea mai mare limită) → 413.
    monkeypatch.setattr(settings, "chat_voice_max_bytes", 100)
    resp = await _post(client, chat_id, a_headers, _webm_opus() + b"\x00" * 200)
    assert resp.status_code == 413, resp.text

    # Nimic nu a fost persistat.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_caption_rules(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await _post(client, chat_id, a_headers, _webm_opus(),
                       data={"caption": "<script>alert(1)</script>"})
    assert resp.status_code == 422, resp.text
    resp = await _post(client, chat_id, a_headers, _webm_opus(), data={"caption": "x" * 2001})
    assert resp.status_code == 422, resp.text
    resp = await _post(client, chat_id, a_headers, _webm_opus(), data={"duration_ms": "abc"})
    assert resp.status_code == 422, resp.text
    # Legenda e mascată ca un mesaj text.
    resp = await _post(client, chat_id, a_headers, _webm_opus(),
                       data={"caption": "scrie-mi pe @secret_handle"})
    assert resp.status_code == 201, resp.text
    assert resp.json()["was_masked"] is True
    assert "@secret_handle" not in resp.json()["body"]


@pytest.mark.asyncio
async def test_non_participant_refused(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")
    resp = await _post(client, chat_id, c_headers, _webm_opus())
    assert resp.status_code in (403, 404), resp.text
    assert not list(media_dir.rglob("*.weba"))


@pytest.mark.asyncio
async def test_blocked_user_refused(client, media_dir):
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    assert resp.status_code == 201, resp.text
    for headers in (a_headers, b_headers):
        resp = await _post(client, chat_id, headers, _webm_opus())
        assert resp.status_code in (403, 404), resp.text
    assert not list(media_dir.rglob("*.weba"))


@pytest.mark.asyncio
async def test_text_message_shape_backward_compatible(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": "salut"}, headers=a_headers
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    # Câmpurile vechi — neschimbate.
    for field in ("id", "sender_id", "body", "was_masked", "is_read", "reaction", "created_at"):
        assert field in msg
    assert msg["body"] == "salut"
    # Câmpurile noi — aditive, cu valori implicite.
    assert msg["kind"] == "text"
    assert msg["attachment"] is None

    listed = (await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)).json()
    assert listed[0]["kind"] == "text" and listed[0]["attachment"] is None
    summary = (await client.get(f"{API}/chats/", headers=b_headers)).json()[0]
    assert summary["last_message"] == "salut"
    assert summary["last_message_kind"] == "text"
