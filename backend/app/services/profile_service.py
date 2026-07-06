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
    InterestItem,
    ProfileOut,
    ReferenceItem,
    ReferenceOut,
)

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
    )


async def get_profile_out(db: AsyncSession, user) -> ProfileOut | None:
    """Întoarce ProfileOut pentru user sau None dacă anketa nu există încă."""
    result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    profile = result.scalar_one_or_none()
    if profile is None:
        return None
    slugs = await _interest_slugs(db, profile.id)
    return _to_out(profile, slugs)


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

    # about ≤ 500 (Pydantic prinde deja, dar dublăm pentru siguranță)
    if data.about is not None and len(data.about) > 500:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Câmpul 'despre' depășește 500 de caractere.",
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
