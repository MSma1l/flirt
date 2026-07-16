"""Rute Stories — sub prefixul /api/v1/stories (TZ secț. 11).

`/mine` e declarat înaintea rutelor parametrizate. Poveștile expiră la 24h și
sunt vizibile autorului + utilizatorilor cu care are Match.
"""
import io
import logging
import uuid
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

# RO: mesajele de respingere NSFW au o singură sursă de adevăr (`profiles`) — un
# story respins și o poză de profil respinsă trebuie să sune identic pentru user.
from app.api.v1.profiles import _MODERATION_MESSAGE_DEFAULT, _MODERATION_MESSAGES
from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.story import StoryIn, StoryMediaOut, StoryOut, UserStories
from app.services import story_service
from app.services.pagination import MAX_CURSOR_LENGTH, STORIES_MAX_LIMIT
from app.services.photo_moderation import get_photo_moderator
from app.services.storage import get_storage

logger = logging.getLogger("app.stories")

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

LimitQuery = Annotated[int | None, Query(ge=1, le=STORIES_MAX_LIMIT)]
CursorQuery = Annotated[str | None, Query(max_length=MAX_CURSOR_LENGTH)]

# RO: extensia sigură pe tip de conținut, sursa de adevăr pentru cheia de storage.
# Cheia NU folosește niciodată `filename` brut de la client (anti path traversal);
# extensia vine din tipul detectat, validat față de allowlist.
# Doar imagini — vezi `_reject_video()` pentru motivul blocării video-ului.
_STORY_MEDIA_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
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


def _is_video_content(content: bytes) -> bool:
    """Conținutul e un container video ISO-BMFF (mp4/QuickTime, box `ftyp`)?

    mp4 și .mov au la offset 4 marcajul `ftyp`. Nu ne bazăm pe Content-Type-ul
    declarat (spoofabil) — ne uităm la conținutul real, ca un video redenumit
    `.jpg` să nu treacă de poarta de mai jos.
    """
    return len(content) >= 12 and content[4:8] == b"ftyp"


def _reject_video(content: bytes, declared_ct: str) -> None:
    """POARTA VIDEO: story-urile acceptă DOAR fotografii. Ridică 422 pentru video.

    DE CE (a se citi înainte de a repune video-ul din reflex):
    Apple Guideline 1.2 (User-Generated Content) cere filtrarea automată a
    conținutului obiecționabil. Pozele trec prin `photo_moderation` (NSFW), dar
    pentru VIDEO nu avem moderare automată — ar rămâne o gaură prin care intră
    conținut explicit → risc direct de respingere în App Store.

    Poarta stă AICI, în endpoint, nu în config: `allowed_video_types` și
    `story_video_max_bytes` rămân neatinse în `settings`, iar reactivarea video-ului
    (după ce există moderare de video) înseamnă doar ștergerea acestei funcții și a
    apelului ei + repunerea ramurii de detecție. Fără migrări, fără atins configul.
    """
    if declared_ct in settings.allowed_video_types_set or _is_video_content(content):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Story-urile acceptă doar fotografii.",
        )


def _validate_story_photo(content: bytes, declared_ct: str) -> str:
    """Validează o poză de story → content_type sigur (canonic).

    Allowlist `allowed_image_types` + limita pozelor (`max_upload_bytes`). Tipul e
    FORȚAT din magic-bytes, nu din header-ul de upload (anti-spoofing).
    Ridică 413 (prea mare), 422 (gol / video / tip nepermis / conținut invalid).
    """
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Fișier gol."
        )

    _reject_video(content, declared_ct)

    if declared_ct not in settings.allowed_image_types_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tip de fișier nepermis.",
        )

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
    return detected


async def _moderate_story_photo(content: bytes, content_type: str, user: User) -> None:
    """Moderare NSFW ÎNAINTE de salvarea în storage (Apple Guideline 1.2).

    Același tipar ca la pozele de profil (`profiles._moderate_photo`): doar un verdict
    EXPLICIT negativ respinge poza (422, mesaj în română). Dacă providerul cade,
    `check` întoarce FAIL-OPEN (allowed=True, needs_review=True): logăm pentru review
    uman și lăsăm story-ul să treacă — o pană externă nu blochează uploadul.
    """
    verdict = await get_photo_moderator().check(content, content_type)

    if verdict.needs_review:
        # RO: nu putem crea un raport automat (Report cere un `reporter_id` real și
        # nu există un user „sistem") → LOG, ca la poze de profil.
        logger.warning(
            "photo_moderation: NEDECIS pentru story-ul user_id=%s (motiv=%s) — poza "
            "a fost acceptată FAIL-OPEN și necesită REVIEW UMAN.",
            user.id,
            verdict.raw_label,
        )
        return

    if verdict.allowed:
        return

    logger.info(
        "photo_moderation: poză de story RESPINSĂ pentru user_id=%s "
        "(categorie=%s, label=%s).",
        user.id,
        verdict.reason,
        verdict.raw_label,
    )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=_MODERATION_MESSAGES.get(
            verdict.reason or "", _MODERATION_MESSAGE_DEFAULT
        ),
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
    """Încarcă FOTOGRAFIA unui story → `{media_url, media_type: 'image'}`.

    Multipart, câmp `file`. Refolosește layer-ul de storage (`stub`|`s3`). NU creează
    povestea: clientul cheamă apoi POST /stories/ cu `media_url` + `media_type`.
    Validarea forțează tipul din magic-bytes și aplică limitele din config.
    Video-ul e refuzat cu 422 (vezi `_reject_video`), iar poza trece prin moderarea
    NSFW ÎNAINTE de a atinge storage-ul.
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
    safe_ct = _validate_story_photo(content, upload.content_type or "")

    # RO: moderarea rulează ÎNAINTE de storage — o poză respinsă nu se salvează deloc.
    await _moderate_story_photo(content, safe_ct, user)

    storage = get_storage()
    key = _story_media_key(user.id, safe_ct)
    media_url = await storage.save(key, content, safe_ct)
    return StoryMediaOut(media_url=media_url, media_type="image")


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
