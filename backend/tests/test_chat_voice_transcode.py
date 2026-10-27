"""Vocalele din chat se convertesc în AAC/M4A, ca să se audă și pe iOS.

Conversia reală are nevoie de ffmpeg (prezent în imaginea Docker); fără el,
testul de conversie e sărit, iar fallback-ul (fișierul original) e verificat.
"""
import asyncio
import shutil
import struct

import pytest

from app.services import chat_media
from app.services.chat_media import (
    ChatMedia,
    ensure_playable_voice,
    is_universal_voice,
    needs_voice_transcode,
)

HAS_FFMPEG = shutil.which("ffmpeg") is not None


def _voice(mime: str, content: bytes = b"x" * 64) -> ChatMedia:
    return ChatMedia(kind="voice", mime=mime, content=content, duration_ms=1500)


def _box(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


# M4A obișnuit (cum îl scrie ffmpeg `-f ipod +faststart` sau expo-av pe mobil).
M4A_PLAIN = (
    _box(b"ftyp", b"M4A \x00\x00\x02\x00isomiso2")
    + _box(b"moov", _box(b"trak", b"....mp4a...."))
    + _box(b"mdat", b"\x21" * 32)
)
# Ieșirea brută a `MediaRecorder` (Chrome / Safari): MP4 FRAGMENTAT cu AAC.
M4A_FRAGMENTED = (
    _box(b"ftyp", b"iso6\x00\x00\x00\x00iso6mp41")
    + _box(b"moov", _box(b"trak", b"....mp4a....") + _box(b"mvex"))
    + _box(b"moof", _box(b"mfhd"))
    + _box(b"mdat", b"\x21" * 32)
)
MP4_OPUS = (
    _box(b"ftyp", b"isom\x00\x00\x02\x00isom")
    + _box(b"moov", _box(b"trak", b"....Opus...."))
    + _box(b"mdat", b"\x21" * 32)
)


def test_which_voices_need_transcoding():
    assert needs_voice_transcode(_voice("audio/webm"))
    assert needs_voice_transcode(_voice("audio/ogg"))
    # MP4 cu Opus (Chrome) → da.
    assert needs_voice_transcode(_voice("audio/mp4", MP4_OPUS))
    # MP4 FRAGMENTAT din MediaRecorder, chiar cu AAC → da (iOS nu-l redă sigur).
    assert needs_voice_transcode(_voice("audio/mp4", M4A_FRAGMENTED))
    # AAC brut (ADTS): `.aac` nu are tip MIME sigur peste tot → da.
    assert needs_voice_transcode(_voice("audio/aac"))
    # M4A obișnuit cu AAC → nu (deja canonic); MP3 se redă peste tot → nu.
    assert not needs_voice_transcode(_voice("audio/mp4", M4A_PLAIN))
    assert not needs_voice_transcode(_voice("audio/mpeg"))
    assert not needs_voice_transcode(
        ChatMedia(kind="video", mime="video/webm", content=b"x")
    )


def test_universal_voice_detection_parses_top_level_boxes():
    assert is_universal_voice(M4A_PLAIN)
    assert not is_universal_voice(M4A_FRAGMENTED)
    assert not is_universal_voice(MP4_OPUS)
    assert not is_universal_voice(b"")
    assert not is_universal_voice(b"\x1a\x45\xdf\xa3" + b"x" * 64)  # WebM
    # „moof" ca simplu șir în datele audio NU face fișierul fragmentat.
    noisy = M4A_PLAIN[:-40] + _box(b"mdat", b"..moof.." * 4)
    assert is_universal_voice(noisy)
    # Box trunchiat / dimensiune invalidă: fără excepții.
    assert not is_universal_voice(b"\x00\x00\x00\x02ftyp")


async def test_converted_output_replaces_the_original(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")
    seen: dict = {}

    async def fake_ffmpeg(ffmpeg, src, demuxer, dst):
        seen["demuxer"] = demuxer
        with open(dst, "wb") as fh:
            fh.write(M4A_PLAIN)
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg", fake_ffmpeg)
    out = await ensure_playable_voice(_voice("audio/aac", b"\xff\xf1" + b"x" * 62))
    assert seen["demuxer"] == "aac"
    assert out.mime == "audio/mp4"
    assert out.content == M4A_PLAIN
    # Fără `mvhd` în fișierul fals → rămâne durata declarată.
    assert out.duration_ms == 1500


async def test_output_that_is_not_plain_m4a_keeps_the_original(monkeypatch):
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def bad_output(ffmpeg, src, demuxer, dst):
        with open(dst, "wb") as fh:
            fh.write(M4A_FRAGMENTED)
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg", bad_output)
    media = _voice("audio/mp4", M4A_FRAGMENTED)
    assert await ensure_playable_voice(media) is media


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
    assert is_universal_voice(out.content)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
async def test_fragmented_mp4_aac_is_normalised(tmp_path):
    """Ieșirea tipică a `MediaRecorder` (MP4 fragmentat cu AAC) → M4A obișnuit."""
    src = tmp_path / "in.mp4"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1", "-c:a", "aac",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof", str(src),
    )
    await proc.wait()
    assert proc.returncode == 0
    media = chat_media.validate_attachment(src.read_bytes(), 1000)
    assert media.kind == "voice" and media.mime == "audio/mp4"
    assert needs_voice_transcode(media)

    out = await ensure_playable_voice(media)
    assert out is not media
    assert is_universal_voice(out.content)
    assert out.duration_ms and 800 <= out.duration_ms <= 1300
