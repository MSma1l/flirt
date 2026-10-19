"""Vocalele din chat se convertesc în AAC/M4A, ca să se audă și pe iOS.

Conversia reală are nevoie de ffmpeg (prezent în imaginea Docker); fără el,
testul de conversie e sărit, iar fallback-ul (fișierul original) e verificat.
"""
import asyncio
import shutil

import pytest

from app.services import chat_media
from app.services.chat_media import ChatMedia, ensure_playable_voice, needs_voice_transcode

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def _voice(mime: str, content: bytes = b"x" * 64) -> ChatMedia:
    return ChatMedia(kind="voice", mime=mime, content=content, duration_ms=1500)


def test_which_voices_need_transcoding():
    assert needs_voice_transcode(_voice("audio/webm"))
    assert needs_voice_transcode(_voice("audio/ogg"))
    # MP4 cu Opus (Chrome recent) → da; MP4 cu AAC (`mp4a`, iOS) → nu.
    assert needs_voice_transcode(_voice("audio/mp4", b"....ftypisom....Opus...."))
    assert not needs_voice_transcode(_voice("audio/mp4", b"....ftypM4A ....mp4a...."))
    assert not needs_voice_transcode(_voice("audio/aac"))
    assert not needs_voice_transcode(_voice("audio/mpeg"))
    assert not needs_voice_transcode(
        ChatMedia(kind="video", mime="video/webm", content=b"x")
    )


async def test_without_ffmpeg_the_original_is_kept(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: None)
    media = _voice("audio/webm")
    assert await ensure_playable_voice(media) is media


async def test_failed_conversion_keeps_the_original(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def failing(*args, **kwargs):
        return False

    monkeypatch.setattr(chat_media, "_run_ffmpeg", failing)
    media = _voice("audio/ogg")
    assert await ensure_playable_voice(media) is media


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
async def test_webm_opus_is_converted_to_m4a(tmp_path):
    src = tmp_path / "in.webm"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1", "-c:a", "libopus", str(src),
    )
    await proc.wait()
    if proc.returncode != 0:
        pytest.skip("ffmpeg fără libopus")
    media = chat_media.validate_attachment(src.read_bytes(), 1000)
    assert media.mime == "audio/webm"

    out = await ensure_playable_voice(media)
    assert out.mime == "audio/mp4"
    assert out.content[4:8] == b"ftyp"
    assert b"mp4a" in out.content
    assert out.duration_ms and 800 <= out.duration_ms <= 1300
