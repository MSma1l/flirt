"""Mesajele video rotunde („кружки") din chat: `kind=video_note` la upload.

Conversia reală (MP4 H.264/AAC pătrat) are nevoie de ffmpeg; fără el, testul de
conversie e sărit, iar ruta e verificată cu ffmpeg simulat.
"""
import asyncio
import shutil

import pytest

from app.services import chat_media
from app.services.chat_media import (
    VIDEO_NOTE_KIND,
    VIDEO_NOTE_SIDE,
    ChatMedia,
    as_video_note,
    ensure_playable_video_note,
    video_note_ffmpeg_args,
)
from tests.test_chat import API, _chat_id_for, _matched_pair
from tests.test_chat_attachments import _mp4, _post, _stored_bytes, _webm_opus, media_dir  # noqa: F401

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def _webm_video() -> bytes:
    """WebM video minimal (EBML + DocType webm + codec V_VP8 + A_OPUS)."""
    return (
        b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm" + b"\x00" * 32
        + b"\x86\x85V_VP8" + b"\x00" * 16 + b"\x86\x86A_OPUS" + b"\x00" * 64
    )


# --- Unitar: validare + argumente ffmpeg -------------------------------------
def test_as_video_note_accepts_only_short_videos():
    video = ChatMedia(kind="video", mime="video/webm", content=b"x", duration_ms=12_000)
    note = as_video_note(video)
    assert note.kind == VIDEO_NOTE_KIND
    assert note.mime == "video/webm"
    assert note.duration_ms == 12_000

    with pytest.raises(Exception) as exc:
        as_video_note(ChatMedia(kind="voice", mime="audio/webm", content=b"x"))
    assert exc.value.status_code == 415

    with pytest.raises(Exception) as exc:
        as_video_note(ChatMedia(kind="video", mime="video/mp4", content=b"x", duration_ms=90_000))
    assert exc.value.status_code == 413


def test_ffmpeg_args_square_h264_aac():
    args = video_note_ffmpeg_args("/tmp/in", "matroska", "/tmp/out.mp4")
    joined = " ".join(args)
    assert "-f matroska -i /tmp/in" in joined
    assert f"scale={VIDEO_NOTE_SIDE}:{VIDEO_NOTE_SIDE}" in joined
    assert "crop='min(iw,ih)':'min(iw,ih)'" in joined
    assert "-c:v libx264" in joined and "-c:a aac" in joined
    assert "-pix_fmt yuv420p" in joined and "+faststart" in joined
    # Pista audio e opțională; doar fișiere locale.
    assert "0:a:0?" in args
    assert args[args.index("-protocol_whitelist") + 1] == "file"
    assert args[-1] == "/tmp/out.mp4"


async def test_without_ffmpeg_the_original_is_kept(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: None)
    media = ChatMedia(kind=VIDEO_NOTE_KIND, mime="video/webm", content=b"x")
    assert await ensure_playable_video_note(media) is media


async def test_failed_conversion_keeps_the_original(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def failing(*args, **kwargs):
        return False

    monkeypatch.setattr(chat_media, "_run_ffmpeg_video_note", failing)
    media = ChatMedia(kind=VIDEO_NOTE_KIND, mime="video/mp4", content=b"x")
    assert await ensure_playable_video_note(media) is media


async def test_regular_video_is_not_touched(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")
    media = ChatMedia(kind="video", mime="video/webm", content=b"x")
    assert await ensure_playable_video_note(media) is media


# --- Ruta: POST /chats/{id}/attachments cu kind=video_note -------------------
@pytest.mark.asyncio
async def test_upload_video_note_transcoded(client, media_dir, monkeypatch):  # noqa: F811
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    converted = _mp4(b"vide", duration_s=7)
    calls = []

    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def fake_ffmpeg(ffmpeg, src, demuxer, dst):
        calls.append(demuxer)
        with open(dst, "wb") as fh:
            fh.write(converted)
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg_video_note", fake_ffmpeg)

    resp = await _post(
        client, chat_id, a_headers, _webm_video(), name="note.webm", ct="video/webm",
        data={"kind": "video_note", "duration_ms": "7000", "caption": "ignorat"},
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert calls == ["matroska"]
    assert msg["kind"] == "video_note"
    assert msg["body"] == ""  # fără legendă, ca în Telegram
    att = msg["attachment"]
    assert att["mime"] == "video/mp4"
    assert att["url"].endswith(".mp4")
    assert att["duration_ms"] == 7000
    assert (att["width"], att["height"]) == (VIDEO_NOTE_SIDE, VIDEO_NOTE_SIDE)
    assert _stored_bytes(media_dir, att["url"]) == converted

    summary = (await client.get(f"{API}/chats/", headers=b_headers)).json()[0]
    assert summary["last_message_kind"] == "video_note"
    assert summary["last_message"] == ""


@pytest.mark.asyncio
async def test_upload_video_note_without_ffmpeg_keeps_original(client, media_dir, monkeypatch):  # noqa: F811
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: None)
    content = _mp4(b"vide", duration_s=5)
    resp = await _post(client, chat_id, a_headers, content, data={"kind": "video_note"})
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["kind"] == "video_note"
    assert msg["attachment"]["mime"] == "video/mp4"
    assert _stored_bytes(media_dir, msg["attachment"]["url"]) == content


@pytest.mark.asyncio
async def test_upload_video_note_rejections(client, media_dir, monkeypatch):  # noqa: F811
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: None)

    # Un vocal nu poate deveni „кружок".
    resp = await _post(client, chat_id, a_headers, _webm_opus(), data={"kind": "video_note"})
    assert resp.status_code == 415, resp.text
    # Peste 60 s (durata reală din mp4) → 413.
    resp = await _post(client, chat_id, a_headers, _mp4(b"vide", duration_s=90),
                       data={"kind": "video_note"})
    assert resp.status_code == 413, resp.text
    # Altă valoare pentru `kind` → 422.
    resp = await _post(client, chat_id, a_headers, _mp4(b"vide"), data={"kind": "image"})
    assert resp.status_code == 422, resp.text

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    assert resp.json() == []


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
async def test_real_transcode_is_square_h264(tmp_path):
    src = tmp_path / "in.webm"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc=size=640x360:rate=25:duration=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-c:v", "libvpx", "-c:a", "libopus", "-shortest", str(src),
    )
    await proc.wait()
    if proc.returncode != 0:
        pytest.skip("ffmpeg fără libvpx / libopus")
    media = as_video_note(chat_media.validate_attachment(src.read_bytes(), 1000))
    assert media.mime == "video/webm"

    out = await ensure_playable_video_note(media)
    if out is media:
        pytest.skip("ffmpeg fără libx264")
    assert out.mime == "video/mp4"
    assert out.content[4:8] == b"ftyp"
    assert b"avc1" in out.content and b"mp4a" in out.content
    assert (out.width, out.height) == (VIDEO_NOTE_SIDE, VIDEO_NOTE_SIDE)
    assert out.duration_ms and 800 <= out.duration_ms <= 1300
