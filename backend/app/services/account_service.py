"""Logica modulului cont/setări (TZ secț. 6).

Setări, favorite, black list, bilet Flirt Party și ștergerea contului.
Toate valorile implicite provin din config, nimic hardcodat.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import (
    AccountDeletionRequest,
    Block,
    Favorite,
    Ticket,
    UserSettings,
)
from app.models.chat import Chat, Message
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.story import Story
from app.models.swipe import Like, Match
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


# --- Preferințe de căutare (filtrele DURE ale feed-ului) ---------------------
@dataclass(frozen=True)
class SearchPreferences:
    """Preferințele EFECTIVE de căutare ale unui user (default-uri deja aplicate).

    „Efective" = ce aplică feed-ul de fapt: valorile userului dacă există,
    altfel default-urile din config, cu pragul 18+ forțat peste `age_min`.
    Feed-ul primește un obiect gata de folosit, fără să repete regulile.
    """

    interested_in: tuple[str, ...] = ()   # gol = fără restricție de gen
    age_min: int = 0
    age_max: int = 0
    radius_km: int = 0


def _effective_preferences(record: UserSettings | None) -> SearchPreferences:
    """Aplică default-urile din config peste o linie de setări (posibil absentă).

    `age_min` e ridicat SIEMPRE la `settings.adult_age`: aplicația e 18+ only,
    deci nici măcar o linie coruptă din DB nu poate produce un feed cu minori.
    """
    age_min = settings.search_age_min_default
    age_max = settings.search_age_max_default
    radius = settings.search_radius_default_km
    genders: tuple[str, ...] = ()

    if record is not None:
        if record.age_min is not None:
            age_min = record.age_min
        if record.age_max is not None:
            age_max = record.age_max
        radius = record.search_radius_km
        genders = tuple(
            str(g) for g in (record.interested_in or []) if g and str(g).strip()
        )

    # 18+ ONLY: pragul legal bate orice preferință salvată.
    age_min = max(age_min, settings.adult_age)
    # Interval degenerat (age_max < age_min) → îl normalizăm la age_min.
    age_max = max(age_max, age_min)
    return SearchPreferences(
        interested_in=genders,
        age_min=age_min,
        age_max=age_max,
        radius_km=max(0, radius),
    )


async def get_search_preferences(
    db: AsyncSession, user_id: uuid.UUID
) -> SearchPreferences:
    """Preferințele efective de căutare ale unui user, FĂRĂ a-i crea setările.

    Feed-ul e read-only: nu vrem ca o simplă citire de feed să insereze o linie
    de setări. Lipsa liniei ⇒ default-urile din config.
    """
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user_id)
    )
    return _effective_preferences(result.scalar_one_or_none())


def _validate_preferences(data: SettingsIn) -> None:
    """Validează preferințele de căutare trimise de client (422 la eșec).

    Reguli: genuri din catalog, `age_min ≥ adult_age` (18+ only), interval
    coerent, plafoane din config pentru vârstă și rază.
    """
    if data.interested_in is not None:
        # Import lazy: `profile_service` importă `account_service` (evită ciclul).
        from app.services.profile_service import GENDERS

        valid = {g.value for g in GENDERS}
        unknown = [g for g in data.interested_in if g not in valid]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Gen invalid în preferințe. Valori permise: {sorted(valid)}",
            )

    if data.age_min is not None and data.age_min < settings.adult_age:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Vârsta minimă căutată nu poate fi sub {settings.adult_age} ani "
                "(aplicația este 18+)."
            ),
        )
    if data.age_max is not None and data.age_max > settings.search_age_max_limit:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Vârsta maximă căutată nu poate depăși {settings.search_age_max_limit}.",
        )
    if (
        data.age_min is not None
        and data.age_max is not None
        and data.age_min > data.age_max
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Intervalul de vârstă este inversat (min > max).",
        )
    if (
        data.search_radius_km is not None
        and data.search_radius_km > settings.search_radius_max_km
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Raza de căutare nu poate depăși {settings.search_radius_max_km} km.",
        )


# --- Activitate (users.last_active_at) ---------------------------------------
async def touch_last_active(db: AsyncSession, user: User) -> None:
    """Marchează userul ca activ ACUM — scriere RARĂ, cu prag din config.

    Se apelează din cererile autentificate „grele" (feed, swipe, salvare anketă).
    Ca să nu adăugăm un UPDATE la fiecare request, scriem doar dacă au trecut cel
    puțin `settings.last_active_touch_minutes` de la ultima marcare.

    Feed-ul folosește semnalul ca să nu mai promoveze conturile abandonate la
    egalitate cu cele active (vezi `feed_service.get_feed`).
    """
    now = datetime.now(timezone.utc)
    last = user.last_active_at
    if last is not None:
        # DB-urile fără timezone (SQLite) întorc datetime naive → le atașăm UTC.
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if now - last < timedelta(minutes=settings.last_active_touch_minutes):
            return  # prea recent — nu mai scriem

    user.last_active_at = now
    db.add(user)
    await db.commit()


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
    """Actualizează parțial setările (doar câmpurile trimise).

    Preferințele de căutare sunt validate ÎNAINTE de orice scriere (422 la
    genuri necunoscute, vârstă sub pragul 18+, interval inversat, plafoane).
    """
    _validate_preferences(data)
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

    # Preferințe de căutare (filtre dure în feed). Deduplicate, ordine stabilă.
    if data.interested_in is not None:
        record.interested_in = sorted(set(data.interested_in))
    if data.age_min is not None:
        record.age_min = data.age_min
    if data.age_max is not None:
        record.age_max = data.age_max

    # Interval coerent și după un update PARȚIAL (ex. doar `age_min`, peste un
    # `age_max` mai mic salvat anterior).
    effective = _effective_preferences(record)
    record.age_min = effective.age_min
    record.age_max = effective.age_max

    await db.commit()
    await db.refresh(record)
    return _to_settings_out(record)


async def set_search_preferences(
    db: AsyncSession,
    user: User,
    *,
    interested_in: list[str] | None,
    age_min: int | None,
    age_max: int | None,
) -> None:
    """Salvează preferințele de căutare venite din ANKETĂ (fără commit propriu).

    Refolosește exact validarea de la `PUT /settings` (o singură sursă de reguli).
    Commit-ul îl face apelantul (`profile_service.upsert_anketa`), ca anketa și
    preferințele să intre în aceeași tranzacție.
    """
    if interested_in is None and age_min is None and age_max is None:
        return  # nimic de setat — păstrăm ce era (sau default-urile din config)

    _validate_preferences(
        SettingsIn(interested_in=interested_in, age_min=age_min, age_max=age_max)
    )

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

    if interested_in is not None:
        record.interested_in = sorted(set(interested_in))
    if age_min is not None:
        record.age_min = age_min
    if age_max is not None:
        record.age_max = age_max

    effective = _effective_preferences(record)
    record.age_min = effective.age_min
    record.age_max = effective.age_max


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
    # Preferințele sunt expuse cu valorile EFECTIVE (default-urile din config
    # deja aplicate), ca mobilul să afișeze exact ce filtrează feed-ul.
    effective = _effective_preferences(record)
    return SettingsOut(
        theme=record.theme,
        search_radius_km=record.search_radius_km,
        notifications=record.notifications or {},
        profile_hidden=record.profile_hidden,
        region=record.region,
        interested_in=list(effective.interested_in),
        age_min=effective.age_min,
        age_max=effective.age_max,
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
    """Creează (sau întoarce) cererea de ștergere cu perioadă de grație din config.

    Pe lângă cerere (I4): revocă TOATE sesiunile de refresh ale userului și
    ascunde profilul (profile_hidden=True) ca să nu mai apară în feed în timpul
    perioadei de grație.
    """
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

    # I4 — revocă toate sesiunile de refresh ale userului (logout global).
    sessions_result = await db.execute(
        select(RefreshSession).where(
            RefreshSession.user_id == user.id,
            RefreshSession.revoked.is_(False),
        )
    )
    for session_row in sessions_result.scalars().all():
        session_row.revoked = True

    # I4 — ascunde profilul (creează setările implicite dacă lipsesc).
    user_settings = await _get_or_create_settings(db, user)
    user_settings.profile_hidden = True

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


# --- GDPR purge (ștergere/anonimizare la expirarea grației) -------------------
def _anonymized_email(user_id: uuid.UUID) -> str:
    """Email anonim, unic și DETERMINIST per user (idempotent la re-rulare).

    Domeniul `.invalid` (RFC 2606) nu poate fi înregistrat, deci contul devine
    ne-contactabil și ne-autentificabil.
    """
    return f"deleted+{user_id.hex}@deleted.invalid"


async def _purge_user_data(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Șterge/anonimizează TOATE datele personale ale unui user (GDPR).

    Idempotent: apelabil de mai multe ori fără efecte secundare (ștergerile pe
    seturi goale sunt no-op, iar anonimizarea e deterministă).
    """
    # Chat-urile la care userul participă (împreună cu mesajele lor).
    chat_ids = (
        await db.execute(
            select(Chat.id).where(
                or_(Chat.user_a_id == user_id, Chat.user_b_id == user_id)
            )
        )
    ).scalars().all()

    # Mesajele: cele trimise de user + toate cele din chat-urile lui.
    msg_filter = Message.sender_id == user_id
    if chat_ids:
        msg_filter = or_(msg_filter, Message.chat_id.in_(chat_ids))
    await db.execute(delete(Message).where(msg_filter))
    if chat_ids:
        await db.execute(delete(Chat).where(Chat.id.in_(chat_ids)))

    # Profil (inclusiv referințele la poze din câmpul JSON), povești.
    await db.execute(delete(Profile).where(Profile.user_id == user_id))
    await db.execute(delete(Story).where(Story.user_id == user_id))

    # Like-uri și match-uri (oricare direcție).
    await db.execute(
        delete(Like).where(
            or_(Like.from_user_id == user_id, Like.to_user_id == user_id)
        )
    )
    await db.execute(
        delete(Match).where(
            or_(Match.user_a_id == user_id, Match.user_b_id == user_id)
        )
    )

    # Favorite și block-uri care implică userul (oricare rol).
    await db.execute(
        delete(Favorite).where(
            or_(
                Favorite.user_id == user_id,
                Favorite.target_user_id == user_id,
            )
        )
    )
    await db.execute(
        delete(Block).where(
            or_(Block.blocker_id == user_id, Block.blocked_id == user_id)
        )
    )

    # Setări + sesiuni de refresh (logout definitiv).
    await db.execute(delete(UserSettings).where(UserSettings.user_id == user_id))
    await db.execute(
        delete(RefreshSession).where(RefreshSession.user_id == user_id)
    )

    # Anonimizează contul în sine: email unic anonim + hash de parolă invalid.
    # Nu ștergem rândul `users` ca să nu rupem FK-urile păstrate (ex. rapoarte),
    # dar userul devine ne-autentificabil și ne-identificabil.
    user = await db.get(User, user_id)
    if user is not None:
        user.email = _anonymized_email(user_id)
        user.password_hash = ""  # hash invalid → nicio parolă nu se potrivește
        user.profile_completed = False


async def purge_expired_accounts(
    db: AsyncSession, now: datetime | None = None
) -> int:
    """Purjează conturile cu cererea de ștergere expirată (`purge_after < now`).

    Pentru fiecare `AccountDeletionRequest` cu grația expirată, șterge/anonimizează
    datele userului (vezi `_purge_user_data`) și consumă cererea. Întoarce numărul
    de conturi purjate.

    Apelabilă dintr-un cron/script (nu are nevoie de worker real), ex.:

        import asyncio
        from app.db.session import AsyncSessionLocal
        from app.services.account_service import purge_expired_accounts

        async def main():
            async with AsyncSessionLocal() as db:
                n = await purge_expired_accounts(db)
                print(f"Purjate: {n}")

        asyncio.run(main())

    Idempotentă: după purjare cererea e ștearsă, deci re-rularea nu reprocesează.
    """
    now = now or datetime.now(timezone.utc)
    result = await db.execute(
        select(AccountDeletionRequest).where(
            AccountDeletionRequest.purge_after < now
        )
    )
    requests = list(result.scalars().all())
    for request in requests:
        await _purge_user_data(db, request.user_id)
        await db.delete(request)

    if requests:
        await db.commit()
    return len(requests)
