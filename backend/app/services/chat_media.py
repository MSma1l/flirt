"""Atașamente media în chat: detecția tipului real, limite și curățarea pozelor.

Tipul se deduce din MAGIC BYTES (conținutul real), nu din Content-Type-ul
declarat de client (spoofabil):
- imagine → kind 'image' (jpeg, png, webp, gif)
- video   → kind 'video' (mp4 / QuickTime, webm)
- audio   → kind 'voice' (webm/opus, ogg/opus, mp4/m4a, aac, mpeg)
Orice altceva → 415.

Pozele sunt RE-ENCODATE cu Pillow fără EXIF/XMP (fără GPS, model telefon etc.),
cu orientarea EXIF aplicată în pixeli înainte. Video și audio NU se transcodează.
"""
from __future__ import annotations

import io
import mimetypes
import secrets
import struct
import uuid
from dataclasses import dataclass

from fastapi import HTTPException

from app.core.config import settings

# RO: StaticFiles (STORAGE_PROVIDER=local) ghicește Content-Type-ul după extensie
# din tabela `mimetypes` — pe imaginea Docker slim lipsesc unele tipuri audio.
# Le înregistrăm explicit, ca fișierele vocale să fie servite cu tipul corect.
mimetypes.add_type("audio/mp4", ".m4a")
mimetypes.add_type("audio/aac", ".aac")
mimetypes.add_type("audio/webm", ".weba")
mimetypes.add_type("audio/ogg", ".ogg")
mimetypes.add_type("audio/mpeg", ".mp3")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("video/quicktime", ".mov")
mimetypes.add_type("image/webp", ".webp")

# Tip MIME canonic → extensia cheii de storage (sursa de adevăr; niciodată
# `filename`-ul clientului).
_MIME_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "audio/webm": "weba",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
}

# Plafon de pixeli (anti decompression bomb), peste orice cameră de telefon uzuală.
_MAX_IMAGE_PIXELS = 60_000_000

UNSUPPORTED_DETAIL = (
    "Tip de fișier nepermis. Se acceptă: imagini (jpeg, png, webp, gif), "
    "video (mp4, mov, webm) și mesaje vocale (webm, ogg, m4a, aac, mp3)."
)


@dataclass
class ChatMedia:
    """Rezultatul validării unui atașament, gata de salvat în storage."""

    kind: str  # 'image' | 'video' | 'voice'
    mime: str
    content: bytes
    duration_ms: int | None = None
    width: int | None = None
    height: int | None = None


# --------------------------------------------------------------------------- #
# Detecția tipului din magic bytes
# --------------------------------------------------------------------------- #


def _sniff_image(content: bytes) -> str | None:
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _mp4_track_kinds(content: bytes) -> set[bytes]:
    """Tipurile de pistă dintr-un container ISO-BMFF (box-urile `hdlr`).

    `hdlr`: size(4) 'hdlr'(4) version+flags(4) pre_defined(4) handler_type(4).
    Un fișier fără pistă video (`vide`) dar cu pistă audio (`soun`) e audio.
    """
    kinds: set[bytes] = set()
    idx = content.find(b"hdlr")
    while idx != -1:
        handler = content[idx + 12 : idx + 16]
        if handler in (b"vide", b"soun"):
            kinds.add(handler)
        idx = content.find(b"hdlr", idx + 4)
    return kinds


def _mp4_duration_ms(content: bytes) -> int | None:
    """Durata din box-ul `mvhd` (timescale + duration), sau None dacă lipsește."""
    idx = content.find(b"mvhd")
    if idx == -1:
        return None
    p = idx + 4
    try:
        version = content[p]
        if version == 1:
            timescale, duration = struct.unpack(">IQ", content[p + 20 : p + 32])
        else:
            timescale, duration = struct.unpack(">II", content[p + 12 : p + 20])
    except (IndexError, struct.error):
        return None
    if not timescale or duration in (0, 0xFFFFFFFF, 0xFFFFFFFFFFFFFFFF):
        return None
    return int(duration * 1000 / timescale)


_ISOBMFF_IMAGE_BRANDS = {
    b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1",
    b"avif", b"avis",
}


def _sniff_av(content: bytes) -> tuple[str, str] | None:
    """(kind, mime) pentru video/audio, sau None dacă nu e un format permis."""
    # ISO-BMFF (mp4 / mov / m4a): box-ul `ftyp` la offset 4.
    if len(content) >= 12 and content[4:8] == b"ftyp":
        brand = content[8:12]
        # HEIC / AVIF folosesc același container — sunt imagini, nu le acceptăm.
        if brand in _ISOBMFF_IMAGE_BRANDS:
            return None
        tracks = _mp4_track_kinds(content)
        if b"vide" in tracks:
            return "video", "video/quicktime" if brand == b"qt  " else "video/mp4"
        if b"soun" in tracks or brand in (b"M4A ", b"M4B ", b"F4A "):
            return "voice", "audio/mp4"
        # Fără box-uri de pistă lizibile: decidem după brand.
        if brand == b"qt  ":
            return "video", "video/quicktime"
        return "video", "video/mp4"

    # EBML (WebM / Matroska): codec-urile apar în elementul Tracks, la început.
    if content[:4] == b"\x1a\x45\xdf\xa3":
        head = content[:262_144]
        if b"webm" not in head[:64] and b"matroska" not in head[:64]:
            return None
        if any(c in head for c in (b"V_VP8", b"V_VP9", b"V_AV1", b"V_MPEG4")):
            return "video", "video/webm"
        if b"A_OPUS" in head or b"A_VORBIS" in head:
            return "voice", "audio/webm"
        return None

    # Ogg: doar Opus (mesaje vocale din MediaRecorder / Telegram).
    if content[:4] == b"OggS":
        if b"OpusHead" in content[:512]:
            return "voice", "audio/ogg"
        return None

    # MP3 cu tag ID3 la început.
    if content[:3] == b"ID3":
        return "voice", "audio/mpeg"

    # Frame sync MPEG audio (11 biți de 1): ADTS AAC (layer 00) sau MP3.
    if len(content) >= 2 and content[0] == 0xFF and (content[1] & 0xE0) == 0xE0:
        layer = (content[1] >> 1) & 0x03
        if (content[1] & 0xF0) == 0xF0 and layer == 0:
            return "voice", "audio/aac"
        if layer != 0:
            return "voice", "audio/mpeg"
    return None


# --------------------------------------------------------------------------- #
# Curățarea pozelor (fără EXIF / GPS)
# --------------------------------------------------------------------------- #


def _strip_image(content: bytes, mime: str) -> tuple[bytes, int, int]:
    """Re-encodează imaginea fără metadate → (bytes curați, lățime, înălțime).

    GIF-ul nu are EXIF în format — îl păstrăm neschimbat (re-encodarea ar strica
    animația), doar îl validăm și îi citim dimensiunile.
    """
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(content)) as img:
            width, height = img.size
            if width * height > _MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="Imaginea are dimensiuni prea mari.",
                )
            if mime == "image/gif":
                img.verify()
                return content, width, height

            animated = getattr(img, "is_animated", False)
            out = io.BytesIO()
            if mime == "image/webp" and animated:
                # WebP animat: păstrăm cadrele, aruncăm EXIF/XMP.
                img.save(out, format="WEBP", save_all=True, exif=b"", xmp=b"")
                return out.getvalue(), width, height

            img.load()
            # Orientarea EXIF aplicată în pixeli, ca poza să nu apară rotită
            # după ce scoatem EXIF-ul.
            clean = ImageOps.exif_transpose(img)
            # Păstrăm doar cheile inofensive (transparență, profil de culoare);
            # exif / xmp / comentarii / text NU trec mai departe.
            clean.info = {
                k: v for k, v in img.info.items() if k in ("transparency", "icc_profile")
            }
            icc = clean.info.get("icc_profile")
            width, height = clean.size
            if mime == "image/jpeg":
                if clean.mode not in ("RGB", "L", "CMYK"):
                    clean = clean.convert("RGB")
                clean.save(
                    out, format="JPEG", quality=90, optimize=True,
                    exif=b"", icc_profile=icc,
                )
            elif mime == "image/png":
                clean.save(out, format="PNG", optimize=True, exif=b"")
            else:  # image/webp static
                clean.save(out, format="WEBP", quality=90, exif=b"", icc_profile=icc)
            return out.getvalue(), width, height
    except HTTPException:
        raise
    except Image.DecompressionBombError:
        raise HTTPException(
            status_code=413,
            detail="Imaginea are dimensiuni prea mari.",
        )
    except Exception:
        raise HTTPException(
            status_code=422,
            detail="Imaginea încărcată este coruptă sau invalidă.",
        )


# --------------------------------------------------------------------------- #
# Punctul de intrare
# --------------------------------------------------------------------------- #


def _too_large(what: str, limit_bytes: int) -> HTTPException:
    mb = limit_bytes // (1024 * 1024)
    return HTTPException(
        status_code=413,
        detail=f"{what} prea mare (maxim {mb} MB).",
    )


def max_attachment_bytes() -> int:
    """Cea mai mare limită — plafonul citirii, înainte de a ști tipul."""
    return max(
        settings.chat_image_max_bytes,
        settings.chat_voice_max_bytes,
        settings.chat_video_max_bytes,
    )


def validate_attachment(content: bytes, duration_ms: int | None) -> ChatMedia:
    """Validează un atașament → `ChatMedia`. Ridică 422 / 413 / 415."""
    if not content:
        raise HTTPException(
            status_code=422, detail="Fișier gol."
        )

    image_mime = _sniff_image(content)
    if image_mime is not None:
        if len(content) > settings.chat_image_max_bytes:
            raise _too_large("Imaginea este", settings.chat_image_max_bytes)
        clean, width, height = _strip_image(content, image_mime)
        return ChatMedia(
            kind="image", mime=image_mime, content=clean, width=width, height=height
        )

    av = _sniff_av(content)
    if av is None:
        raise HTTPException(
            status_code=415,
            detail=UNSUPPORTED_DETAIL,
        )
    kind, mime = av

    # Durata reală din container (mp4/m4a) are prioritate față de cea declarată.
    if mime in ("video/mp4", "video/quicktime", "audio/mp4"):
        real = _mp4_duration_ms(content)
        if real is not None:
            duration_ms = real

    if kind == "voice":
        if len(content) > settings.chat_voice_max_bytes:
            raise _too_large("Mesajul vocal este", settings.chat_voice_max_bytes)
        if duration_ms is not None and duration_ms > settings.chat_voice_max_duration_ms:
            minutes = settings.chat_voice_max_duration_ms // 60_000
            raise HTTPException(
                status_code=413,
                detail=f"Mesajul vocal este prea lung (maxim {minutes} minute).",
            )
    elif len(content) > settings.chat_video_max_bytes:
        raise _too_large("Video-ul este", settings.chat_video_max_bytes)

    return ChatMedia(kind=kind, mime=mime, content=content, duration_ms=duration_ms)


def build_attachment_key(chat_id: uuid.UUID, mime: str) -> str:
    """Cheie de storage NEGHICIBILĂ: `chat-media/{chat_id}/{token 128 biți}.{ext}`.

    Storage-ul nu are URL-uri semnate (local = mount static public, S3 = URL
    public), deci confidențialitatea vine din tokenul aleator din cheie.
    """
    return f"chat-media/{chat_id}/{secrets.token_hex(16)}.{_MIME_EXT[mime]}"
