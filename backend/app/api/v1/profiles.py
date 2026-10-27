"""Rute anketă/profil — sub prefixul /api/v1/profiles."""
import asyncio
import contextlib
import io
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.ratelimit import enforce_user_quota, rate_limit
from app.db.session import get_db
from app.models.profile import Profile
from app.models.user import User
from app.schemas.profile import (
    AnketaIn,
    FaceVerifyOut,
    PhotoOrderIn,
    PhotoUrlIn,
    ProfileOut,
    ReferenceOut,
)
from app.services import activity_service, legal_service, photo_moderation, profile_service
from app.services.image_variants import MAX_PIXELS, InvalidImage, process_image
from app.services.photo_moderation import get_photo_moderator
from app.services.storage import key_from_own_url

router = APIRouter()

# Formatele acceptate la upload-ul de poze (Pillow nu mai încearcă alte pluginuri).
# „JPEG" acoperă și MPO (JPEG „multi-picture", deschis prin aceeași fabrică).
_UPLOAD_FORMATS = ("JPEG", "PNG", "WEBP")

# Cota de upload de poze de profil per CONT (nu per IP), verificată ÎNAINTE de a
# citi fișierul și de a chema moderarea (apel plătit). 9 poze max pe profil →
# 30/oră acoperă larg reîncercările și înlocuirile, dar nu o buclă de abuz.
PHOTO_UPLOADS_PER_HOUR = 30

# Verificarea faciala e singura ruta de profil care cheama un serviciu extern cu
# plata. Pragul e pe ora, nu pe minut: un utilizator reincearca firesc de
# cateva ori la rand cand selfie-ul iese prost, dar nu de zeci de ori pe zi.
_face_verify_rl = rate_limit("face_verify", "rate_limit_face_verify_per_hour", 3600)

logger = logging.getLogger("app.profiles")

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

# RO: mapare format-imagine → tip-conținut canonic (sursa forțării server-side).
_FORMAT_TO_CONTENT_TYPE = {
    "jpeg": "image/jpeg",
    "mpo": "image/jpeg",  # JPEG multi-picture (unele camere) — tot un JPEG
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
            with Image.open(io.BytesIO(content), formats=_UPLOAD_FORMATS) as img:
                fmt = (img.format or "").lower()
                width, height = img.size  # doar antetul — fără decodare
        except Image.DecompressionBombError:
            raise _too_many_pixels() from None
        except Exception:
            return None
        # Anti decompression bomb: refuzat ÎNAINTE de moderare și de procesare
        # (ambele decodează imaginea, în paralel).
        if width * height > MAX_PIXELS:
            raise _too_many_pixels()
    else:
        import imghdr  # stdlib fallback

        fmt = imghdr.what(None, h=content)
    return _FORMAT_TO_CONTENT_TYPE.get(fmt or "")


def _too_many_pixels() -> HTTPException:
    return HTTPException(status_code=413, detail="Imaginea are dimensiuni prea mari.")


async def read_upload_capped(upload, limit: int) -> bytes:
    """Citește un `UploadFile` fără a încărca în RAM mai mult de `limit`+1 octeți.

    Pre-verificare pe `upload.size` (cunoscut după parsarea multipart-ului), apoi
    `read(limit + 1)`: un fișier de 2 GB nu mai ajunge întreg în memorie doar ca
    să fie respins după aceea cu 413.
    """
    too_large = HTTPException(
        status_code=413, detail=f"Fișier prea mare (max {limit} bytes)."
    )
    size = getattr(upload, "size", None)
    if size is not None and size > limit:
        raise too_large
    content = await upload.read(limit + 1)
    if len(content) > limit:
        raise too_large
    return content


def _validate_image_upload(content: bytes, declared_content_type: str) -> str:
    """Validează un upload de imagine și întoarce tipul-conținut sigur (forțat).

    - respinge fișiere > settings.max_upload_bytes (413);
    - cere content_type declarat în allowlist (422);
    - verifică magic-bytes că e imagine reală și permisă (422);
    - respinge imaginile cu prea mulți pixeli (antet, fără decodare) (413);
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


# RO: mesajele arătate userului la respingere — pe categorie, în ROMÂNĂ. Nu spunem
# „modelul AI a decis": userul are nevoie să știe CE să facă, nu cine a decis.
_MODERATION_MESSAGES = {
    "nudity": (
        "Poza conține nuditate explicită și nu poate fi publicată. "
        "Alege altă fotografie."
    ),
    "sexual_activity": (
        "Poza conține conținut sexual explicit și nu poate fi publicată. "
        "Alege altă fotografie."
    ),
    "violence": (
        "Poza conține violență și nu poate fi publicată. Alege altă fotografie."
    ),
    "minor": (
        "Poza pare să conțină un minor într-un context nepotrivit și nu poate fi "
        "publicată. FLIRT este o aplicație 18+. Alege altă fotografie."
    ),
}
_MODERATION_MESSAGE_DEFAULT = (
    "Poza conține conținut explicit și nu poate fi publicată. "
    "Alege altă fotografie."
)

# RO: plafonul moderării pe calea de UPLOAD (secunde). Providerul de rețea are
# propriul timeout de 30s (`ai._HTTP_TIMEOUT`), gândit pentru răspunsuri lungi; un
# user care încarcă o poză nu poate aștepta atât („pozele se încarcă greu"). Peste
# plafon tratăm exact ca pe o pană a providerului: rezerva LOCALĂ, apoi FAIL-OPEN
# cu review uman — aceeași politică, doar fără coada de 30s.
UPLOAD_MODERATION_TIMEOUT_S = 12.0


async def _moderate_photo(content: bytes, content_type: str, user: User) -> None:
    """Moderare NSFW ÎNAINTE de salvarea în storage (Apple Guideline 1.2).

    Ridică 422 cu un mesaj clar în română dacă providerul respinge EXPLICIT poza.
    Dacă providerul cade (sau depășește `UPLOAD_MODERATION_TIMEOUT_S`), verdictul
    e FAIL-OPEN (allowed=True, needs_review=True): logăm pentru review uman și
    lăsăm poza să treacă — o pană externă nu are voie să blocheze uploadul.
    """
    try:
        verdict = await asyncio.wait_for(
            get_photo_moderator().check(content, content_type),
            timeout=UPLOAD_MODERATION_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        verdict = await photo_moderation._local_fallback(
            content, content_type, "upload_timeout"
        )

    if verdict.needs_review:
        # RO: nu putem crea un raport automat în coada de moderare: `Report` cere un
        # `reporter_id` real (FK spre users) și nu există un user „sistem"; un raport
        # cu userul însuși ca raportor l-ar împinge spre auto-ban. Deci: LOG.
        logger.warning(
            "photo_moderation: NEDECIS pentru user_id=%s (motiv=%s) — poza a fost "
            "acceptată FAIL-OPEN și necesită REVIEW UMAN.",
            user.id,
            verdict.raw_label,
        )
        return

    if verdict.allowed:
        return

    logger.info(
        "photo_moderation: poză RESPINSĂ pentru user_id=%s (categorie=%s, label=%s).",
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


async def _ensure_photo_slot(db: AsyncSession, user: User) -> None:
    """422 dacă profilul are deja `max_photos` poze — verificat ÎNAINTE de upload.

    `profile_service.add_photo` re-verifică (sursa de adevăr, după moderare); aici
    doar oprim devreme cererea care oricum ar fi respinsă, ca să nu plătim
    moderarea și procesarea pentru o poză care nu poate fi adăugată. Fără profil →
    lăsăm `add_photo` să întoarcă 404-ul obișnuit.
    """
    photos = (
        await db.execute(select(Profile.photos).where(Profile.user_id == user.id))
    ).scalar_one_or_none()
    if photos is not None and len(photos) >= settings.max_photos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Numărul maxim de poze este {settings.max_photos}.",
        )


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
        # Cota per cont + plafonul de poze ÎNAINTE de a citi fișierul și de a
        # chema moderarea (apel PLĂTIT): un profil plin nu mai consumă nimic.
        await enforce_user_quota(
            "profile_photo", user.id, PHOTO_UPLOADS_PER_HOUR, 3600
        )
        await _ensure_photo_slot(db, user)
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lipsește câmpul 'file' (multipart).",
            )
        content = await read_upload_capped(upload, settings.max_upload_bytes)
        # Validare securitate: dimensiune, tip declarat, magic-bytes, pixeli
        # (anti decompression bomb — ÎNAINTE de moderare); tip forțat.
        detected_type = _validate_image_upload(content, upload.content_type or "")
        # Moderarea NSFW (apel de rețea — secunde) și procesarea (CPU — sute de
        # ms) rulează ÎN PARALEL: înainte erau una după alta și timpii se adunau
        # în fiecare upload. Moderarea primește poza brută (deja validată pe
        # magic-bytes); providerul o micșorează oricum la ≤1024px.
        moderation = asyncio.create_task(_moderate_photo(content, detected_type, user))
        try:
            # Curățare + micșorare (EXIF/GPS out, ≤1600px JPEG) + variante WebP
            # 256/800. CPU-bound → firul de lucru, nu event loop-ul.
            processed = await asyncio.to_thread(process_image, content)
        except BaseException as exc:
            moderation.cancel()
            with contextlib.suppress(BaseException):
                await moderation
            if isinstance(exc, InvalidImage):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Conținutul încărcat nu este o imagine validă.",
                ) from exc
            raise
        # Verdictul se AȘTEAPTĂ înainte de storage: o poză respinsă nu are voie să
        # atingă niciodată discul/bucket-ul (Apple Guideline 1.2) — 422 de aici.
        await moderation
        return await profile_service.add_photo(
            db,
            user,
            filename="photo",  # RO: `filename` brut ignorat — cheia vine din uuid.
            content=processed.original,
            content_type="image/jpeg",
            processed=processed,
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


@router.post(
    "/verify-face",
    response_model=FaceVerifyOut,
    dependencies=[Depends(_face_verify_rl)],
)
async def verify_face(request: Request, db: DbDep, user: UserDep) -> FaceVerifyOut:
    """Verificare facială (TZ 2.2): compară un selfie cu pozele profilului.

    Acceptă fie un fișier (multipart, câmp 'file'), fie un body JSON simplu
    (mod stub — conținutul nu contează). Setează `Profile.verified` și întoarce
    `{verified, similarity}`.

    În producție cu providerul în modul de dezvoltare REFUZĂ (503), fiindcă
    acolo stub-ul ar acorda insigna „verificat" oricui — vezi mai jos.
    """
    # Insigna „profil verificat" e o promisiune făcută CELORLALȚI utilizatori:
    # ei decid cu cine se întâlnesc și pe baza ei. Providerul de dezvoltare
    # întoarce (True, 99.0) pentru ORICINE, fără să compare nimic — deci în
    # producție ar fabrica exact acea promisiune, iar cel înșelat nu e cel care
    # apasă butonul, ci persoana din fața lui. Refuzăm explicit; funcția e deja
    # declarată indisponibilă în `GET /capabilities` (`face_verification:false`),
    # iar refuzul de aici e plasa pentru un client care întreabă oricum.
    #
    # 503, nu 4xx: nu e nimic greșit în cererea userului — el n-are ce corecta,
    # iar un 4xx l-ar trimite să repare ce nu depinde de el. Nu 501 (acela spune
    # „serverul nu implementează asta", dar codul EXISTĂ și pornește cu o cheie
    # reală de provider) și nu 200 cu `verified:false`, care s-ar citi ca „nu
    # semeni cu pozele tale" — o minciună la fel de gravă, doar în cealaltă
    # direcție. 503 = funcția nu se servește acum pe acest server.
    #
    # Doar în producție: în dezvoltare și staging stub-ul rămâne cum e, altfel
    # fluxul de verificare n-ar mai putea fi testat nicăieri.
    if settings.environment == "production" and not settings.capabilities["face_verification"]:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verificarea facială nu este disponibilă pe acest server.",
        )

    # Selfie-ul e o dată biometrică (categorie specială, Legea nr. 195/2024 /
    # GDPR art. 9): îl procesăm DOAR cu consimțământ explicit, separat
    # (`sensitive_data`), dat prin `POST /legal/consent`. Verificat ÎNAINTE de a
    # citi fișierul — fără consimțământ, imaginea nu e nici măcar citită.
    if settings.face_verify_requires_consent and not await legal_service.has_sensitive_consent(
        db, user
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "sensitive_consent_required",
                "message": (
                    "Verificarea facială necesită consimțământul explicit pentru "
                    "prelucrarea datelor biometrice."
                ),
            },
        )

    content_type = request.headers.get("content-type", "")

    if content_type.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or not hasattr(upload, "read"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Lipsește câmpul 'file' (multipart).",
            )
        selfie = await read_upload_capped(upload, settings.max_upload_bytes)
        # Validare securitate a selfie-ului (dimensiune, tip, magic-bytes).
        _validate_image_upload(selfie, upload.content_type or "")
    else:
        # RO: în stub nu avem nevoie de bytes reali — corpul poate lipsi.
        selfie = b""

    return await profile_service.verify_face(db, user, selfie)


@router.post("/{user_id}/view", status_code=status.HTTP_204_NO_CONTENT)
async def record_profile_view(user_id: uuid.UUID, db: DbDep, user: UserDep) -> Response:
    """Notează că userul curent a DESCHIS anketa lui `user_id` (protejat).

    Alimentează „cine ți-a văzut profilul" din centrul de activitate. Deduplicat
    per viewer per zi în baza de date. Răspunde 204 ORICUM (inclusiv pentru un id
    inexistent, blocat sau propriu) — ruta nu e un oracol despre alți useri.
    Vizualizările din feed se notează pe server, la swipe, fără cerere separată.
    """
    await activity_service.record_profile_open(db, user, user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
