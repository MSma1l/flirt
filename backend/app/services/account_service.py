"""Logica modulului cont/setări (TZ secț. 6).

Setări, favorite, black list, bilet Flirt Party și ștergerea contului.
Toate valorile implicite provin din config, nimic hardcodat.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import (
    AccountDeletionRequest,
    Block,
    Favorite,
    Ticket,
    UserSettings,
)
from app.models.profile import Profile
from app.models.user import User
from app.schemas.account import (
    AccountDeletionOut,
    BlockOut,
    FavoriteOut,
    SettingsIn,
    SettingsOut,
    TicketOut,
)

# Flag-urile de notificări suportate (TZ 6) — implicit toate active.
_NOTIFICATION_FLAGS = ("match", "messages", "ai_hints", "events", "promos")


def _default_notifications() -> dict:
    """Toate notificările pornite implicit."""
    return {flag: True for flag in _NOTIFICATION_FLAGS}


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


# --- Setări ------------------------------------------------------------------
async def get_settings(db: AsyncSession, user: User) -> SettingsOut:
    """Întoarce setările userului, creând valorile implicite dacă lipsesc."""
    record = await _get_or_create_settings(db, user)
    return _to_settings_out(record)


async def update_settings(
    db: AsyncSession, user: User, data: SettingsIn
) -> SettingsOut:
    """Actualizează parțial setările (doar câmpurile trimise)."""
    record = await _get_or_create_settings(db, user)

    if data.theme is not None:
        record.theme = data.theme
    if data.search_radius_km is not None:
        record.search_radius_km = data.search_radius_km
    if data.notifications is not None:
        # Îmbinăm peste valorile existente ca să nu pierdem flag-urile netrimise.
        merged = dict(record.notifications or {})
        merged.update(data.notifications)
        record.notifications = merged
    if data.profile_hidden is not None:
        record.profile_hidden = data.profile_hidden
    if data.region is not None:
        record.region = data.region

    await db.commit()
    await db.refresh(record)
    return _to_settings_out(record)


async def _get_or_create_settings(db: AsyncSession, user: User) -> UserSettings:
    """Găsește setările sau le creează cu valorile implicite din config."""
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        record = UserSettings(
            user_id=user.id,
            search_radius_km=settings.search_radius_default_km,
            notifications=_default_notifications(),
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
    return record


def _to_settings_out(record: UserSettings) -> SettingsOut:
    return SettingsOut(
        theme=record.theme,
        search_radius_km=record.search_radius_km,
        notifications=record.notifications or {},
        profile_hidden=record.profile_hidden,
        region=record.region,
    )


# --- Favorite ----------------------------------------------------------------
async def add_favorite(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Adaugă un favorit (idempotent — nu dublează perechea)."""
    result = await db.execute(
        select(Favorite).where(
            Favorite.user_id == user.id,
            Favorite.target_user_id == target_user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        db.add(Favorite(user_id=user.id, target_user_id=target_user_id))
        await db.commit()


async def remove_favorite(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Scoate un favorit (no-op dacă nu există)."""
    result = await db.execute(
        select(Favorite).where(
            Favorite.user_id == user.id,
            Favorite.target_user_id == target_user_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is not None:
        await db.delete(record)
        await db.commit()


async def list_favorites(db: AsyncSession, user: User) -> list[FavoriteOut]:
    """Favoritele userului, cu datele de profil pentru afișare."""
    result = await db.execute(
        select(Favorite).where(Favorite.user_id == user.id)
    )
    favorites = list(result.scalars().all())
    if not favorites:
        return []

    target_ids = [f.target_user_id for f in favorites]
    profiles_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(target_ids))
    )
    profiles_by_user = {p.user_id: p for p in profiles_result.scalars().all()}

    out: list[FavoriteOut] = []
    for fav in favorites:
        p = profiles_by_user.get(fav.target_user_id)
        out.append(
            FavoriteOut(
                target_user_id=fav.target_user_id,
                name=p.name if p is not None else "",
                age=_calc_age(p.birth_date) if p is not None else 0,
                city=p.city if p is not None else "",
            )
        )
    return out


# --- Black list --------------------------------------------------------------
async def add_block(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Blochează un user (idempotent)."""
    result = await db.execute(
        select(Block).where(
            Block.blocker_id == user.id,
            Block.blocked_id == target_user_id,
        )
    )
    if result.scalar_one_or_none() is None:
        db.add(Block(blocker_id=user.id, blocked_id=target_user_id))
        await db.commit()


async def remove_block(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Deblochează un user (no-op dacă nu era blocat)."""
    result = await db.execute(
        select(Block).where(
            Block.blocker_id == user.id,
            Block.blocked_id == target_user_id,
        )
    )
    record = result.scalar_one_or_none()
    if record is not None:
        await db.delete(record)
        await db.commit()


async def list_blocks(db: AsyncSession, user: User) -> list[BlockOut]:
    """Lista de useri blocați, cu numele pentru afișare."""
    result = await db.execute(
        select(Block).where(Block.blocker_id == user.id)
    )
    blocks = list(result.scalars().all())
    if not blocks:
        return []

    blocked_ids = [b.blocked_id for b in blocks]
    profiles_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(blocked_ids))
    )
    profiles_by_user = {p.user_id: p for p in profiles_result.scalars().all()}

    return [
        BlockOut(
            blocked_id=b.blocked_id,
            name=(
                profiles_by_user[b.blocked_id].name
                if b.blocked_id in profiles_by_user
                else ""
            ),
        )
        for b in blocks
    ]


# --- Bilet Flirt Party -------------------------------------------------------
async def get_or_issue_ticket(db: AsyncSession, user: User) -> TicketOut:
    """Întoarce biletul userului, emițând unul nou (cod unic) dacă lipsește.

    Idempotent: un singur bilet one-time per user.
    """
    result = await db.execute(select(Ticket).where(Ticket.user_id == user.id))
    ticket = result.scalar_one_or_none()
    if ticket is None:
        ticket = Ticket(user_id=user.id, code=uuid.uuid4().hex, used=False)
        db.add(ticket)
        await db.commit()
        await db.refresh(ticket)
    return TicketOut(code=ticket.code, used=ticket.used)


# --- Ștergere cont -----------------------------------------------------------
async def request_account_deletion(
    db: AsyncSession, user: User
) -> AccountDeletionOut:
    """Creează (sau întoarce) cererea de ștergere cu perioadă de grație din config."""
    result = await db.execute(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.user_id == user.id
        )
    )
    request = result.scalar_one_or_none()
    if request is None:
        requested_at = datetime.now(timezone.utc)
        purge_after = requested_at + timedelta(
            days=settings.account_deletion_grace_days
        )
        request = AccountDeletionRequest(
            user_id=user.id,
            requested_at=requested_at,
            purge_after=purge_after,
        )
        db.add(request)
        await db.commit()
        await db.refresh(request)
    return AccountDeletionOut(
        requested_at=request.requested_at, purge_after=request.purge_after
    )


async def cancel_account_deletion(db: AsyncSession, user: User) -> None:
    """Anulează o cerere de ștergere (no-op dacă nu există)."""
    result = await db.execute(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.user_id == user.id
        )
    )
    request = result.scalar_one_or_none()
    if request is not None:
        await db.delete(request)
        await db.commit()
