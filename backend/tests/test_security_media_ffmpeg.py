"""Regresii de securitate: limitele ffmpeg, geocodarea Mapbox, versiunea Pillow.

Comenzile ffmpeg reale (webm/opus, ogg/opus, mp4/aac fragmentat, mp4 h264, webm
vp8/vp9, hevc) au fost validate cu ffmpeg 7.1 în imaginea de producție
(python:3.12-slim + apt ffmpeg); testele de mai jos verifică argumentele și
plafoanele fără să ceară ffmpeg pe mașina de dezvoltare.
"""
from __future__ import annotations

import asyncio
import pathlib
import re
import struct

import httpx
import pytest

from app.core.config import settings
from app.services import chat_media, geo
from app.services.chat_media import ChatMedia

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _input_part(args: list[str]) -> list[str]:
    return args[: args.index("-i")]


@pytest.mark.parametrize(
    "build",
    [chat_media.voice_ffmpeg_args, chat_media.video_note_ffmpeg_args],
)
def test_ffmpeg_input_options_are_whitelisted_and_single_threaded(build):
    args = build("/tmp/in", "matroska", "/tmp/out")
    head = _input_part(args)
    # Toate opțiunile de intrare stau ÎNAINTEA lui `-i` (altfel s-ar aplica ieșirii).
    assert head[head.index("-threads") + 1] == "1"
    assert head[head.index("-protocol_whitelist") + 1] == "file"
    formats = head[head.index("-format_whitelist") + 1].split(",")
    assert "matroska" in formats and "wav" not in formats and "concat" not in formats
    codecs = head[head.index("-codec_whitelist") + 1].split(",")
    assert "opus" in codecs and "aac" in codecs
    assert "flac" not in codecs and "pcm_s16le" not in codecs
    assert head[-2:] == ["-f", "matroska"]


def test_voice_args_cap_duration():
    args = chat_media.voice_ffmpeg_args("/tmp/in", "ogg", "/tmp/out.m4a")
    out = args[args.index("-i") :]
    limit_s = settings.chat_voice_max_duration_ms / 1000
    assert float(out[out.index("-t") + 1]) <= limit_s + 1


def _m4a(duration_ms: int) -> bytes:
    """M4A minimal nefragmentat (ftyp + moov cu mvhd + mp4a) cu durata dată."""

    def box(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", 8 + len(payload)) + kind + payload

    mvhd = box(b"mvhd", b"\x00" * 12 + struct.pack(">II", 1000, duration_ms) + b"\x00" * 80)
    moov = box(b"moov", mvhd + box(b"trak", box(b"mp4a", b"\x00" * 8)))
    return box(b"ftyp", b"M4A \x00\x00\x00\x00") + moov


@pytest.mark.asyncio
async def test_voice_longer_than_limit_rejected_after_transcode(monkeypatch):
    """Durata declarată de client minte (WebM fără durată) → ieșirea reală decide."""
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")
    too_long = settings.chat_voice_max_duration_ms + 1000  # `-t` = limită + 1 s

    async def fake(ffmpeg, src, demuxer, dst):
        with open(dst, "wb") as fh:
            fh.write(_m4a(too_long))
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg", fake)
    media = ChatMedia(kind="voice", mime="audio/webm", content=b"x", duration_ms=5000)
    with pytest.raises(Exception) as exc:
        await chat_media.ensure_playable_voice(media)
    assert exc.value.status_code == 413

    async def fine(ffmpeg, src, demuxer, dst):
        with open(dst, "wb") as fh:
            fh.write(_m4a(settings.chat_voice_max_duration_ms))
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg", fine)
    out = await chat_media.ensure_playable_voice(media)
    assert out.mime == "audio/mp4"


class _FakeProc:
    def __init__(self, tracker) -> None:
        self.tracker = tracker
        self.returncode = None
        self.pid = 999_999_999  # inexistent: `prlimit` eșuează tăcut

    async def communicate(self):
        self.tracker["running"] += 1
        self.tracker["peak"] = max(self.tracker["peak"], self.tracker["running"])
        await asyncio.sleep(0.05)
        self.tracker["running"] -= 1
        self.returncode = 0
        return b"", b""

    def kill(self):
        self.returncode = -9

    async def wait(self):
        return self.returncode


@pytest.mark.asyncio
async def test_transcodes_are_bounded_per_worker(monkeypatch):
    tracker = {"running": 0, "peak": 0}
    seen_args = []

    async def fake_exec(*args, **kwargs):
        seen_args.append(args)
        return _FakeProc(tracker)

    monkeypatch.setattr(chat_media.asyncio, "create_subprocess_exec", fake_exec)
    results = await asyncio.gather(
        *(
            chat_media._run_ffmpeg("ffmpeg", "/tmp/in", "ogg", "/tmp/out.m4a")
            for _ in range(8)
        )
    )
    assert all(results)
    assert tracker["peak"] <= chat_media.MAX_CONCURRENT_TRANSCODES == 2
    assert len(seen_args) == 8


@pytest.mark.asyncio
async def test_cancelled_request_kills_ffmpeg(monkeypatch):
    killed = []

    class Hanging(_FakeProc):
        async def communicate(self):
            await asyncio.sleep(3600)

        def kill(self):
            killed.append(True)
            self.returncode = -9

    async def fake_exec(*args, **kwargs):
        return Hanging({"running": 0, "peak": 0})

    monkeypatch.setattr(chat_media.asyncio, "create_subprocess_exec", fake_exec)
    task = asyncio.create_task(
        chat_media._run_ffmpeg("ffmpeg", "/tmp/in", "ogg", "/tmp/out.m4a")
    )
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert killed == [True]
    # Slotul semaforului a fost eliberat: o nouă transcodare pornește imediat.
    tracker = {"running": 0, "peak": 0}

    async def ok_exec(*args, **kwargs):
        return _FakeProc(tracker)

    monkeypatch.setattr(chat_media.asyncio, "create_subprocess_exec", ok_exec)
    assert await asyncio.wait_for(
        chat_media._run_ffmpeg("ffmpeg", "/tmp/in", "ogg", "/tmp/o.m4a"), 2
    )


# --- 9. Mapbox: interogarea e un SINGUR segment de path ----------------------
@pytest.mark.asyncio
async def test_mapbox_query_slash_is_encoded(monkeypatch):
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"features": [{"center": [28.8, 47.0]}]})

    real_client = httpx.AsyncClient

    def client_factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(geo.httpx, "AsyncClient", client_factory)
    result = await geo.MapboxGeocoder("k").geocode("../../tokens/v2?x=", "a/b")
    assert result == (47.0, 28.8)
    path = seen[0].raw_path.decode()
    prefix = "/geocoding/v5/mapbox.places/"
    assert path.startswith(prefix)
    segment = path[len(prefix) :].split("?", 1)[0]
    assert "/" not in segment and segment.endswith(".json")
    assert "%2F" in segment


# --- 10. Pillow ≥ 10.3 --------------------------------------------------------
def test_pillow_minimum_version():
    text = (ROOT / "pyproject.toml").read_text()
    match = re.search(r'"Pillow>=(\d+)\.(\d+)', text)
    assert match is not None
    assert (int(match.group(1)), int(match.group(2))) >= (10, 3)
