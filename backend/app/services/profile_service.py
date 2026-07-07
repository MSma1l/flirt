"""Logica de business pentru anketă/profil: referință, seed catalog, upsert."""
from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.schemas.profile import (
    AnketaIn,
    FaceVerifyOut,
    InterestItem,
    ProfileOut,
    ReferenceItem,
    ReferenceOut,
)
from app.services.face_verify import get_face_verifier
from app.services.storage import get_storage

# --- Cataloage de referință (derivate din TZ, nu hardcodate ca reguli) ---------

# Genuri (TZ 2.4: муж / жен / другое)
GENDERS: list[ReferenceItem] = [
    ReferenceItem(value="male", label_ru="Мужчина", label_ro="Bărbat"),
    ReferenceItem(value="female", label_ru="Женщина", label_ro="Femeie"),
    ReferenceItem(value="other", label_ru="Другое", label_ro="Altul"),
]

# Statusuri de cunoștință (TZ 2.6)
DATING_STATUSES: list[ReferenceItem] = [
    ReferenceItem(value="serious", label_ru="Серьёзные отношения",
                  label_ro="Relație serioasă"),
    ReferenceItem(value="acquaintance", label_ru="Просто познакомиться",
                  label_ro="Doar cunoștință"),
    ReferenceItem(value="friendship", label_ru="Дружба / общение",
                  label_ro="Prietenie / comunicare"),
    ReferenceItem(value="events", label_ru="Совместный поход на мероприятия",
                  label_ro="Mers împreună la evenimente"),
    ReferenceItem(value="casual", label_ru="Без обязательств",
                  label_ro="Fără obligații"),
]

# Limbi sugerate (TZ 2.4: русский, румынский, английский + свой вариант)
LANGUAGES: list[ReferenceItem] = [
    ReferenceItem(value="ru", label_ru="Русский", label_ro="Rusă"),
    ReferenceItem(value="ro", label_ru="Румынский", label_ro="Română"),
    ReferenceItem(value="en", label_ru="Английский", label_ro="Engleză"),
]

# Catalog de interese (TZ 2.5). (slug, label_ru, label_ro)
INTERESTS_CATALOG: list[tuple[str, str, str]] = [
    ("sport", "Спорт", "Sport"),
    ("travel", "Путешествия", "Călătorii"),
    ("cars", "Автомобили", "Automobile"),
    ("music", "Музыка", "Muzică"),
    ("dancing", "Танцы", "Dans"),
    ("business", "Бизнес", "Business"),
    ("movies", "Кино и сериалы", "Filme și seriale"),
    ("books", "Книги", "Cărți"),
    ("games", "Игры", "Jocuri"),
    ("animals", "Собаки / животные", "Câini / animale"),
    ("cooking", "Кулинария", "Gătit"),
    ("photography", "Фотография", "Fotografie"),
    ("yoga", "Йога и медитация", "Yoga și meditație"),
    ("fashion", "Мода", "Modă"),
    ("nature", "Природа и активный отдых", "Natură și activități în aer liber"),
    ("board_games", "Настольные игры", "Jocuri de societate"),
    ("volunteering", "Волонтёрство", "Voluntariat"),
    ("technology", "Технологии", "Tehnologie"),
    ("art", "Искусство", "Artă"),
]


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Calculează vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


async def seed_interests(db: AsyncSession) -> None:
    """Inserează catalogul de interese dacă lipsește (idempotent)."""
    result = await db.execute(select(Interest.slug))
    existing = {row[0] for row in result.all()}
    new_rows = [
        Interest(slug=slug, label_ru=label_ru, label_ro=label_ro)
        for slug, label_ru, label_ro in INTERESTS_CATALOG
        if slug not in existing
    ]
    if new_rows:
        db.add_all(new_rows)
        await db.commit()


async def get_reference(db: AsyncSession) -> ReferenceOut:
    """Întoarce toate opțiunile de referință; asigură seed-ul catalogului."""
    await seed_interests(db)
    result = await db.execute(select(Interest).order_by(Interest.label_ru))
    interests = [
        InterestItem(slug=i.slug, label_ru=i.label_ru, label_ro=i.label_ro)
        for i in result.scalars().all()
    ]
    return ReferenceOut(
        genders=GENDERS,
        dating_statuses=DATING_STATUSES,
        languages=LANGUAGES,
        interests=interests,
    )


async def _interest_slugs(db: AsyncSession, profile_id) -> list[str]:
    """Slug-urile intereselor legate de un profil."""
    result = await db.execute(
        select(Interest.slug)
        .join(ProfileInterest, ProfileInterest.interest_id == Interest.id)
        .where(ProfileInterest.profile_id == profile_id)
        .order_by(Interest.slug)
    )
    return [row[0] for row in result.all()]


def _to_out(profile: Profile, interest_slugs: list[str]) -> ProfileOut:
    """Construiește ProfileOut din model + slug-uri de interese + vârsta."""
    return ProfileOut(
        name=profile.name,
        birth_date=profile.birth_date,
        age=_calc_age(profile.birth_date),
        gender=profile.gender,
        height_cm=profile.height_cm,
        city=profile.city,
        street=profile.street,
        nationality=profile.nationality,
        languages=profile.languages or [],
        about=profile.about,
        dating_statuses=profile.dating_statuses or [],
        interests=interest_slugs,
        photos=profile.photos or [],
        humor_vector=profile.humor_vector,
        completed=profile.completed,
        verified=profile.verified,
    )


async def get_profile_out(db: AsyncSession, user) -> ProfileOut | None:
    """Întoarce ProfileOut pentru user sau None dacă anketa nu există încă."""
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        return None
    slugs = await _interest_slugs(db, profile.id)
    return _to_out(profile, slugs)


async def _get_profile_or_404(db: AsyncSession, user) -> Profile:
    """Întoarce modelul Profile al userului sau ridică 404 dacă lipsește."""
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Anketa nu există încă."
        )
    return profile


async def add_photo(
    db: AsyncSession,
    user,
    *,
    filename: str,
    content: bytes,
    content_type: str,
    url: str | None = None,
) -> list[str]:
    """Adaugă o poză (prin upload sau URL direct în stub) și întoarce lista.

    Respectă `settings.max_photos` → 422 la depășire.
    """
    profile = await _get_profile_or_404(db, user)
    photos = list(profile.photos or [])

    if len(photos) >= settings.max_photos:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Numărul maxim de poze este {settings.max_photos}.",
        )

    storage = get_storage()
    # RO: în stub acceptăm și un URL direct; altfel salvăm conținutul.
    saved_url = url if url else await storage.save(filename, content, content_type)

    photos.append(saved_url)
    profile.photos = photos  # reasignare → SQLAlchemy detectează modificarea JSON
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return list(profile.photos or [])


async def remove_photo(db: AsyncSession, user, url: str) -> list[str]:
    """Scoate un URL din poze + îl șterge din storage; întoarce lista."""
    profile = await _get_profile_or_404(db, user)
    photos = list(profile.photos or [])

    if url not in photos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Poza nu a fost găsită în profil.",
        )

    photos = [p for p in photos if p != url]
    profile.photos = photos
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    # RO: ștergere din storage (no-op în stub) — după commit-ul DB.
    storage = get_storage()
    await storage.delete(url)

    return list(profile.photos or [])


async def reorder_photos(db: AsyncSession, user, urls: list[str]) -> list[str]:
    """Reordonează pozele; validează că sunt exact aceleași URL-uri (422 altfel)."""
    profile = await _get_profile_or_404(db, user)
    current = list(profile.photos or [])

    # RO: trebuie să fie exact aceeași mulțime (fără adăugări/lipsuri/duplicate).
    if sorted(urls) != sorted(current):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Lista de reordonare trebuie să conțină exact aceleași poze.",
        )

    profile.photos = list(urls)
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return list(profile.photos or [])


async def upsert_anketa(db: AsyncSession, user, data: AnketaIn) -> ProfileOut:
    """Validează și creează/actualizează anketa, marcând-o drept completată."""
    # --- Validări de business (422 la eșec) ---
    valid_genders = {g.value for g in GENDERS}
    if data.gender not in valid_genders:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Gen invalid. Valori permise: {sorted(valid_genders)}",
        )

    # Vârsta minimă din setări (nu hardcodat)
    age = _calc_age(data.birth_date)
    if age < settings.min_registration_age:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Vârsta minimă este {settings.min_registration_age} ani.",
        )

    # about ≤ about_max_length (Pydantic prinde deja, dar dublăm pentru siguranță)
    if data.about is not None and len(data.about) > settings.about_max_length:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Câmpul 'despre' depășește {settings.about_max_length} de caractere.",
        )

    # Cel puțin o limbă
    languages = [lang for lang in (data.languages or []) if lang and lang.strip()]
    if not languages:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selectează cel puțin o limbă de comunicare.",
        )

    # Statusuri de cunoștință — doar valori din catalog
    valid_statuses = {s.value for s in DATING_STATUSES}
    dating_statuses = [s for s in (data.dating_statuses or []) if s in valid_statuses]

    # Cel puțin un interes valid din catalog
    await seed_interests(db)
    requested_slugs = {s for s in (data.interests or []) if s}
    result = await db.execute(
        select(Interest).where(Interest.slug.in_(requested_slugs))
    )
    interests = result.scalars().all()
    if not interests:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selectează cel puțin un interes valid.",
        )

    # --- Upsert Profile ---
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        profile = Profile(user_id=user.id)
        db.add(profile)

    profile.name = data.name
    profile.birth_date = data.birth_date
    profile.gender = data.gender
    profile.height_cm = data.height_cm
    profile.city = data.city
    profile.street = data.street
    profile.nationality = data.nationality
    profile.languages = languages
    profile.about = data.about
    profile.dating_statuses = dating_statuses
    profile.photos = data.photos or []
    profile.completed = True

    # Necesită id-ul profilului pentru legături — flush înainte de M2M
    await db.flush()

    # Reîncarcă legăturile de interese (înlocuire completă)
    await db.execute(
        delete(ProfileInterest).where(ProfileInterest.profile_id == profile.id)
    )
    for interest in interests:
        db.add(ProfileInterest(profile_id=profile.id, interest_id=interest.id))

    # Marchează user-ul ca având anketa completată
    user.profile_completed = True
    db.add(user)

    await db.commit()
    await db.refresh(profile)

    slugs = await _interest_slugs(db, profile.id)
    return _to_out(profile, slugs)


async def verify_face(db: AsyncSession, user, selfie: bytes) -> FaceVerifyOut:
    """Verifică selfie-ul față de pozele profilului și persistă rezultatul (TZ 2.2).

    Cheamă providerul din `settings.face_verify_provider` (stub/rekognition),
    compară cu `profile.photos` și setează `Profile.verified` la rezultat.
    """
    profile = await _get_profile_or_404(db, user)

    verifier = get_face_verifier()
    verified, similarity = await verifier.compare(selfie, list(profile.photos or []))

    profile.verified = verified
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    return FaceVerifyOut(verified=verified, similarity=similarity)
