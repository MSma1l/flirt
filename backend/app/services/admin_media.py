"""Upload de media din panoul de admin: creativele reclamelor și copertele evenimentelor.

Adminul alegea până acum doar un URL. Acum poate urca fișierul (de pe telefon
sau calculator), iar serverul întoarce un URL ABSOLUT, gata de pus în
`ad.image_url` / `ad.video_url` / `event.cover_url`.

Un SINGUR pipeline pentru toate rutele de upload din admin — doar politica
diferă (ce tipuri se acceptă, sub ce prefix se salvează, ce acțiune se auditează):
- reclame (`ads/`): imagini + video;
- coperte de eveniment (`events/`): DOAR imagini (un video → 415).

Nu reinventăm validarea: refolosim detecția din `chat_media` (magic bytes, nu
Content-Type-ul declarat de client, care e spoofabil) și pipeline-ul de poze
(`image_variants.process_image`: fără EXIF/GPS, ≤1600px, JPEG q82). Copertele
de eveniment primesc și varianta `_800.webp` (cardurile din listă); creativele
reclamelor doar originalul curățat. Limite:
- imagini: jpeg / png / webp (fără gif), `max_upload_bytes`;
- video: mp4 / mov / webm, `story_video_max_bytes` (nginx permite 55 MB);
- audio (mesaje vocale în chat) NU e un creativ valid → 415.

Erorile poartă un `code` stabil (vezi `app/core/errors.py`), ca panoul să
decidă după cod, nu după text.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import CodedHTTPException, ErrorCode
from app.models.user import User
from app.services.admin_service import audit, request_ip

# RO: importul înregistrează și tipurile `.webm` / `.mov` în `mimetypes`, ca
# StaticFiles (STORAGE_PROVIDER=local) să servească video-ul cu tipul corect.
from app.services.chat_media import _MIME_EXT, _sniff_av, _sniff_image, process_upload_image
from app.services.image_variants import ProcessedImage, save_with_variants
from app.services.storage import get_storage

# Prefixe dedicate în storage (publice: creativele și copertele se arată tuturor).
AD_MEDIA_PREFIX = "ads/"
EVENT_COVER_PREFIX = "events/"

IMAGE_MAX_SIDE = 1600
# Variantele WebP pe prefix (copertele apar ca miniaturi în lista de evenimente).
_PREFIX_VARIANTS: dict[str, tuple[int, ...]] = {EVENT_COVER_PREFIX: (800,)}

IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
VIDEO_TYPES = frozenset({"video/mp4", "video/quicktime", "video/webm"})

_DETAIL_IMAGE_AND_VIDEO = (
    "Tip de fișier nepermis. Se acceptă imagini (jpeg, png, webp) "
    "și video (mp4, mov, webm)."
)
_DETAIL_IMAGE_ONLY = "Tip de fișier nepermis. Se acceptă doar imagini (jpeg, png, webp)."


@dataclass
class AdminMedia:
    """Un fișier validat, gata de salvat în storage."""

    media_type: str  # 'image' | 'video'
    mime: str
    content: bytes
    # Poza procesată (original JPEG + variante WebP); None pentru video.
    processed: ProcessedImage | None = None


@dataclass
class UploadedMedia:
    """Rezultatul unui upload: URL-ul public absolut + tipul media."""

    url: str
    media_type: str


# --------------------------------------------------------------------------- #
# Erori cu cod stabil
# --------------------------------------------------------------------------- #


def _too_large(limit_bytes: int, what: str = "Fișierul este") -> CodedHTTPException:
    mb = limit_bytes // (1024 * 1024)
    return CodedHTTPException(
        status_code=413,
        detail=f"{what} prea mare (maxim {mb} MB).",
        code=ErrorCode.FILE_TOO_LARGE,
    )


def _unsupported(allow_video: bool) -> CodedHTTPException:
    return CodedHTTPException(
        status_code=415,
        detail=_DETAIL_IMAGE_AND_VIDEO if allow_video else _DETAIL_IMAGE_ONLY,
        code=ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    )


def _invalid(detail: str) -> CodedHTTPException:
    return CodedHTTPException(status_code=422, detail=detail, code=ErrorCode.INVALID_MEDIA)


# --------------------------------------------------------------------------- #
# Validare
# --------------------------------------------------------------------------- #


def max_read_bytes(allow_video: bool) -> int:
    """Plafonul de citire, înainte de a ști tipul (cea mai mare limită permisă)."""
    if not allow_video:
        return settings.max_upload_bytes
    return max(settings.max_upload_bytes, settings.story_video_max_bytes)


def validate_admin_media(
    content: bytes, *, allow_video: bool, variants: tuple[int, ...] = ()
) -> AdminMedia:
    """Validează un fișier → `AdminMedia`. Ridică 422 (gol/corupt), 413, 415.

    Pozele ies JPEG ≤1600px fără metadate (+ `variants` WebP). Sincron și
    CPU-bound — din cod async se cheamă prin `asyncio.to_thread`.
    """
    if not content:
        raise _invalid("Fișier gol.")

    image_mime = _sniff_image(content)
    if image_mime is not None:
        if image_mime not in IMAGE_TYPES:  # ex. GIF: nu e acceptat
            raise _unsupported(allow_video)
        if len(content) > settings.max_upload_bytes:
            raise _too_large(settings.max_upload_bytes, "Imaginea este")
        try:
            processed = process_upload_image(
                content, max_side=IMAGE_MAX_SIDE, variants=variants
            )
        except HTTPException as exc:
            # `process_upload_image` ridică 413 (bombă de decompresie / prea mulți
            # pixeli) sau 422 (imagine coruptă) fără cod — îi punem codul contractului.
            if exc.status_code == 413:
                raise CodedHTTPException(
                    status_code=413, detail=str(exc.detail), code=ErrorCode.FILE_TOO_LARGE
                ) from exc
            raise _invalid(str(exc.detail)) from exc
        return AdminMedia(
            media_type="image",
            mime="image/jpeg",
            content=processed.original,
            processed=processed,
        )

    if not allow_video:
        # Orice nu e imagine permisă (inclusiv un video valid) → 415.
        raise _unsupported(allow_video)

    av = _sniff_av(content)
    if av is None:
        raise _unsupported(allow_video)
    kind, mime = av
    if kind != "video" or mime not in VIDEO_TYPES:  # audio-only → nu e creativ
        raise _unsupported(allow_video)
    if len(content) > settings.story_video_max_bytes:
        raise _too_large(settings.story_video_max_bytes, "Video-ul este")
    # Video-ul NU se transcodează (ca în chat / stories).
    return AdminMedia(media_type="video", mime=mime, content=content)


def build_media_key(prefix: str, mime: str) -> str:
    """Cheie generată server-side: `{prefix}{uuid}.{ext}` — niciodată `filename` brut."""
    return f"{prefix}{uuid.uuid4().hex}.{_MIME_EXT[mime]}"


# --------------------------------------------------------------------------- #
# Punctul de intrare pentru rute
# --------------------------------------------------------------------------- #


async def handle_admin_upload(
    request: Request,
    db: AsyncSession,
    admin: User,
    *,
    prefix: str,
    allow_video: bool,
    action: str,
    target_type: str,
) -> UploadedMedia:
    """Citește `file` din multipart (plafonat), validează, salvează, auditează."""
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        raise HTTPException(
            status_code=422, detail="Se așteaptă multipart/form-data cu câmpul 'file'."
        )
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="Lipsește câmpul 'file' (multipart).")

    # Citire PLAFONATĂ: cel mult limita + 1 byte — destul ca să răspundem 413,
    # fără să încărcăm în RAM un fișier oricât de mare.
    limit = max_read_bytes(allow_video)
    if upload.size is not None and upload.size > limit:
        raise _too_large(limit)
    content = await upload.read(limit + 1)
    if len(content) > limit:
        raise _too_large(limit)

    media = await asyncio.to_thread(
        validate_admin_media,
        content,
        allow_video=allow_video,
        variants=_PREFIX_VARIANTS.get(prefix, ()),
    )
    key = build_media_key(prefix, media.mime)
    if media.processed is not None:
        url = await save_with_variants(get_storage(), key, media.processed)
    else:
        url = await get_storage().save(key, media.content, media.mime)

    audit(
        db,
        admin,
        action,
        target_type=target_type,
        meta={
            "url": url,
            "media_type": media.media_type,
            "mime": media.mime,
            "size": len(media.content),
        },
        ip=request_ip(request),
    )
    await db.commit()
    return UploadedMedia(url=url, media_type=media.media_type)
