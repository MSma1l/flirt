"""Unit teste pentru story_service — creare, grupare, expirare, delete 404/403."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.security import hash_password
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import StoryIn
from app.services import story_service as S

_ADULT_YEAR = date.today().year - 25


async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(db, user, name) -> None:
    db.add(
        Profile(
            user_id=user.id, name=name, birth_date=date(_ADULT_YEAR, 1, 1),
            gender="male", height_cm=180, city="Chișinău", languages=["ru"],
            dating_statuses=["serious"], photos=[],
        )
    )
    await db.commit()


async def _make_match(db, a: User, b: User) -> None:
    lo, hi = sorted([a.id, b.id], key=str)
    db.add(Match(user_a_id=lo, user_b_id=hi))
    await db.commit()


@pytest.mark.asyncio
async def test_create_and_list_mine(db_session):
    user = await _make_user(db_session, "st1@example.com")
    out = await S.create_story(
        db_session, user, StoryIn(media_url="https://cdn/x.jpg", caption="Salut")
    )
    assert out.caption == "Salut"
    assert out.expires_at > out.created_at

    mine = await S.list_mine(db_session, user)
    assert len(mine) == 1


@pytest.mark.asyncio
async def test_expired_story_excluded(db_session):
    user = await _make_user(db_session, "st2@example.com")
    db_session.add(
        Story(
            user_id=user.id, media_url="https://cdn/old.jpg",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await db_session.commit()
    assert await S.list_mine(db_session, user) == []
    assert await S.list_active_grouped(db_session, user) == []


@pytest.mark.asyncio
async def test_grouped_shows_self_and_match_only(db_session):
    a = await _make_user(db_session, "sta@example.com")
    b = await _make_user(db_session, "stb@example.com")
    c = await _make_user(db_session, "stc@example.com")
    await _make_profile(db_session, a, "A")
    await _make_profile(db_session, b, "B")
    await _make_profile(db_session, c, "C")
    await _make_match(db_session, a, b)

    await S.create_story(db_session, a, StoryIn(media_url="https://cdn/a.jpg"))
    await S.create_story(db_session, b, StoryIn(media_url="https://cdn/b.jpg"))
    await S.create_story(db_session, c, StoryIn(media_url="https://cdn/c.jpg"))

    grouped = await S.list_active_grouped(db_session, a)
    seen = {g.user_id for g in grouped}
    assert a.id in seen  # proprii
    assert b.id in seen  # match
    assert c.id not in seen  # ne-match ascuns
    # Userul curent primul în ordonare.
    assert grouped[0].user_id == a.id
    # Numele vine din Profile.
    assert next(g for g in grouped if g.user_id == b.id).name == "B"


@pytest.mark.asyncio
async def test_delete_own_story(db_session):
    user = await _make_user(db_session, "st3@example.com")
    out = await S.create_story(db_session, user, StoryIn(media_url="https://cdn/x.jpg"))
    await S.delete_story(db_session, user, out.id)
    assert await S.list_mine(db_session, user) == []


@pytest.mark.asyncio
async def test_delete_missing_story_404(db_session):
    user = await _make_user(db_session, "st4@example.com")
    with pytest.raises(HTTPException) as exc:
        await S.delete_story(db_session, user, uuid.uuid4())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_others_story_403(db_session):
    a = await _make_user(db_session, "st5a@example.com")
    b = await _make_user(db_session, "st5b@example.com")
    out = await S.create_story(db_session, a, StoryIn(media_url="https://cdn/a.jpg"))
    with pytest.raises(HTTPException) as exc:
        await S.delete_story(db_session, b, out.id)
    assert exc.value.status_code == 403
