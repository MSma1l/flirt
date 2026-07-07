"""Rute anketă/profil — sub prefixul /api/v1/profiles."""
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.profile import (
    AnketaIn,
    FaceVerifyOut,
    PhotoOrderIn,
    PhotoUrlIn,
    ProfileOut,
    ReferenceOut,
)
from app.services import profile_service
from app.services.storage import key_from_own_url

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

# RO: mapare format-imagine → tip-conținut canonic (sursa forțării server-side).
_FORMAT_TO_CONTENT_TYPE = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def _detect_image_content_type(content: bytes) -> str | None:
    """Detectează tipul real al imaginii din magic-bytes (nu din header-ul HTTP).

    Preferă Pillow dacă e instalat; altfel `imghdr` din stdlib. Întoarce un
    tip-conținut canonic ('image/jpeg' | 'image/png' | 'image/webp') sau None.
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
        import imghdr  # stdlib fallback

        fmt = imghdr.what(None, h=content)
    return _FORMAT_TO_CONTENT_TYPE.get(fmt or "")


def _validate_image_upload(content: bytes, declared_content_type: str) -> str:
    """Validează un upload de imagine și întoarce tipul-conținut sigur (forțat).

    - respinge fișiere > settings.max_upload_bytes (413);
    - cere content_type declarat în allowlist (422);
    - verifică magic-bytes că e imagine reală și permisă (422);
    - întoarce tipul canonic (server-side), independent de input.
    """
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Fișier prea mare (max {settings.max_upload_bytes} bytes).",
        )
    if not content:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Fișier gol.",
        )
    if declared_content_type not in settings.allowed_image_types_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tip de fișier nepermis.",
        )
    detected = _detect_image_content_type(content)
    if detected is None or detected not in settings.allowed_image_types_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Conținutul încărcat nu este o imagine validă.",
        )
    return detected


@router.get("/reference", response_model=ReferenceOut)
async def get_reference(db: DbDep) -> ReferenceOut:
    """Opțiunile de referință (genuri, statusuri, limbi, interese) — PUBLIC."""
    return await profile_service.get_reference(db)


@router.get("/me", response_model=ProfileOut)
async def get_my_profile(db: DbDep, user: UserDep) -> ProfileOut:
    """Anketa utilizatorului curent (404 dacă nu a fost completată încă)."""
    profile = await profile_service.get_profile_out(db, user)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Anketa nu există încă."
        )
    return profile


@router.put("/me", response_model=ProfileOut)
async def upsert_my_profile(data: AnketaIn, db: DbDep, user: UserDep) -> ProfileOut:
    """Creează sau actualizează anketa; o marchează drept completată."""
    return await profile_service.upsert_anketa(db, user, data)


@router.post("/photos", response_model=list[str])
async def add_photo(request: Request, db: DbDep, user: UserDep) -> list[str]:
    """Adaugă o poză: fie fișier (multipart), fie body JSON {url} (stub).

    Întoarce lista actualizată de URL-uri. 422 la depășirea max_photos.
    """
    content_type = request.headers.get("content-type", "")

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lipsește câmpul 'file' (multipart).",
            )
        content = await upload.read()
        # Validare securitate: dimensiune, tip declarat, magic-bytes; tip forțat.
        safe_content_type = _validate_image_upload(
            content, upload.content_type or ""
        )
        return await profile_service.add_photo(
            db,
            user,
            filename="photo",  # RO: `filename` brut ignorat — cheia vine din uuid.
            content=content,
            content_type=safe_content_type,
        )

    # RO: altfel — body JSON cu URL direct (mod stub). URL-ul trebuie să fie în
    # storage-ul propriu ȘI sub prefixul photos/{profile_id}/ al userului curent.
    payload = await request.json()
    data = PhotoUrlIn.model_validate(payload)
    profile_id = await profile_service.require_profile_id(db, user)
    if key_from_own_url(data.url, profile_id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="URL de poză nepermis (în afara storage-ului tău).",
        )
    return await profile_service.add_photo(
        db,
        user,
        filename="photo",
        content=b"",
        content_type="application/octet-stream",
        url=data.url,
    )


@router.delete("/photos", response_model=list[str])
async def delete_photo(data: PhotoUrlIn, db: DbDep, user: UserDep) -> list[str]:
    """Scoate un URL din poze + storage.delete; întoarce lista actualizată.

    Respinge (403) URL-urile în afara storage-ului propriu / prefixului
    photos/{profile_id}/ — anti ștergere arbitrară de obiecte.
    """
    profile_id = await profile_service.require_profile_id(db, user)
    if key_from_own_url(data.url, profile_id) is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="URL de poză nepermis (în afara storage-ului tău).",
        )
    return await profile_service.remove_photo(db, user, data.url)


@router.put("/photos/order", response_model=list[str])
async def reorder_photos(data: PhotoOrderIn, db: DbDep, user: UserDep) -> list[str]:
    """Reordonează pozele (aceleași URL-uri); întoarce lista actualizată."""
    return await profile_service.reorder_photos(db, user, data.urls)


@router.post("/verify-face", response_model=FaceVerifyOut)
async def verify_face(request: Request, db: DbDep, user: UserDep) -> FaceVerifyOut:
    """Verificare facială (TZ 2.2): compară un selfie cu pozele profilului.

    Acceptă fie un fișier (multipart, câmp 'file'), fie un body JSON simplu
    (mod stub — conținutul nu contează). Setează `Profile.verified` și întoarce
    `{verified, similarity}`.
    """
    content_type = request.headers.get("content-type", "")

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lipsește câmpul 'file' (multipart).",
            )
        selfie = await upload.read()
        # Validare securitate a selfie-ului (dimensiune, tip, magic-bytes).
        _validate_image_upload(selfie, upload.content_type or "")
    else:
        # RO: în stub nu avem nevoie de bytes reali — corpul poate lipsi.
        selfie = b""

    return await profile_service.verify_face(db, user, selfie)
