"""Unit teste pentru account_service — setări, favorite, block, bilet, ștergere."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import AccountDeletionRequest, Block, Favorite
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.user import User
from app.schemas.account import SettingsIn
from app.services import account_service as A

_ADULT_YEAR = date.today().year - 25


async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(db, user, name="Ana", city="Chișinău") -> Profile:
    profile = Profile(
        user_id=user.id, name=name, birth_date=date(_ADULT_YEAR, 1, 1),
        gender="female", height_cm=165, city=city, languages=["ru"],
        dating_statuses=["serious"], photos=[],
    )
    db.add(profile)
    await db.commit()
    return profile


# --- Setări ------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_settings_creates_defaults(db_session):
    user = await _make_user(db_session, "s1@example.com")
    out = await A.get_settings(db_session, user)
    assert out.search_radius_km == settings.search_radius_default_km
    assert out.profile_hidden is False
    # Toate notificările pornite implicit.
    assert all(out.notifications.values())


@pytest.mark.asyncio
async def test_update_settings_partial_merges_notifications(db_session):
    user = await _make_user(db_session, "s2@example.com")
    await A.get_settings(db_session, user)  # creează default

    out = await A.update_settings(
        db_session, user,
        SettingsIn(theme="dark", notifications={"promos": False}),
    )
    assert out.theme == "dark"
    # Flag-ul schimbat e False, restul rămân True (merge, nu înlocuire).
    assert out.notifications["promos"] is False
    assert out.notifications["match"] is True


@pytest.mark.asyncio
async def test_update_settings_other_fields(db_session):
    user = await _make_user(db_session, "s3@example.com")
    out = await A.update_settings(
        db_session, user,
        SettingsIn(search_radius_km=10, profile_hidden=True, region="north"),
    )
    assert out.search_radius_km == 10
    assert out.profile_hidden is True
    assert out.region == "north"


# --- Favorite ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_favorite_add_idempotent(db_session):
    user = await _make_user(db_session, "f1@example.com")
    target = uuid.uuid4()
    await A.add_favorite(db_session, user, target)
    await A.add_favorite(db_session, user, target)  # duplicat → ignorat

    rows = (
        await db_session.execute(
            select(Favorite).where(Favorite.user_id == user.id)
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_favorite_list_includes_profile_data(db_session):
    user = await _make_user(db_session, "f2@example.com")
    target = await _make_user(db_session, "f2t@example.com")
    await _make_profile(db_session, target, name="Diana", city="Bălți")
    await A.add_favorite(db_session, user, target.id)

    # `list_favorites` întoarce acum o PAGINĂ (items + next_cursor), ca `/feed`.
    favs = (await A.list_favorites(db_session, user)).items
    assert len(favs) == 1
    assert favs[0].name == "Diana"
    assert favs[0].city == "Bălți"


@pytest.mark.asyncio
async def test_favorite_list_empty(db_session):
    user = await _make_user(db_session, "f3@example.com")
    assert (await A.list_favorites(db_session, user)).items == []


@pytest.mark.asyncio
async def test_favorite_remove(db_session):
    user = await _make_user(db_session, "f4@example.com")
    target = uuid.uuid4()
    await A.add_favorite(db_session, user, target)
    await A.remove_favorite(db_session, user, target)
    await A.remove_favorite(db_session, user, target)  # no-op a doua oară
    assert (await A.list_favorites(db_session, user)).items == []


# --- Block -------------------------------------------------------------------
@pytest.mark.asyncio
async def test_block_add_idempotent_and_list(db_session):
    user = await _make_user(db_session, "b1@example.com")
    target = await _make_user(db_session, "b1t@example.com")
    await _make_profile(db_session, target, name="Marin")
    await A.add_block(db_session, user, target.id)
    await A.add_block(db_session, user, target.id)  # idempotent

    rows = (
        await db_session.execute(
            select(Block).where(Block.blocker_id == user.id)
        )
    ).scalars().all()
    assert len(rows) == 1

    blocks = (await A.list_blocks(db_session, user)).items
    assert blocks[0].name == "Marin"


@pytest.mark.asyncio
async def test_block_list_empty_and_remove(db_session):
    user = await _make_user(db_session, "b2@example.com")
    assert (await A.list_blocks(db_session, user)).items == []
    target = uuid.uuid4()
    await A.add_block(db_session, user, target)
    await A.remove_block(db_session, user, target)
    await A.remove_block(db_session, user, target)  # no-op
    assert (await A.list_blocks(db_session, user)).items == []


# --- Bilet Flirt Party -------------------------------------------------------
@pytest.mark.asyncio
async def test_ticket_idempotent(db_session):
    user = await _make_user(db_session, "t1@example.com")
    first = await A.get_or_issue_ticket(db_session, user)
    second = await A.get_or_issue_ticket(db_session, user)
    assert first.code == second.code
    assert first.used is False


# --- Ștergere cont -----------------------------------------------------------
@pytest.mark.asyncio
async def test_request_deletion_revokes_sessions_and_hides(db_session):
    user = await _make_user(db_session, "d1@example.com")
    # O sesiune de refresh activă.
    db_session.add(
        RefreshSession(
            user_id=user.id, jti=uuid.uuid4().hex, family_id=uuid.uuid4().hex,
            token_hash="h", revoked=False,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    await db_session.commit()

    out = await A.request_account_deletion(db_session, user)
    assert out.purge_after > out.requested_at

    # Sesiunile sunt revocate.
    sessions = (
        await db_session.execute(
            select(RefreshSession).where(RefreshSession.user_id == user.id)
        )
    ).scalars().all()
    assert all(s.revoked for s in sessions)

    # Profilul e ascuns.
    out_settings = await A.get_settings(db_session, user)
    assert out_settings.profile_hidden is True


@pytest.mark.asyncio
async def test_request_deletion_idempotent(db_session):
    user = await _make_user(db_session, "d2@example.com")
    first = await A.request_account_deletion(db_session, user)
    second = await A.request_account_deletion(db_session, user)
    assert first.requested_at == second.requested_at

    rows = (
        await db_session.execute(
            select(AccountDeletionRequest).where(
                AccountDeletionRequest.user_id == user.id
            )
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_cancel_deletion(db_session):
    user = await _make_user(db_session, "d3@example.com")
    await A.request_account_deletion(db_session, user)
    await A.cancel_account_deletion(db_session, user)
    await A.cancel_account_deletion(db_session, user)  # no-op a doua oară

    rows = (
        await db_session.execute(
            select(AccountDeletionRequest).where(
                AccountDeletionRequest.user_id == user.id
            )
        )
    ).scalars().all()
    assert rows == []
