"""Teste pentru `image_variants` (curățare EXIF, micșorare, variante WebP)
și pentru `storage.delete`, care șterge și variantele unei chei."""
import io

import pytest
from PIL import Image

from app.services import storage
from app.services.image_variants import (
    InvalidImage,
    ProcessedImage,
    process_image,
    save_with_variants,
    variant_key,
)
from app.services.storage import LocalStorage, variant_keys_for

GPS_IFD = 0x8825
ORIENTATION = 0x0112


def _jpeg(size=(400, 300), color=(200, 30, 30), exif=None, **kw) -> bytes:
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    params = {"format": "JPEG", "quality": 95, **kw}
    if exif is not None:
        params["exif"] = exif.tobytes()
    img.save(buf, **params)
    return buf.getvalue()


def _exif_with_gps(orientation: int | None = None) -> Image.Exif:
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # Make
    if orientation is not None:
        exif[ORIENTATION] = orientation
    gps = exif.get_ifd(GPS_IFD)
    gps[1] = "N"
    gps[2] = (47.0, 1.0, 30.0)
    gps[3] = "E"
    gps[4] = (28.0, 50.0, 10.0)
    return exif


def _open(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    return img


# --------------------------------------------------------------------------- #
# process_image
# --------------------------------------------------------------------------- #


def test_exif_si_gps_eliminate():
    src = _jpeg(exif=_exif_with_gps())
    # Sanity: sursa chiar are GPS.
    assert _open(src).getexif().get_ifd(GPS_IFD)

    out = process_image(src)

    img = _open(out.original)
    assert img.format == "JPEG"
    assert len(img.getexif()) == 0
    assert not img.getexif().get_ifd(GPS_IFD)
    assert "exif" not in img.info
    assert b"Exif\x00\x00" not in out.original
    assert b"PhoneMaker" not in out.original
    for data in out.variants.values():
        v = _open(data)
        assert v.format == "WEBP"
        assert "exif" not in v.info
        assert b"PhoneMaker" not in data


def test_orientarea_exif_e_aplicata():
    # Orientare 6 = rotire 90° în sensul acelor: 400x300 stocat → 300x400 afișat.
    src = _jpeg(size=(400, 300), exif=_exif_with_gps(orientation=6))
    out = process_image(src)
    assert (out.width, out.height) == (300, 400)
    assert _open(out.original).size == (300, 400)
    assert _open(out.variants[256]).size == (192, 256)


def test_jpeg_progresiv():
    out = process_image(_jpeg())
    img = _open(out.original)
    assert img.info.get("progressive") or img.info.get("progression")


def test_dimensiuni_micsorare_proportionala():
    out = process_image(_jpeg(size=(4000, 3000)))
    assert (out.width, out.height) == (1600, 1200)
    assert _open(out.original).size == (1600, 1200)
    assert set(out.variants) == {256, 800}
    assert _open(out.variants[256]).size == (256, 192)
    assert _open(out.variants[800]).size == (800, 600)


def test_portret_latura_mare_e_inaltimea():
    out = process_image(_jpeg(size=(1000, 3000)), max_side=1200, variants=(480,))
    assert (out.width, out.height) == (400, 1200)
    assert _open(out.variants[480]).size == (160, 480)


def test_fara_upscale():
    out = process_image(_jpeg(size=(300, 200)))
    assert (out.width, out.height) == (300, 200)
    # Varianta 256 se micșorează, cea de 800 rămâne la mărimea originalului.
    assert _open(out.variants[256]).size == (256, 171)
    assert _open(out.variants[800]).size == (300, 200)


def test_png_transparent_devine_jpeg_pe_fundal_alb():
    img = Image.new("RGBA", (50, 50), (0, 0, 0, 0))  # complet transparent
    img.paste((255, 0, 0, 255), (0, 0, 25, 50))  # jumătatea stângă roșie opacă
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    out = process_image(buf.getvalue())
    res = _open(out.original)
    assert res.format == "JPEG"
    assert res.mode == "RGB"
    r, g, b = res.getpixel((45, 25))  # zona transparentă → alb
    assert min(r, g, b) > 240
    r, g, b = res.getpixel((5, 25))  # zona opacă rămâne roșie
    assert r > 200 and g < 60 and b < 60


def test_paleta_si_tonuri_de_gri():
    for mode in ("P", "L", "CMYK"):
        img = Image.new(mode, (40, 30))
        buf = io.BytesIO()
        img.save(buf, format="PNG" if mode != "CMYK" else "JPEG")
        out = process_image(buf.getvalue())
        assert _open(out.original).mode == "RGB"


@pytest.mark.parametrize(
    "content",
    [b"", b"nu sunt o imagine", b"\x89PNG\r\n\x1a\n" + b"\x00" * 20, b"\xff\xd8\xff\xe0garbage"],
)
def test_input_invalid(content):
    with pytest.raises(InvalidImage):
        process_image(content)


def test_decompression_bomb_respinsa(monkeypatch):
    from app.services import image_variants

    monkeypatch.setattr(image_variants, "MAX_PIXELS", 100 * 100)
    with pytest.raises(InvalidImage):
        process_image(_jpeg(size=(200, 200)))


def test_invalid_image_e_valueerror():
    # Apelanții care prind ValueError (ex. 422 generic) prind și InvalidImage.
    assert issubclass(InvalidImage, ValueError)


# --------------------------------------------------------------------------- #
# variant_key
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "key,size,expected",
    [
        ("photos/abc/0123abcd.jpg", 256, "photos/abc/0123abcd_256.webp"),
        ("photos/abc/0123abcd.jpeg", 800, "photos/abc/0123abcd_800.webp"),
        ("photos/abc/0123abcd.PNG", 480, "photos/abc/0123abcd_480.webp"),
        ("stories/u/x.webp", 256, "stories/u/x_256.webp"),
        ("events/x.jpg", 800, "events/x_800.webp"),
        ("x.jpg", 256, "x_256.webp"),
        ("photos/a.b/x", 256, "photos/a.b/x_256.webp"),
    ],
)
def test_variant_key(key, size, expected):
    assert variant_key(key, size) == expected


def test_variant_keys_for():
    assert variant_keys_for("photos/u/x.jpg") == [
        "photos/u/x_256.webp",
        "photos/u/x_800.webp",
        "photos/u/x_480.webp",
    ]
    assert variant_keys_for("stories/u/clip.mp4") == []
    assert variant_keys_for("photos/u/x_256.webp") == []


# --------------------------------------------------------------------------- #
# save_with_variants + storage.delete
# --------------------------------------------------------------------------- #


@pytest.fixture
def local(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


@pytest.mark.asyncio
async def test_save_with_variants_scrie_original_si_variante(local):
    processed = process_image(_jpeg(size=(1200, 900)))
    await save_with_variants(LocalStorage(), "photos/u1/abc.jpg", processed)

    assert (local / "photos/u1/abc.jpg").read_bytes() == processed.original
    assert (local / "photos/u1/abc_256.webp").read_bytes() == processed.variants[256]
    assert (local / "photos/u1/abc_800.webp").read_bytes() == processed.variants[800]


@pytest.mark.asyncio
async def test_save_with_variants_storage_sincron():
    calls = []

    class SyncStorage:
        def save(self, key, content, content_type):
            calls.append((key, content_type))
            return key

    processed = ProcessedImage(original=b"j", width=1, height=1, variants={256: b"w"})
    await save_with_variants(SyncStorage(), "events/e.jpg", processed)
    assert sorted(calls) == [("events/e.jpg", "image/jpeg"), ("events/e_256.webp", "image/webp")]


@pytest.mark.asyncio
async def test_delete_sterge_si_variantele(local):
    st = LocalStorage()
    processed = process_image(_jpeg(size=(1200, 900)), variants=(256, 800, 480))
    await save_with_variants(st, "photos/u1/abc.jpg", processed)
    for name in ("abc.jpg", "abc_256.webp", "abc_800.webp", "abc_480.webp"):
        assert (local / "photos/u1" / name).exists()
    (local / "photos/u1/other.jpg").write_bytes(b"x")  # alt fișier: rămâne

    await st.delete("https://api.flrt.md/media/photos/u1/abc.jpg")

    for name in ("abc.jpg", "abc_256.webp", "abc_800.webp", "abc_480.webp"):
        assert not (local / "photos/u1" / name).exists()
    assert (local / "photos/u1/other.jpg").exists()


@pytest.mark.asyncio
async def test_delete_fara_variante_nu_da_eroare(local):
    st = LocalStorage()
    url = await st.save("photos/u1/old.png", b"date", "image/png")
    await st.delete(url)  # poză veche, fără variante → fără excepție
    assert not (local / "photos/u1/old.png").exists()
    await st.delete(url)  # idempotent


@pytest.mark.asyncio
async def test_delete_s3_sterge_si_variantele(monkeypatch):
    monkeypatch.setattr(storage.settings, "s3_bucket", "flirt-bucket")
    monkeypatch.setattr(storage.settings, "s3_region", "eu-central-1")
    deleted = []

    class FakeClient:
        def delete_object(self, Bucket, Key):
            deleted.append(Key)

    st = storage.S3Storage()
    monkeypatch.setattr(st, "_client", lambda: FakeClient())
    await st.delete(
        "https://flirt-bucket.s3.eu-central-1.amazonaws.com/photos/u1/abc.jpg"
    )
    assert deleted == [
        "photos/u1/abc.jpg",
        "photos/u1/abc_256.webp",
        "photos/u1/abc_800.webp",
        "photos/u1/abc_480.webp",
    ]

    deleted.clear()
    await st.delete("https://flirt-bucket.s3.eu-central-1.amazonaws.com/stories/u1/v.mp4")
    assert deleted == ["stories/u1/v.mp4"]
