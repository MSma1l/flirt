"""Pipeline-ul mesajelor video rotunde („кружки"): `ensure_playable_video_note`.

- unitar (fără ffmpeg): argumentele ffmpeg, tratarea eșecurilor (503 / 422 /
  originalul păstrat), curățarea fișierelor temporare;
- ruta: un WebM a cărui conversie eșuează → 503, nimic salvat;
- REAL (doar dacă ffmpeg există pe mașină): clipuri generate cu lavfi — peisaj
  cu / fără sunet, portret, rotație iOS (matrice de afișare), MP4 fragmentat
  (MediaRecorder), WebM VP8/Opus cu ritm variabil (Chrome), VP9 fără sunet —
  ies toate MP4 H.264 yuv420p 480×480, `moov` la început, fără rotație.

Helperii rutei se importă ÎN test, ca testele fără bază de date să poată rula
și separat (ex. într-un container cu ffmpeg: `pytest --noconftest -k "not route"`).
"""
import asyncio
import json
import os
import shutil
import struct
import tempfile

import pytest
from fastapi import HTTPException

from app.services import chat_media
from app.services.chat_media import (
    VIDEO_NOTE_FPS,
    VIDEO_NOTE_KIND,
    VIDEO_NOTE_MIN_DURATION_MS,
    VIDEO_NOTE_SIDE,
    ChatMedia,
    as_video_note,
    ensure_playable_video_note,
    validate_attachment,
    video_note_ffmpeg_args,
)

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def _mp4(handler: bytes | None, duration_ms: int) -> bytes:
    """MP4 minimal: ftyp + moov(mvhd [+ trak/mdia/hdlr]) + mdat."""
    ftyp = _box(b"ftyp", b"isom\x00\x00\x02\x00isommp41")
    mvhd = _box(b"mvhd", b"\x00" * 12 + struct.pack(">II", 1000, duration_ms) + b"\x00" * 80)
    trak = b""
    if handler is not None:
        hdlr = _box(b"hdlr", b"\x00" * 8 + handler + b"\x00" * 13)
        trak = _box(b"trak", _box(b"mdia", hdlr))
    return ftyp + _box(b"moov", mvhd + trak) + _box(b"mdat", b"\x00" * 64)


def _note(mime: str, content: bytes = b"x") -> ChatMedia:
    return ChatMedia(kind=VIDEO_NOTE_KIND, mime=mime, content=content, duration_ms=5_000)


def _fake_ffmpeg(monkeypatch, *, output: bytes | None, ok: bool = True, seen: list | None = None):
    """ffmpeg simulat: scrie `output` în destinație și întoarce `ok`."""
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def fake(ffmpeg, src, demuxer, dst):
        if seen is not None:
            seen.append(os.path.dirname(src))
        if output is not None:
            with open(dst, "wb") as fh:
                fh.write(output)
        return ok

    monkeypatch.setattr(chat_media, "_run_ffmpeg_video_note", fake)


# --- Argumentele ffmpeg ------------------------------------------------------
def test_args_center_square_constant_fps_no_metadata():
    args = video_note_ffmpeg_args("/tmp/in", "mov", "/tmp/out.mp4")
    vf = args[args.index("-vf") + 1]
    # Ritm constant ÎNAINTE de decupaj; decupajul fără x/y = central.
    assert vf == (
        f"fps={VIDEO_NOTE_FPS},crop='min(iw,ih)':'min(iw,ih)',"
        f"scale={VIDEO_NOTE_SIDE}:{VIDEO_NOTE_SIDE},setsar=1"
    )
    # Fără metadate (data / GPS din MOV); autorotate NU e dezactivat.
    assert args[args.index("-map_metadata") + 1] == "-1"
    assert "-noautorotate" not in args
    assert args[args.index("-af") + 1] == "aresample=async=1"
    assert args[args.index("-pix_fmt") + 1] == "yuv420p"
    assert args[args.index("-movflags") + 1] == "+faststart"
    assert args[args.index("-c:v") + 1] == "libx264"
    assert args[args.index("-c:a") + 1] == "aac"
    # Durata plafonată (WebM-ul din MediaRecorder n-are durată în container).
    assert float(args[args.index("-t") + 1]) <= 63


# --- Eșecuri / validarea ieșirii ----------------------------------------------
async def test_failed_webm_conversion_is_503(monkeypatch):
    _fake_ffmpeg(monkeypatch, output=None, ok=False)
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(_note("video/webm"))
    assert exc.value.status_code == 503


async def test_failed_mp4_conversion_keeps_original(monkeypatch):
    # MP4/MOV de pe iPhone (H.264) se redă oricum peste tot → degradare, nu eroare.
    _fake_ffmpeg(monkeypatch, output=None, ok=False)
    media = _note("video/quicktime")
    assert await ensure_playable_video_note(media) is media


async def test_output_without_video_track_is_422(monkeypatch):
    # ffmpeg iese cu 0 și când n-a decodat niciun cadru.
    _fake_ffmpeg(monkeypatch, output=_mp4(b"soun", 3_000))
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(_note("video/webm"))
    assert exc.value.status_code == 422


async def test_output_too_short_is_422(monkeypatch):
    _fake_ffmpeg(monkeypatch, output=_mp4(b"vide", VIDEO_NOTE_MIN_DURATION_MS - 100))
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(_note("video/mp4"))
    assert exc.value.status_code == 422


async def test_output_over_size_limit_webm_is_503(monkeypatch):
    _fake_ffmpeg(monkeypatch, output=_mp4(b"vide", 3_000))
    monkeypatch.setattr(chat_media.settings, "chat_video_max_bytes", 10)
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(_note("video/webm"))
    assert exc.value.status_code == 503


async def test_success_uses_real_duration_and_square(monkeypatch):
    _fake_ffmpeg(monkeypatch, output=_mp4(b"vide", 4_321))
    out = await ensure_playable_video_note(_note("video/webm"))
    assert (out.kind, out.mime, out.duration_ms) == (VIDEO_NOTE_KIND, "video/mp4", 4_321)
    assert (out.width, out.height) == (VIDEO_NOTE_SIDE, VIDEO_NOTE_SIDE)


@pytest.mark.parametrize("ok", [True, False])
async def test_temp_files_are_removed(monkeypatch, tmp_path, ok):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    seen: list[str] = []
    _fake_ffmpeg(monkeypatch, output=_mp4(b"vide", 2_000), ok=ok, seen=seen)
    try:
        await ensure_playable_video_note(_note("video/webm"))
    except HTTPException:
        pass
    assert seen and seen[0].startswith(str(tmp_path))
    assert list(tmp_path.iterdir()) == []


async def test_temp_files_are_removed_on_cancel(monkeypatch, tmp_path):
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def slow(*args, **kwargs):
        await asyncio.sleep(10)
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg_video_note", slow)
    task = asyncio.ensure_future(ensure_playable_video_note(_note("video/webm")))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert list(tmp_path.iterdir()) == []


# --- Ruta ---------------------------------------------------------------------
@pytest.mark.asyncio
async def test_route_failed_webm_conversion_is_503_and_nothing_saved(client, tmp_path, monkeypatch):
    from app.services import storage
    from tests.test_chat import API, _chat_id_for, _matched_pair
    from tests.test_chat_attachments import _post

    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    _fake_ffmpeg(monkeypatch, output=None, ok=False)

    webm = (
        b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm" + b"\x00" * 32
        + b"\x86\x85V_VP8" + b"\x00" * 16 + b"\x86\x86A_OPUS" + b"\x00" * 64
    )
    resp = await _post(
        client, chat_id, a_headers, webm, name="n.webm", ct="video/webm",
        data={"kind": "video_note", "duration_ms": "4000"},
    )
    assert resp.status_code == 503, resp.text
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    assert resp.json() == []
    assert not (tmp_path / "chat-media").exists()


# --- Conversie REALĂ cu ffmpeg --------------------------------------------------
async def _sh(*args: str) -> tuple[int, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    out, _ = await proc.communicate()
    return proc.returncode, out


_FF = ("ffmpeg", "-hide_banner", "-loglevel", "error", "-y")
_SINE = ("-f", "lavfi", "-i", "sine=frequency=440:duration=3")
_H264 = ("-c:v", "libx264", "-pix_fmt", "yuv420p")

# nume → argumentele ffmpeg care generează clipul (fără fișierul de ieșire).
_CLIPS: dict[str, tuple[str, ...]] = {
    "landscape_audio.mp4": (
        "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", *_SINE,
        *_H264, "-c:a", "aac", "-shortest",
    ),
    "landscape_silent.mp4": (
        "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3", *_H264,
    ),
    "portrait.mp4": (
        "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=3", *_SINE,
        *_H264, "-c:a", "aac", "-shortest",
    ),
    "fragmented.mp4": (
        "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=3", *_SINE,
        *_H264, "-c:a", "aac", "-shortest",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    ),
    # Ritm variabil (30 → 12 fps) + jitter: ffmpeg ghicește 1000 fps, ca la Chrome.
    "chrome_vfr.webm": (
        "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=1.5",
        "-f", "lavfi", "-i", "testsrc=size=640x480:rate=12:duration=1.5", *_SINE,
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1[c];[c]setpts='PTS+0.02*random(1)/TB'[v]",
        "-map", "[v]", "-map", "2:a", "-c:v", "libvpx", "-b:v", "1M",
        "-c:a", "libopus", "-fps_mode", "passthrough", "-shortest",
    ),
    "vp9_silent.webm": (
        "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=2",
        "-c:v", "libvpx-vp9", "-b:v", "500k",
    ),
}


async def _probe(path: str) -> dict:
    rc, out = await _sh(
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate"
        ":stream_side_data=rotation",
        "-of", "json", path,
    )
    assert rc == 0
    return json.loads(out)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
@pytest.mark.parametrize("name", sorted([*_CLIPS, "rotated.mov"]))
async def test_real_transcode(tmp_path, name):
    if name == "rotated.mov":
        # iPhone: cadre stocate în peisaj + matrice de afișare 90° (= portret).
        base = tmp_path / "base.mp4"
        rc, _ = await _sh(*_FF, *_CLIPS["landscape_audio.mp4"], str(base))
        rc = rc or (await _sh(*_FF, "-display_rotation", "90", "-i", str(base),
                              "-c", "copy", str(tmp_path / name)))[0]
    else:
        rc, _ = await _sh(*_FF, *_CLIPS[name], str(tmp_path / name))
    if rc != 0:
        pytest.skip(f"ffmpeg nu poate genera {name} (codec lipsă)")

    media = as_video_note(validate_attachment((tmp_path / name).read_bytes(), 3_000))
    out = await ensure_playable_video_note(media)
    assert out is not media, "conversia a eșuat (libx264 lipsă?)"
    assert out.mime == "video/mp4" and out.kind == VIDEO_NOTE_KIND
    assert (out.width, out.height) == (VIDEO_NOTE_SIDE, VIDEO_NOTE_SIDE)
    assert out.duration_ms and 1_500 <= out.duration_ms <= 3_500
    # `faststart`: `moov` înaintea `mdat`.
    assert 0 < out.content.find(b"moov") < out.content.find(b"mdat")

    dst = tmp_path / "out.mp4"
    dst.write_bytes(out.content)
    streams = (await _probe(str(dst)))["streams"]
    video = [s for s in streams if s["codec_type"] == "video"]
    audio = [s for s in streams if s["codec_type"] == "audio"]
    assert len(video) == 1
    v = video[0]
    assert (v["codec_name"], v["pix_fmt"]) == ("h264", "yuv420p")
    assert (v["width"], v["height"]) == (VIDEO_NOTE_SIDE, VIDEO_NOTE_SIDE)
    assert v["avg_frame_rate"] == f"{VIDEO_NOTE_FPS}/1"
    # Rotația e aplicată în pixeli: fișierul final nu mai are matrice de afișare.
    assert not v.get("side_data_list")
    if "silent" in name:
        assert audio == []
    else:
        assert [a["codec_name"] for a in audio] == ["aac"]


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
async def test_real_single_frame_is_rejected(tmp_path):
    src = tmp_path / "one.webm"
    rc, _ = await _sh(*_FF, "-f", "lavfi", "-i", "testsrc=size=640x480:rate=30:duration=0.04",
                      "-c:v", "libvpx", str(src))
    if rc != 0:
        pytest.skip("ffmpeg fără libvpx")
    media = as_video_note(validate_attachment(src.read_bytes(), 40))
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(media)
    assert exc.value.status_code == 422


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg lipsește pe această mașină")
async def test_real_garbage_webm_is_503():
    # Antet WebM valid (trece de magic bytes), conținut stricat.
    junk = (
        b"\x1a\x45\xdf\xa3\x9f\x42\x82\x84webm" + b"\x00" * 32
        + b"\x86\x85V_VP8" + b"\x00" * 16 + b"\x86\x86A_OPUS" + b"\x00" * 64
    )
    media = as_video_note(validate_attachment(junk, 2_000))
    with pytest.raises(HTTPException) as exc:
        await ensure_playable_video_note(media)
    assert exc.value.status_code == 503
