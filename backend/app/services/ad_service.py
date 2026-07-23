"""Logica sistemului de reclame (Ads).

Concentrat aici (nu în rute) după convenția proiectului: rutele rămân subțiri,
serviciul deține accesul la DB, commit-urile și regulile.

SINGLETON `AdSettings`
----------------------
Toate parametrii globali stau într-un singur rând, `id == 1`. `_get_or_create_settings`
îl citește și îl creează LENEȘ cu valorile implicite (15 / 10 / enabled) dacă
lipsește — astfel `/ads/config` și `/ads/next` funcționează chiar dacă migrarea de
seed n-a rulat încă.
"""
from __future__ import annotations

import secrets
from datetime import date, datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ad import Ad, AdSettings
from app.models.admin import (
    ACTION_AD_CREATE,
    ACTION_AD_DELETE,
    ACTION_AD_SETTINGS_UPDATE,
    ACTION_AD_UPDATE,
)
from app.models.profile import Profile
from app.models.user import User
from app.schemas.ad import (
    AdConfigOut,
    AdIn,
    AdNextOut,
    AdOut,
    AdSettingsIn,
    AdSettingsOut,
    AdUpdate,
)
from app.services.admin_service import audit

# Cheia fixă a rândului singleton de setări.
SETTINGS_ID = 1
# Valorile implicite ale singleton-ului (aceleași ca în migrarea de seed).
DEFAULT_SWIPES_BEFORE_AD = 15
DEFAULT_MAX_VIDEO_SECONDS = 10


# --------------------------------------------------------------------------- #
# Mapări ORM → schemă (fără `from_attributes` peste modelul întreg)
# --------------------------------------------------------------------------- #
def _to_ad_out(ad: Ad) -> AdOut:
    return AdOut(
        id=ad.id,
        title=ad.title,
        video_url=ad.video_url,
        image_url=ad.image_url,
        duration_seconds=ad.duration_seconds,
        active=ad.active,
        weight=ad.weight,
        target_gender=ad.target_gender,
        target_age_min=ad.target_age_min,
        target_age_max=ad.target_age_max,
        starts_at=ad.starts_at,
        ends_at=ad.ends_at,
        impressions=ad.impressions,
        clicks=ad.clicks,
        created_at=ad.created_at,
        updated_at=ad.updated_at,
    )


def _to_settings_out(s: AdSettings) -> AdSettingsOut:
    return AdSettingsOut(
        swipes_before_ad=s.swipes_before_ad,
        max_video_seconds=s.max_video_seconds,
        enabled=s.enabled,
        updated_at=s.updated_at,
    )


# --------------------------------------------------------------------------- #
# Settings singleton
# --------------------------------------------------------------------------- #
async def _get_or_create_settings(db: AsyncSession) -> AdSettings:
    """Întoarce rândul singleton `id=1`, creându-l leneș cu defaults dacă lipsește."""
    s = await db.get(AdSettings, SETTINGS_ID)
    if s is not None:
        return s
    s = AdSettings(
        id=SETTINGS_ID,
        swipes_before_ad=DEFAULT_SWIPES_BEFORE_AD,
        max_video_seconds=DEFAULT_MAX_VIDEO_SECONDS,
        enabled=True,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def get_settings(db: AsyncSession) -> AdSettingsOut:
    return _to_settings_out(await _get_or_create_settings(db))


async def update_settings(
    db: AsyncSession,
    data: AdSettingsIn,
    actor: User | None = None,
    ip: str | None = None,
) -> AdSettingsOut:
    s = await _get_or_create_settings(db)
    s.swipes_before_ad = data.swipes_before_ad
    s.max_video_seconds = data.max_video_seconds
    s.enabled = data.enabled
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_AD_SETTINGS_UPDATE,
            target_type="ad_settings",
            meta={
                "swipes_before_ad": s.swipes_before_ad,
                "max_video_seconds": s.max_video_seconds,
                "enabled": s.enabled,
            },
            ip=ip,
        )
    await db.commit()
    await db.refresh(s)
    return _to_settings_out(s)


# --------------------------------------------------------------------------- #
# CRUD reclame (admin)
# --------------------------------------------------------------------------- #
async def list_ads(db: AsyncSession) -> list[AdOut]:
    rows = await db.scalars(select(Ad).order_by(Ad.created_at.desc(), Ad.id.desc()))
    return [_to_ad_out(a) for a in rows.all()]


async def create_ad(
    db: AsyncSession, data: AdIn, actor: User | None = None, ip: str | None = None
) -> AdOut:
    ad = Ad(
        title=data.title,
        video_url=data.video_url,
        image_url=data.image_url,
        duration_seconds=data.duration_seconds,
        active=data.active,
        weight=data.weight,
        target_gender=data.target_gender,
        target_age_min=data.target_age_min,
        target_age_max=data.target_age_max,
        starts_at=data.starts_at,
        ends_at=data.ends_at,
    )
    db.add(ad)
    await db.flush()  # obținem ad.id înainte de a scrie auditul
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_AD_CREATE,
            target_type="ad",
            meta={"ad_id": ad.id, "title": ad.title},
            ip=ip,
        )
    await db.commit()
    await db.refresh(ad)
    return _to_ad_out(ad)


async def _get_ad_or_404(db: AsyncSession, ad_id: int) -> Ad:
    ad = await db.get(Ad, ad_id)
    if ad is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ad not found"
        )
    return ad


async def get_ad(db: AsyncSession, ad_id: int) -> AdOut:
    return _to_ad_out(await _get_ad_or_404(db, ad_id))


async def update_ad(
    db: AsyncSession,
    ad_id: int,
    data: AdUpdate,
    actor: User | None = None,
    ip: str | None = None,
) -> AdOut:
    ad = await _get_ad_or_404(db, ad_id)
    changes = data.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Niciun câmp de actualizat.",
        )
    for field, value in changes.items():
        setattr(ad, field, value)
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_AD_UPDATE,
            target_type="ad",
            meta={"ad_id": ad.id, "changed": sorted(changes.keys())},
            ip=ip,
        )
    await db.commit()
    await db.refresh(ad)
    return _to_ad_out(ad)


async def delete_ad(
    db: AsyncSession, ad_id: int, actor: User | None = None, ip: str | None = None
) -> None:
    ad = await _get_ad_or_404(db, ad_id)
    title = ad.title
    if actor is not None:
        audit(
            db,
            actor,
            ACTION_AD_DELETE,
            target_type="ad",
            meta={"ad_id": ad_id, "title": title},
            ip=ip,
        )
    await db.delete(ad)
    await db.commit()


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #
async def get_config(db: AsyncSession) -> AdConfigOut:
    s = await _get_or_create_settings(db)
    return AdConfigOut(
        enabled=s.enabled,
        swipes_before_ad=s.swipes_before_ad,
        max_video_seconds=s.max_video_seconds,
    )


def _pick_weighted(ads: list[Ad]) -> Ad:
    """Alege o reclamă proporțional cu `weight` (uniform dacă toate au weight=1).

    Folosim `secrets` (CSPRNG) — nu ca cerință de securitate, ci ca să evităm
    seed-ul global previzibil al lui `random` în procese de lungă durată.
    """
    total = sum(max(1, a.weight) for a in ads)
    r = secrets.randbelow(total)
    upto = 0
    for a in ads:
        upto += max(1, a.weight)
        if r < upto:
            return a
    return ads[-1]  # fallback teoretic imposibil (r < total)


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _in_schedule(ad: Ad, now: datetime) -> bool:
    """Reclama e în fereastra de difuzare? NULL pe o margine = fără acea limită."""
    if ad.starts_at is not None and now < ad.starts_at:
        return False
    if ad.ends_at is not None and now > ad.ends_at:
        return False
    return True


def _matches_target(ad: Ad, gender: str | None, age: int | None) -> bool:
    """Reclama se potrivește userului (gen + vârstă)?

    REGULI (toate „NULL = fără restricție"):
      * `target_gender` NULL → orice gen; altfel trebuie să fie egal cu genul userului.
      * `target_age_min/max` — vârsta userului trebuie să cadă în interval.

    DECIZIE documentată pentru userii FĂRĂ profil/vârstă (`age is None`): sunt
    EXCLUȘI de la reclamele care au setată vreo margine de vârstă (nu putem
    confirma că se potrivesc). La fel pentru gen: dacă reclama țintește un gen și
    userul n-are gen cunoscut, nu se potrivește.
    """
    if ad.target_gender is not None and ad.target_gender != gender:
        return False
    if ad.target_age_min is not None or ad.target_age_max is not None:
        if age is None:
            return False
        if ad.target_age_min is not None and age < ad.target_age_min:
            return False
        if ad.target_age_max is not None and age > ad.target_age_max:
            return False
    return True


async def get_next(db: AsyncSession, user: User | None = None) -> AdNextOut | None:
    """Alege o reclamă eligibilă la întâmplare (ponderată), cu durata plafonată.

    Eligibilitatea = activă + în fereastra de programare + targetată corect pe
    userul care cere (gen + vârstă din `Profile`). Întoarce `None` dacă sistemul e
    dezactivat global sau dacă după filtrare nu rămâne nicio reclamă — ruta traduce
    asta în `204 No Content`.
    """
    s = await _get_or_create_settings(db)
    if not s.enabled:
        return None

    # Genul + vârsta userului care cere (pentru targetare). Un user fără profil
    # completat rămâne cu gender=None / age=None (vezi `_matches_target`).
    gender: str | None = None
    age: int | None = None
    if user is not None:
        profile = (
            await db.execute(select(Profile).where(Profile.user_id == user.id))
        ).scalar_one_or_none()
        if profile is not None:
            gender = profile.gender
            if profile.birth_date is not None:
                age = _calc_age(profile.birth_date)

    now = datetime.now(timezone.utc)
    rows = await db.scalars(select(Ad).where(Ad.active.is_(True)))
    ads = [
        a
        for a in rows.all()
        if _in_schedule(a, now) and _matches_target(a, gender, age)
    ]
    if not ads:
        return None

    ad = _pick_weighted(ads)
    return AdNextOut(
        id=ad.id,
        title=ad.title,
        video_url=ad.video_url,
        image_url=ad.image_url,
        duration_seconds=min(ad.duration_seconds, s.max_video_seconds),
    )


# --------------------------------------------------------------------------- #
# Tracking — contoare brute (non-idempotente) de afișări / click-uri
# --------------------------------------------------------------------------- #
async def _bump_counter(db: AsyncSession, ad_id: int, column) -> None:
    """Incrementează ATOMIC un contor (`SET col = col + 1`), 404 dacă ad-ul lipsește.

    `UPDATE ... SET col = col + 1` se face în DB, nu prin read-modify-write în
    Python — două cereri concurente nu se pot suprascrie una pe alta.
    """
    result = await db.execute(
        update(Ad).where(Ad.id == ad_id).values({column: column + 1})
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Ad not found"
        )
    await db.commit()


async def track_impression(db: AsyncSession, ad_id: int) -> None:
    """Incrementează `impressions` (afișare). 404 dacă ad-ul nu există."""
    await _bump_counter(db, ad_id, Ad.impressions)


async def track_click(db: AsyncSession, ad_id: int) -> None:
    """Incrementează `clicks` (click). 404 dacă ad-ul nu există."""
    await _bump_counter(db, ad_id, Ad.clicks)
