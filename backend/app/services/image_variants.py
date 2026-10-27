"""Procesarea pozelor la upload: curățare metadate, micșorare și variante WebP.

De ce: testerii raportau „фото долго грузят". Pozele se salvau la mărimea
originală (până la 8 MB, cu EXIF/GPS!), iar un avatar de 48px descărca poza
întreagă. Modulul ăsta:

- decodează imaginea cu Pillow (cu protecție la decompression bomb);
- aplică orientarea EXIF (`ImageOps.exif_transpose`), apoi aruncă TOATE
  metadatele (EXIF/GPS, XMP, comentarii) prin re-encodare;
- convertește profilul ICC (dacă există) la sRGB și NU îl mai scrie — sRGB e
  presupunerea implicită a browserelor, deci culorile rămân corecte fără să
  păstrăm un blob ICC necontrolat; dacă conversia nu e posibilă, profilul e
  pur și simplu ignorat;
- convertește la RGB (transparența → fundal alb);
- micșorează proporțional la `max_side` și salvează JPEG progresiv q82;
- produce variante WebP (latura mare = n, fără upscale) pentru miniaturi.

Totul e SINCRON și CPU-bound: apelantul async îl rulează cu
`asyncio.to_thread(process_image, content)`.

Cheile variantelor: `photos/abc/<hex>.jpg` → `photos/abc/<hex>_256.webp`
(vezi `variant_key`). Frontend-ul (`miniapp/src/lib/media.ts::variantUrl`)
derivă același nume din URL, deci convenția trebuie păstrată identică.
"""
from __future__ import annotations

import asyncio
import inspect
import io
import posixpath
from dataclasses import dataclass, field

from PIL import Image, ImageOps, UnidentifiedImageError

# Plafon explicit de pixeli (≈ 50 MP). Peste el refuzăm înainte de decodare —
# antetul dă dimensiunile fără să alocăm bitmap-ul. Toate căile care decodează
# o imagine venită de la client (upload, moderare, chat) verifică ACEST plafon.
MAX_PIXELS = 50_000_000

# Plafonul GLOBAL Pillow, setat O SINGURĂ DATĂ, la importul modulului (îl importă
# toate căile de imagini: upload profil/story/chat, moderare, storage). Pillow
# avertizează peste el și ridică `DecompressionBombError` peste DUBLUL lui, chiar
# din `Image.open` — plasa pentru orice cod care uită verificarea explicită de
# mai sus. Implicit e ~89 MP (eroare abia la ~179 MP). Înainte, aici se folosea
# `warnings.catch_warnings()` ca să transforme avertismentul în eroare — dar acel
# context manager modifică starea GLOBALĂ a modulului `warnings` și NU e sigur
# între fire (`process_image` rulează în `asyncio.to_thread`, în paralel).
PILLOW_MAX_IMAGE_PIXELS = 60_000_000
Image.MAX_IMAGE_PIXELS = PILLOW_MAX_IMAGE_PIXELS

# Formatele acceptate la decodare. `Image.open` fără `formats` încearcă TOATE
# pluginurile Pillow (zeci de formate exotice, cu istoric de CVE-uri); noi primim
# doar fotografii. „JPEG" acoperă și MPO (JPEG-ul „multi-picture" al unor
# camere — Pillow îl deschide prin fabrica JPEG); GIF — avatare/coperți vechi.
IMAGE_FORMATS: tuple[str, ...] = ("JPEG", "PNG", "WEBP", "GIF")

DEFAULT_MAX_SIDE = 1600
DEFAULT_VARIANTS: tuple[int, ...] = (256, 800)

JPEG_QUALITY = 82
# Calitatea WebP pe mărime: miniaturile mici tolerează compresie mai agresivă.
WEBP_QUALITY_SMALL = 75  # n < 480 (ex. 256 — avatare, liste)
WEBP_QUALITY_LARGE = 78  # n >= 480 (ex. 480/800 — carduri, ecran întreg)

VARIANT_EXT = "webp"


class InvalidImage(ValueError):
    """Conținutul nu e o imagine decodabilă (sau e o „bombă" de decompresie)."""


@dataclass
class ProcessedImage:
    """Rezultatul `process_image`: originalul curățat (JPEG) + variantele WebP."""

    original: bytes  # JPEG progresiv, fără metadate
    width: int
    height: int
    variants: dict[int, bytes] = field(default_factory=dict)  # n → WebP


def variant_key(key: str, size: int) -> str:
    """`photos/abc/<hex>.jpg` → `photos/abc/<hex>_256.webp` (orice extensie).

    Înlocuiește DOAR extensia ultimului segment; un segment fără extensie
    primește direct sufixul (`photos/abc/x` → `photos/abc/x_256.webp`).
    """
    head, tail = posixpath.split(key)
    stem, _ext = posixpath.splitext(tail)
    if not stem:  # ex. „.jpg" sau cheie terminată în „/" — păstrăm ce avem
        stem = tail
    name = f"{stem}_{int(size)}.{VARIANT_EXT}"
    return posixpath.join(head, name) if head else name


def _webp_quality(size: int) -> int:
    return WEBP_QUALITY_LARGE if size >= 480 else WEBP_QUALITY_SMALL


def _open_checked(content: bytes) -> Image.Image:
    """Deschide imaginea și verifică dimensiunile ÎNAINTE de decodarea completă."""
    if not content:
        raise InvalidImage("Fișier gol.")
    try:
        # Plafonul global (`Image.MAX_IMAGE_PIXELS`) ridică deja peste 2× limită;
        # verificarea explicită de mai jos (`MAX_PIXELS`) e cea strictă — făcută pe
        # antet, ÎNAINTE de `load()`, deci fără a aloca bitmap-ul.
        img = Image.open(io.BytesIO(content), formats=IMAGE_FORMATS)
        width, height = img.size
        if width <= 0 or height <= 0:
            raise InvalidImage("Dimensiuni invalide.")
        if width * height > MAX_PIXELS:
            raise InvalidImage(
                f"Imagine prea mare ({width}x{height} px, maxim {MAX_PIXELS} px)."
            )
        img.load()  # decodarea propriu-zisă — aici apar erorile de fișier corupt
    except InvalidImage:
        raise
    except Image.DecompressionBombError as exc:
        raise InvalidImage("Imagine prea mare (decompression bomb).") from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, EOFError) as exc:
        raise InvalidImage("Fișierul nu este o imagine validă.") from exc
    return img


def _to_srgb(img: Image.Image) -> Image.Image:
    """Convertește un profil ICC încorporat la sRGB; la orice problemă îl ignoră."""
    icc = img.info.get("icc_profile")
    if not icc:
        return img
    try:
        from PIL import ImageCms

        if img.mode not in ("RGB", "RGBA", "CMYK", "L"):
            return img
        src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
        dst = ImageCms.createProfile("sRGB")
        out_mode = "RGBA" if img.mode == "RGBA" else "RGB"
        converted = ImageCms.profileToProfile(img, src, dst, outputMode=out_mode)
        return converted if converted is not None else img
    except Exception:  # noqa: BLE001 — profil corupt/necunoscut: îl aruncăm
        return img


def _flatten_rgb(img: Image.Image) -> Image.Image:
    """Orice mod → RGB; transparența se compune peste fundal alb."""
    if img.mode == "P":
        img = img.convert("RGBA") if "transparency" in img.info else img.convert("RGB")
    if img.mode in ("LA", "PA"):
        img = img.convert("RGBA")
    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.getchannel("A"))
        return background
    if img.mode in ("I", "I;16", "I;16B", "I;16L", "F"):
        # Imagini pe 16/32 biți (rare: PNG 16-bit gri) → 8 biți înainte de RGB.
        img = img.point(lambda v: v / 256).convert("L")
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def _strip_metadata(img: Image.Image) -> Image.Image:
    """Copie „curată": doar pixelii, fără info (EXIF, XMP, ICC, comentarii)."""
    clean = Image.new("RGB", img.size)
    clean.paste(img)
    return clean


def _encode_jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(
        buf,
        format="JPEG",
        quality=JPEG_QUALITY,
        optimize=True,
        progressive=True,
        exif=b"",
    )
    return buf.getvalue()


def _encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=4, exif=b"")
    return buf.getvalue()


def _fit(img: Image.Image, side: int) -> Image.Image:
    """Copie micșorată proporțional cu latura mare = `side` (fără upscale)."""
    if max(img.size) <= side:
        return img
    out = img.copy()
    out.thumbnail((side, side), Image.Resampling.LANCZOS)
    return out


def process_image(
    content: bytes,
    *,
    max_side: int = DEFAULT_MAX_SIDE,
    variants: tuple[int, ...] = DEFAULT_VARIANTS,
) -> ProcessedImage:
    """Curăță + micșorează o imagine și produce variantele WebP.

    Ridică `InvalidImage` pentru conținut gol/corupt/nesuportat sau prea mare.
    Sincron (CPU-bound) — din cod async: `await asyncio.to_thread(process_image, b)`.
    """
    if max_side <= 0:
        raise ValueError("max_side trebuie să fie pozitiv")
    img = _open_checked(content)
    try:
        if getattr(img, "is_animated", False):
            img.seek(0)  # GIF/WebP animat: doar primul cadru
        try:
            img = ImageOps.exif_transpose(img)
        except Exception:  # noqa: BLE001 — EXIF corupt: orientarea rămâne cum e
            pass
        img = _to_srgb(img)
        img = _flatten_rgb(img)
        img = _strip_metadata(img)
        img = _fit(img, max_side)

        original = _encode_jpeg(img)
        out_variants: dict[int, bytes] = {}
        for size in variants:
            n = int(size)
            if n <= 0:
                continue
            out_variants[n] = _encode_webp(_fit(img, n), _webp_quality(n))
    except InvalidImage:
        raise
    except (OSError, ValueError) as exc:
        raise InvalidImage("Imaginea nu a putut fi procesată.") from exc
    return ProcessedImage(
        original=original, width=img.width, height=img.height, variants=out_variants
    )


async def _call_save(storage, key: str, content: bytes, content_type: str):
    """Cheamă `storage.save` fie că e async (API-ul actual), fie sincron."""
    save = storage.save
    if inspect.iscoroutinefunction(save):
        return await save(key, content, content_type)
    result = await asyncio.to_thread(save, key, content, content_type)
    if inspect.isawaitable(result):
        result = await result
    return result


async def save_with_variants(storage, key: str, processed: ProcessedImage):
    """Salvează originalul la `key` (image/jpeg) și variantele la `variant_key`.

    Întoarce ce întoarce `storage.save` pentru original (URL-ul public).

    Variantele se scriu ÎNAINTE de original: dacă o scriere pică la jumătate,
    nu rămâne un original publicat fără miniaturi (frontend-ul are oricum
    fallback la original, deci ordinea inversă n-ar strica, doar ar încetini).
    """
    for size, data in sorted(processed.variants.items()):
        await _call_save(storage, variant_key(key, size), data, "image/webp")
    return await _call_save(storage, key, processed.original, "image/jpeg")
