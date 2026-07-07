"""Rute anketă/profil — sub prefixul /api/v1/profiles."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

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

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


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
        return await profile_service.add_photo(
            db,
            user,
            filename=upload.filename or "photo",
            content=content,
            content_type=upload.content_type or "application/octet-stream",
        )

    # RO: altfel — body JSON cu URL direct (mod stub)
    payload = await request.json()
    data = PhotoUrlIn.model_validate(payload)
    return await profile_service.add_photo(
        db,
        user,
        filename=data.url.rsplit("/", 1)[-1] or "photo",
        content=b"",
        content_type="application/octet-stream",
        url=data.url,
    )


@router.delete("/photos", response_model=list[str])
async def delete_photo(data: PhotoUrlIn, db: DbDep, user: UserDep) -> list[str]:
    """Scoate un URL din poze + storage.delete; întoarce lista actualizată."""
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
    else:
        # RO: în stub nu avem nevoie de bytes reali — corpul poate lipsi.
        selfie = b""

    return await profile_service.verify_face(db, user, selfie)
