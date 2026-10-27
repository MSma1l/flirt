"""Teste pentru `scripts/backfill_voice_m4a.py` (provider local, ffmpeg simulat, fără DB)."""
import importlib.util
import struct
import sys
import uuid
from pathlib import Path

import pytest

from app.services import chat_media, storage

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "backfill_voice_m4a.py"
_spec = importlib.util.spec_from_file_location("backfill_voice_m4a", _PATH)
bf = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bf  # @dataclass are nevoie de modul înregistrat
_spec.loader.exec_module(bf)

CHAT = uuid.UUID("11111111-2222-3333-4444-555555555555")
WEBM_OPUS = b"\x1a\x45\xdf\xa3" + b"\x42\x82\x84webm" + b"..A_OPUS.." + b"\x00" * 64


def _box(kind: bytes, payload: bytes = b"") -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


M4A_PLAIN = (
    _box(b"ftyp", b"M4A \x00\x00\x02\x00isomiso2")
    + _box(b"moov", _box(b"trak", b"....mp4a...."))
    + _box(b"mdat", b"\x21" * 32)
)


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


@pytest.fixture
def fake_ffmpeg(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: "/usr/bin/ffmpeg")

    async def run(ffmpeg, src, demuxer, dst):
        calls.append(demuxer)
        with open(dst, "wb") as fh:
            fh.write(M4A_PLAIN)
        return True

    monkeypatch.setattr(chat_media, "_run_ffmpeg", run)
    return calls


def _put(root: Path, key: str, data: bytes) -> str:
    p = root / key
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return f"https://api.flrt.md/media/{key}"


async def test_webm_voice_is_converted_to_a_new_m4a_key(local, fake_ffmpeg):
    url = _put(local, f"chat-media/{CHAT}/{'a' * 32}.weba", WEBM_OPUS)
    stats = bf.Stats()
    row = bf.VoiceRow(id=uuid.uuid4(), chat_id=CHAT, url=url, duration_ms=4000)

    fields = await bf.convert_row(storage.get_storage(), row, dry_run=False, stats=stats)

    assert fake_ffmpeg == ["matroska"]
    assert stats.converted == 1
    assert fields["attachment_mime"] == "audio/mp4"
    assert fields["attachment_url"].startswith(f"https://api.flrt.md/media/chat-media/{CHAT}/")
    assert fields["attachment_url"].endswith(".m4a")
    assert fields["attachment_size"] == len(M4A_PLAIN)
    assert fields["attachment_duration_ms"] == 4000
    new_key = fields["attachment_url"].removeprefix("https://api.flrt.md/media/")
    assert (local / new_key).read_bytes() == M4A_PLAIN
    # Fișierul vechi rămâne (rollback), cheia nouă e diferită.
    assert (local / f"chat-media/{CHAT}/{'a' * 32}.weba").exists()


async def test_plain_m4a_is_skipped(local, fake_ffmpeg):
    url = _put(local, f"chat-media/{CHAT}/{'b' * 32}.m4a", M4A_PLAIN)
    stats = bf.Stats()
    row = bf.VoiceRow(id=uuid.uuid4(), chat_id=CHAT, url=url, duration_ms=1000)

    assert await bf.convert_row(storage.get_storage(), row, dry_run=False, stats=stats) is None
    assert stats.skipped == 1 and fake_ffmpeg == []


async def test_dry_run_writes_nothing(local, fake_ffmpeg):
    url = _put(local, f"chat-media/{CHAT}/{'c' * 32}.weba", WEBM_OPUS)
    stats = bf.Stats()
    row = bf.VoiceRow(id=uuid.uuid4(), chat_id=CHAT, url=url, duration_ms=None)

    assert await bf.convert_row(storage.get_storage(), row, dry_run=True, stats=stats) is None
    assert stats.converted == 1 and fake_ffmpeg == []
    assert len(list((local / f"chat-media/{CHAT}").iterdir())) == 1


async def test_missing_and_failed_files_are_counted(local, monkeypatch):
    stats = bf.Stats()
    gone = bf.VoiceRow(
        id=uuid.uuid4(), chat_id=CHAT,
        url=f"https://api.flrt.md/media/chat-media/{CHAT}/{'d' * 32}.weba", duration_ms=None,
    )
    assert await bf.convert_row(storage.get_storage(), gone, dry_run=False, stats=stats) is None
    assert stats.missing == 1

    monkeypatch.setattr(chat_media, "_ffmpeg_path", lambda: None)
    url = _put(local, f"chat-media/{CHAT}/{'e' * 32}.weba", WEBM_OPUS)
    row = bf.VoiceRow(id=uuid.uuid4(), chat_id=CHAT, url=url, duration_ms=None)
    assert await bf.convert_row(storage.get_storage(), row, dry_run=False, stats=stats) is None
    assert stats.failed == 1
