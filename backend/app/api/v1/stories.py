"""Rute Stories — sub prefixul /api/v1/stories (TZ secț. 11).

`/mine` e declarat înaintea rutelor parametrizate. Poveștile expiră la 24h și
sunt vizibile autorului + utilizatorilor cu care are Match.
"""
import io
import uuid
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.story import StoryIn, StoryMediaOut, StoryOut, UserStories
from app.services import story_service
from app.services.pagination import MAX_CURSOR_LENGTH, STORIES_MAX_LIMIT
from app.services.storage import get_storage

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

LimitQuery = Annotated[int | None, Query(ge=1, le=STORIES_MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)]

# RO: extensia sigură pe tip de conținut (imagini + video), sursa de adevăr pentru
# cheia de storage. Cheia NU folosește niciodată `filename` brut de la client
# (anti path traversal); extensia vine din tipul detectat, validat față de allowlist.
_STORY_MEDIA_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
}

# RO: format-imagine (Pillow/imghdr) → tip-conținut canonic (forțat server-side).
_IMAGE_FORMAT_TO_CT = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def _detect_image_ct(content: bytes) -> str | None:
    """Tipul real al imaginii din magic-bytes (Pillow dacă există, altfel imghdr).

    Întoarce un tip-conținut canonic permis sau None dacă nu e o imagine validă.
    """
    fmt: str | None = None
    try:
        from PIL import Image  # import lazy — opțional
    except ImportError:
        Image = None
    if Image is not None:
        try:
            with Image.open(io.BytesIO(content)) as img:
                fmt = (img.format or "").lower()
        except Exception:
            return None
    else:
        import imghdr  # fallback stdlib

        fmt = imghdr.what(None, h=content)
    return _IMAGE_FORMAT_TO_CT.get(fmt or "")


def _detect_video_ct(content: bytes) -> str | None:
    """Tipul real al video-ului din containerul ISO-BMFF (box `ftyp`).

    mp4 și QuickTime (.mov) au la offset 4 marcajul `ftyp`, urmat de brandul major.
    Brandul `qt  ` = QuickTime; orice alt brand ISO-BMFF îl tratăm ca mp4. Nu ne
    bazăm pe Content-Type-ul declarat (spoofabil) — verificăm conținutul real.
    """
    if len(content) < 12 or content[4:8] != b"ftyp":
        return None
    return "video/quicktime" if content[8:12] == b"qt  " else "video/mp4"


def _validate_story_media(content: bytes, declared_ct: str) -> tuple[str, str]:
    """Validează un upload de media pentru story → (content_type_sigur, media_type).

    - Imagini: allowlist `allowed_image_types` + limita pozelor (`max_upload_bytes`).
    - Video:   allowlist `allowed_video_types` + limita separată (`story_video_max_bytes`).
    Tipul e FORȚAT din magic-bytes, nu din header-ul de upload (anti-spoofing).
    Ridică 413 (prea mare), 422 (gol / tip nepermis / conținut invalid).
    """
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Fișier gol."
        )

    if declared_ct in settings.allowed_image_types_set:
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Fișier prea mare (max {settings.max_upload_bytes} bytes).",
            )
        detected = _detect_image_ct(content)
        if detected is None or detected not in settings.allowed_image_types_set:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Conținutul încărcat nu este o imagine validă.",
            )
        return detected, "image"

    if declared_ct in settings.allowed_video_types_set:
        if len(content) > settings.story_video_max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Fișier prea mare (max {settings.story_video_max_bytes} bytes).",
            )
        detected = _detect_video_ct(content)
        if detected is None or detected not in settings.allowed_video_types_set:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Conținutul încărcat nu este un video valid.",
            )
        return detected, "video"

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Tip de fișier nepermis.",
    )


def _story_media_key(user_id: uuid.UUID, content_type: str) -> str:
    """Cheie de storage sigură: `stories/{user_id}/{uuid}.{ext}` (ext validată)."""
    ext = _STORY_MEDIA_EXT[content_type]  # content_type deja validat de allowlist
    return f"stories/{user_id}/{uuid4().hex}.{ext}"


@router.post("/", response_model=StoryOut, status_code=status.HTTP_201_CREATED)
async def create_story(data: StoryIn, db: DbDep, user: UserDep) -> StoryOut:
    """Publică o poveste care expiră peste 24h (protejat)."""
    return await story_service.create_story(db, user, data)


@router.post("/media", response_model=StoryMediaOut)
async def upload_story_media(request: Request, user: UserDep) -> StoryMediaOut:
    """Încarcă media (imagine sau video) pentru un story → `{media_url, media_type}`.

    Multipart, câmp `file`. Refolosește layer-ul de storage (`stub`|`s3`). NU creează
    povestea: clientul cheamă apoi POST /stories/ cu `media_url` + `media_type`.
    Validarea forțează tipul din magic-bytes și aplică limitele din config.
    """
    content_type = request.headers.get("content-type", "")
    if not content_type.startswith("multipart/form-data"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Se așteaptă multipart/form-data cu câmpul 'file'.",
        )
    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lipsește câmpul 'file' (multipart).",
        )
    content = await upload.read()
    safe_ct, media_type = _validate_story_media(content, upload.content_type or "")

    storage = get_storage()
    key = _story_media_key(user.id, safe_ct)
    media_url = await storage.save(key, content, safe_ct)
    return StoryMediaOut(media_url=media_url, media_type=media_type)


@router.get("/", response_model=list[UserStories])
async def list_stories(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[UserStories]:
    """Poveștile active proprii + ale match-urilor, grupate pe user (protejat).

    Paginare pe cursor la nivel de USER (convenția `/feed`): cursorul paginii
    următoare vine în header-ul `X-Next-Cursor`.
    """
    page = await story_service.list_active_grouped(
        db, user, limit=limit, cursor=cursor
    )
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.get("/mine", response_model=list[StoryOut])
async def list_mine(
    db: DbDep,
    user: UserDep,
    response: Response,
    limit: LimitQuery = None,
    cursor: CursorQuery = None,
) -> list[StoryOut]:
    """Poveștile active proprii (protejat), paginate pe cursor."""
    page = await story_service.list_mine(db, user, limit=limit, cursor=cursor)
    if page.next_cursor:
        response.headers["X-Next-Cursor"] = page.next_cursor
    return page.items


@router.delete("/{story_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_story(story_id: uuid.UUID, db: DbDep, user: UserDep) -> None:
    """Șterge o poveste proprie; 403/404 altfel (protejat)."""
    await story_service.delete_story(db, user, story_id)
