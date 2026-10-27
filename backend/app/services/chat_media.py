"""Atașamente media în chat: detecția tipului real, limite și curățarea pozelor.

Tipul se deduce din MAGIC BYTES (conținutul real), nu din Content-Type-ul
declarat de client (spoofabil):
- imagine → kind 'image' (jpeg, png, webp, gif)
- video   → kind 'video' (mp4 / QuickTime, webm)
- audio   → kind 'voice' (webm/opus, ogg/opus, mp4/m4a, aac, mpeg)
Orice altceva → 415.

Pozele statice (jpeg/png/webp) trec prin `image_variants.process_image`: fără
EXIF/XMP (fără GPS, model telefon etc.), orientarea aplicată în pixeli, micșorate
la ≤1600px, JPEG q82 + varianta `_480.webp` pentru bula din chat. GIF-ul și
WebP-ul animat sunt doar curățate (re-encodarea le-ar strica animația).
Video-ul NU se transcodează.

MESAJELE VOCALE SE TRANSCODEAZĂ în M4A/AAC nefragmentat (`ensure_playable_voice`),
dacă ffmpeg există: fiecare platformă înregistrează în alt format (Android/desktop
Chrome → WebM/Opus sau MP4 fragmentat, Firefox → Ogg/Opus, iOS → MP4 fragmentat
cu AAC), iar WebView-ul Telegram de pe iOS NU redă WebM/Ogg/Opus — exact
defectul „vocalul se trimite, dar celălalt nu-l poate asculta". Un M4A obișnuit
(AAC, `moov` la început) se redă peste tot (iOS, Android, desktop). Fără ffmpeg
(ex. mediu de dev), fișierul rămâne neschimbat — degradare, nu eroare.
"""
from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
import os
import secrets
import shutil
import struct
import tempfile
import uuid
from dataclasses import dataclass, field

from fastapi import HTTPException

from app.core.config import settings
from app.services.image_variants import (
    MAX_PIXELS as _VARIANTS_MAX_PIXELS,
    InvalidImage,
    ProcessedImage,
    process_image,
    variant_key,
)

logger = logging.getLogger("app.chat.media")

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

# Pozele din chat: ecran întreg pe telefon → 1600px ajung; `_480` pentru bulă.
CHAT_IMAGE_MAX_SIDE = 1600
CHAT_IMAGE_VARIANTS: tuple[int, ...] = (480,)

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
    # Variante WebP (latura → bytes), salvate lângă original (`variant_key`).
    variants: dict[int, bytes] = field(default_factory=dict)


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


def process_upload_image(
    content: bytes, *, max_side: int, variants: tuple[int, ...]
) -> ProcessedImage:
    """`process_image` cu erorile HTTP ale uploadurilor: 413 (prea mulți pixeli /
    bombă de decompresie), 422 (corupt). Sincron, CPU-bound → `to_thread`.
    """
    from PIL import Image

    try:
        with Image.open(io.BytesIO(content)) as img:
            width, height = img.size  # doar antetul — fără decodare
    except Image.DecompressionBombError:
        raise HTTPException(status_code=413, detail="Imaginea are dimensiuni prea mari.")
    except Exception:
        raise HTTPException(
            status_code=422, detail="Imaginea încărcată este coruptă sau invalidă."
        )
    if width * height > min(_MAX_IMAGE_PIXELS, _VARIANTS_MAX_PIXELS):
        raise HTTPException(status_code=413, detail="Imaginea are dimensiuni prea mari.")
    try:
        return process_image(content, max_side=max_side, variants=variants)
    except InvalidImage:
        raise HTTPException(
            status_code=422, detail="Imaginea încărcată este coruptă sau invalidă."
        )


def _is_animated(content: bytes) -> bool:
    from PIL import Image

    try:
        with Image.open(io.BytesIO(content)) as img:
            return bool(getattr(img, "is_animated", False))
    except Exception:  # noqa: BLE001 — fișier stricat: decide `process_upload_image`
        return False


def _clean_chat_image(content: bytes, mime: str) -> ChatMedia:
    """Poza din chat curățată: GIF / WebP animat neschimbate ca format, restul
    procesate (≤1600px JPEG + `_480.webp`)."""
    if mime == "image/gif" or (mime == "image/webp" and _is_animated(content)):
        clean, width, height = _strip_image(content, mime)
        return ChatMedia(kind="image", mime=mime, content=clean, width=width, height=height)
    processed = process_upload_image(
        content, max_side=CHAT_IMAGE_MAX_SIDE, variants=CHAT_IMAGE_VARIANTS
    )
    return ChatMedia(
        kind="image",
        mime="image/jpeg",
        content=processed.original,
        width=processed.width,
        height=processed.height,
        variants=processed.variants,
    )


async def save_chat_media(storage, key: str, media: ChatMedia) -> str:
    """Salvează variantele (dacă există), apoi originalul; întoarce URL-ul lui.

    Variantele întâi: odată ce URL-ul originalului ajunge la destinatar,
    miniatura lui e deja pe disc (frontend-ul are oricum fallback la original).
    """
    for size, data in sorted(media.variants.items()):
        await storage.save(variant_key(key, size), data, "image/webp")
    return await storage.save(key, media.content, media.mime)


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
    """Validează un atașament → `ChatMedia`. Ridică 422 / 413 / 415.

    Sincron și, pentru poze, CPU-bound — din cod async se cheamă prin
    `asyncio.to_thread`.
    """
    if not content:
        raise HTTPException(
            status_code=422, detail="Fișier gol."
        )

    image_mime = _sniff_image(content)
    if image_mime is not None:
        if len(content) > settings.chat_image_max_bytes:
            raise _too_large("Imaginea este", settings.chat_image_max_bytes)
        return _clean_chat_image(content, image_mime)

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


# --------------------------------------------------------------------------- #
# Mesaje vocale redabile peste tot (AAC / M4A)
# --------------------------------------------------------------------------- #

# Demuxerul ffmpeg FORȚAT pentru fiecare format deja validat prin magic bytes —
# ffmpeg nu mai ghicește singur formatul unui fișier venit de la client.
_FFMPEG_DEMUXER = {
    "audio/webm": "matroska",
    "audio/ogg": "ogg",
    "audio/mp4": "mov",
    "audio/aac": "aac",
    "audio/mpeg": "mp3",
}
_TRANSCODE_TIMEOUT_S = 60


def _ffmpeg_path() -> str | None:
    return shutil.which("ffmpeg")


def is_universal_voice(content: bytes) -> bool:
    """True dacă vocalul e deja în forma canonică redabilă PESTE TOT: un M4A
    obișnuit (ISO-BMFF cu pistă AAC `mp4a`), NEFRAGMENTAT.

    Fragmentat (`moof`) = ieșirea brută a `MediaRecorder` (Chrome cu
    `audio/mp4;codecs=mp4a.40.2`, Safari pe iOS): `moov` fără tabele de
    eșantioane, durata 0, datele în fragmente. Unele playere (WebView-ul iOS la
    descărcare progresivă) nu-l pot reda sau nu-i pot afla durata — înainte
    trecea netranscodat doar pentru că avea AAC.
    """
    boxes = _top_level_boxes(content)
    if not boxes or boxes[0][0] != b"ftyp":
        return False
    types = [kind for kind, _, _ in boxes]
    if b"moof" in types or b"moov" not in types:
        return False
    _, start, end = next(box for box in boxes if box[0] == b"moov")
    return b"mp4a" in content[start:end]


def _top_level_boxes(content: bytes) -> list[tuple[bytes, int, int]]:
    """Box-urile de pe primul nivel ISO-BMFF: (tip, început, sfârșit).

    Se opresc la primul box invalid (fișier trunchiat / nu e MP4) — lista
    parțială e suficientă pentru deciziile de mai sus.
    """
    boxes: list[tuple[bytes, int, int]] = []
    pos, total = 0, len(content)
    while pos + 8 <= total and len(boxes) < 64:
        size = struct.unpack(">I", content[pos : pos + 4])[0]
        kind = content[pos + 4 : pos + 8]
        header = 8
        if size == 1:
            if pos + 16 > total:
                break
            size = struct.unpack(">Q", content[pos + 8 : pos + 16])[0]
            header = 16
        elif size == 0:
            size = total - pos
        if size < header:
            break
        boxes.append((kind, pos, min(pos + size, total)))
        pos += size
    return boxes


def needs_voice_transcode(media: ChatMedia) -> bool:
    """True dacă vocalul NU e deja un M4A/AAC nefragmentat (`is_universal_voice`).

    Se convertesc: WebM / Ogg (Opus/Vorbis — iOS nu le redă), MP4 cu Opus
    (Chrome), MP4 fragmentat din `MediaRecorder` (chiar și cu AAC), AAC brut
    (ADTS — `.aac` nu are un tip MIME sigur pe toate serverele/playerele).
    MP3 se redă peste tot → rămâne neschimbat.
    """
    if media.kind != "voice":
        return False
    if media.mime == "audio/mpeg":
        return False
    return not is_universal_voice(media.content)


async def _run_ffmpeg(ffmpeg: str, src_path: str, demuxer: str, dst_path: str) -> bool:
    proc = await asyncio.create_subprocess_exec(
        ffmpeg,
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file",
        "-f", demuxer, "-i", src_path,
        "-vn", "-sn", "-dn", "-map_metadata", "-1",
        # `aresample=async=1`: înregistrările din browser au uneori goluri de
        # timestamp (WebM fără durată/cues) — le umplem, ca sunetul să nu sară.
        "-af", "aresample=async=1",
        "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "64k",
        # `+faststart`: `moov` la început → redarea pornește din primii octeți,
        # fără să descarce tot fișierul (iOS cere asta pe rețele lente).
        "-movflags", "+faststart",
        "-f", "ipod", dst_path,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), _TRANSCODE_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        logger.warning("chat voice: ffmpeg a depășit %ss", _TRANSCODE_TIMEOUT_S)
        return False
    if proc.returncode != 0:
        logger.warning(
            "chat voice: ffmpeg a eșuat (%s): %s",
            proc.returncode,
            (stderr or b"").decode("utf-8", "replace")[:300],
        )
        return False
    return True


async def ensure_playable_voice(media: ChatMedia) -> ChatMedia:
    """Vocalul convertit în M4A/AAC nefragmentat (redabil pe iOS + Android +
    desktop), dacă nu e deja în forma asta.

    Best-effort: fără ffmpeg sau la o conversie eșuată întoarce fișierul
    original (validat deja) — trimiterea nu pică; eroarea ajunge în log la
    nivel ERROR (nu doar WARNING), ca un vocal posibil neredabil pe iOS să nu
    mai treacă neobservat. Playerul din Mini App arată oricum o stare de eroare
    cu reîncercare, nu un buton care „nu face nimic".
    """
    if not needs_voice_transcode(media):
        return media
    demuxer = _FFMPEG_DEMUXER.get(media.mime)
    if demuxer is None:
        return media
    ffmpeg = _ffmpeg_path()
    if ffmpeg is None:
        logger.error("chat voice: ffmpeg lipsește → vocal %s netranscodat", media.mime)
        return media

    with tempfile.TemporaryDirectory(prefix="flirt-voice-") as tmp:
        src = os.path.join(tmp, "in.bin")
        dst = os.path.join(tmp, "out.m4a")
        with open(src, "wb") as fh:
            fh.write(media.content)
        ok = await _run_ffmpeg(ffmpeg, src, demuxer, dst)
        converted = b""
        if ok and os.path.isfile(dst):
            with open(dst, "rb") as fh:
                converted = fh.read()

    if not converted or not is_universal_voice(converted):
        logger.error(
            "chat voice: conversia %s → m4a a eșuat; se păstrează originalul", media.mime
        )
        return media
    if len(converted) > settings.chat_voice_max_bytes:
        logger.error("chat voice: m4a convertit peste limită; se păstrează originalul")
        return media
    duration = _mp4_duration_ms(converted) or media.duration_ms
    return ChatMedia(
        kind="voice", mime="audio/mp4", content=converted, duration_ms=duration
    )


# --------------------------------------------------------------------------- #
# Mesaje video rotunde („кружки", ca în Telegram)
# --------------------------------------------------------------------------- #

# Tipul mesajului (coloana `messages.kind`, String(16), fără CHECK — nu cere
# migrare). Clienții vechi (aplicația nativă) ignoră `kind` și văd un mesaj gol,
# exact ca la un video obișnuit.
VIDEO_NOTE_KIND = "video_note"
# Plafonul de produs: 60 s, ca în Telegram (+ o marjă pentru ceasul clientului).
VIDEO_NOTE_MAX_DURATION_MS = 60_000
_VIDEO_NOTE_DURATION_SLACK_MS = 3_000
# Latura pătratului final: 2× bula de ~240px de pe ecranele retina.
VIDEO_NOTE_SIDE = 480
_VIDEO_NOTE_TIMEOUT_S = 120
# Demuxerul FORȚAT pentru fiecare format video deja validat prin magic bytes.
_FFMPEG_VIDEO_DEMUXER = {
    "video/webm": "matroska",
    "video/mp4": "mov",
    "video/quicktime": "mov",
}


def as_video_note(media: ChatMedia) -> ChatMedia:
    """Marchează un video validat drept mesaj video rotund. Ridică 415 / 413.

    Doar un fișier recunoscut ca video (magic bytes) poate deveni „кружок";
    durata (reală din mp4 sau declarată) nu poate depăși 60 s.
    """
    if media.kind != "video":
        raise HTTPException(
            status_code=415,
            detail="Mesajul video rotund trebuie să fie un video (mp4, mov, webm).",
        )
    limit = VIDEO_NOTE_MAX_DURATION_MS + _VIDEO_NOTE_DURATION_SLACK_MS
    if media.duration_ms is not None and media.duration_ms > limit:
        raise HTTPException(
            status_code=413,
            detail="Mesajul video este prea lung (maxim 60 de secunde).",
        )
    return ChatMedia(
        kind=VIDEO_NOTE_KIND,
        mime=media.mime,
        content=media.content,
        duration_ms=media.duration_ms,
        width=media.width,
        height=media.height,
    )


def video_note_ffmpeg_args(src_path: str, demuxer: str, dst_path: str) -> list[str]:
    """Argumentele ffmpeg: decupaj pătrat central → 480×480, H.264 + AAC în MP4.

    - `-t` plafonează durata și dacă clientul a mințit-o (WebM-ul din
      MediaRecorder nu are durată în container);
    - pista audio e opțională (`0:a:0?`) — camera fără microfon nu pică;
    - `yuv420p` + profil `main` + `faststart`: redare imediată pe iOS și Android.
    """
    side = VIDEO_NOTE_SIDE
    max_s = (VIDEO_NOTE_MAX_DURATION_MS + _VIDEO_NOTE_DURATION_SLACK_MS) / 1000
    return [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file",
        "-f", demuxer, "-i", src_path,
        "-t", f"{max_s:g}",
        "-map", "0:v:0", "-map", "0:a:0?",
        "-sn", "-dn", "-map_metadata", "-1",
        "-vf", f"crop='min(iw,ih)':'min(iw,ih)',scale={side}:{side},setsar=1",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
        "-profile:v", "main", "-pix_fmt", "yuv420p", "-threads", "2",
        "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "44100",
        "-movflags", "+faststart",
        "-f", "mp4", dst_path,
    ]


async def _run_ffmpeg_video_note(
    ffmpeg: str, src_path: str, demuxer: str, dst_path: str
) -> bool:
    proc = await asyncio.create_subprocess_exec(
        ffmpeg,
        *video_note_ffmpeg_args(src_path, demuxer, dst_path),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), _VIDEO_NOTE_TIMEOUT_S)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        logger.warning("chat video note: ffmpeg a depășit %ss", _VIDEO_NOTE_TIMEOUT_S)
        return False
    if proc.returncode != 0:
        logger.warning(
            "chat video note: ffmpeg a eșuat (%s): %s",
            proc.returncode,
            (stderr or b"").decode("utf-8", "replace")[:300],
        )
        return False
    return True


async def ensure_playable_video_note(media: ChatMedia) -> ChatMedia:
    """Mesajul video rotund convertit în MP4 H.264/AAC, pătrat 480×480.

    Fiecare platformă înregistrează altfel (iOS → MP4/H.264, Android/desktop →
    WebM/VP8-VP9/Opus, pe care iOS NU-l redă). Best-effort, ca la vocale: fără
    ffmpeg sau la o conversie eșuată rămâne fișierul original (validat deja).
    """
    if media.kind != VIDEO_NOTE_KIND:
        return media
    demuxer = _FFMPEG_VIDEO_DEMUXER.get(media.mime)
    if demuxer is None:
        return media
    ffmpeg = _ffmpeg_path()
    if ffmpeg is None:
        logger.warning("chat video note: ffmpeg lipsește → %s netranscodat", media.mime)
        return media

    with tempfile.TemporaryDirectory(prefix="flirt-vnote-") as tmp:
        src = os.path.join(tmp, "in.bin")
        dst = os.path.join(tmp, "out.mp4")
        with open(src, "wb") as fh:
            fh.write(media.content)
        ok = await _run_ffmpeg_video_note(ffmpeg, src, demuxer, dst)
        if not ok or not os.path.isfile(dst):
            return media
        with open(dst, "rb") as fh:
            converted = fh.read()

    if not converted or len(converted) > settings.chat_video_max_bytes:
        return media
    duration = _mp4_duration_ms(converted) or media.duration_ms
    return ChatMedia(
        kind=VIDEO_NOTE_KIND,
        mime="video/mp4",
        content=converted,
        duration_ms=duration,
        width=VIDEO_NOTE_SIDE,
        height=VIDEO_NOTE_SIDE,
    )
