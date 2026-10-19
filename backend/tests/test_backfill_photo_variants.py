"""Teste pentru `scripts/backfill_photo_variants.py` (provider local, fără DB)."""
import importlib.util
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

from app.services import storage

_PATH = Path(__file__).resolve().parent.parent / "scripts" / "backfill_photo_variants.py"
_spec = importlib.util.spec_from_file_location("backfill_photo_variants", _PATH)
bf = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = bf  # @dataclass are nevoie de modul înregistrat
_spec.loader.exec_module(bf)

HEX = "0123456789abcdef0123456789abcdef"
HEX2 = "fedcba9876543210fedcba9876543210"


def _jpeg_with_gps(size=(2400, 1800)) -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"
    gps = exif.get_ifd(0x8825)
    gps[1] = "N"
    gps[2] = (47.0, 1.0, 30.0)
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 120, 200)).save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def _png(size=(300, 300)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, (0, 0, 0, 0)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


def _put(root: Path, key: str, data: bytes) -> Path:
    p = root / key
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


def test_is_original_key():
    assert bf.is_original_key(f"photos/u/{HEX}.jpg")
    assert bf.is_original_key(f"events/{HEX}.PNG")
    assert not bf.is_original_key(f"photos/u/{HEX}_256.webp")
    assert not bf.is_original_key(f"stories/u/{HEX}.mp4")
    assert not bf.is_original_key("photos/u/poza.jpg")


def test_keys_from_photo_lists(local):
    keys = bf.keys_from_photo_lists(
        [
            [f"https://api.flrt.md/media/photos/u1/{HEX}.jpg", "https://evil.com/x.jpg"],
            None,
            [f"https://api.flrt.md/media/photos/u1/{HEX}.jpg", 5,
             f"https://api.flrt.md/media/photos/u2/{HEX2}.png"],
        ]
    )
    assert keys == [f"photos/u1/{HEX}.jpg", f"photos/u2/{HEX2}.png"]


async def test_backfill_jpeg_rescrie_originalul_si_scrie_variante(local):
    key = f"photos/u1/{HEX}.jpg"
    src = _put(local, key, _jpeg_with_gps())
    before = src.read_bytes()

    stats = await bf.run(prefix=None, limit=None, dry_run=False, sizes=(256, 800),
                         keys=[key])

    assert stats.processed == 1
    after = src.read_bytes()
    assert after != before and b"PhoneMaker" not in after
    img = Image.open(io.BytesIO(after))
    assert img.size == (1600, 1200) and not img.getexif()
    assert Image.open(local / f"photos/u1/{HEX}_256.webp").size == (256, 192)
    assert Image.open(local / f"photos/u1/{HEX}_800.webp").size == (800, 600)

    # Idempotent: a doua rulare sare cheia.
    again = await bf.run(prefix=None, limit=None, dry_run=False, sizes=(256, 800),
                         keys=[key])
    assert again.skipped == 1 and again.processed == 0


async def test_backfill_png_lasa_originalul_neatins(local):
    key = f"photos/u1/{HEX2}.png"
    data = _png()
    _put(local, key, data)

    stats = await bf.run(prefix=None, limit=None, dry_run=False, sizes=(256, 800),
                         keys=[key])

    assert stats.processed == 1
    assert (local / key).read_bytes() == data
    assert (local / f"photos/u1/{HEX2}_256.webp").exists()
    assert (local / f"photos/u1/{HEX2}_800.webp").exists()


async def test_dry_run_nu_scrie_nimic(local):
    key = f"photos/u1/{HEX}.jpg"
    data = _jpeg_with_gps((400, 300))
    _put(local, key, data)

    stats = await bf.run(prefix=None, limit=None, dry_run=True, sizes=(256, 800), keys=[key])

    assert stats.processed == 1
    assert (local / key).read_bytes() == data
    assert not (local / f"photos/u1/{HEX}_256.webp").exists()


async def test_prefix_limit_lipsa_si_invalid(local):
    _put(local, f"stories/u1/{HEX}.jpg", _jpeg_with_gps((500, 500)))
    _put(local, f"stories/u1/{HEX2}.webp", b"nu e imagine")
    _put(local, f"stories/u1/{'a' * 32}.mp4", b"video")

    stats = await bf.run(prefix="stories/", limit=None, dry_run=False, sizes=(480,))
    assert stats.processed == 1 and stats.invalid == 1
    assert (local / f"stories/u1/{HEX}_480.webp").exists()

    limited = await bf.run(prefix="stories/", limit=1, dry_run=False, sizes=(480,))
    assert limited.skipped == 1 and limited.processed == 0

    missing = await bf.run(prefix=None, limit=None, dry_run=False, sizes=(256,),
                           keys=[f"photos/u9/{HEX}.jpg"])
    assert missing.missing == 1


def test_parse_args():
    args = bf.parse_args(["--dry-run", "--limit", "5", "--prefix", "events/", "--sizes", "256,800,480"])
    assert args.dry_run and args.limit == 5 and args.prefix == "events/"
    assert args.sizes == (256, 800, 480)
    assert bf.parse_args([]).sizes == (256, 800)
