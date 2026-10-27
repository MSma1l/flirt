"""Securitate (logică de business): blocul / moderarea opresc și FAVORITELE.

Înainte: `list_favorites` întorcea nume/vârstă/oraș/poze curente pentru ținte
care m-au blocat, banate, ascunse sau șterse; `add_favorite` verifica doar
existența; blocul nu atingea favoritele.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import hash_password
from app.models.account import Block, Favorite, UserSettings
from app.models.chat import Chat
from app.models.profile import Profile
from app.models.swipe import Match
from app.models.user import User
from app.services import account_service as A


async def _user(db, email: str, name: str = "Ana") -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    db.add(
        Profile(
            user_id=user.id, name=name, birth_date=date(date.today().year - 25, 1, 1),
            gender="female", height_cm=165, city="Chișinău", languages=["ro"],
            dating_statuses=["serious"], photos=["https://cdn.flirt.local/p.jpg"],
        )
    )
    await db.commit()
    return user


async def _fav_ids(db, user: User) -> set:
    return {f.target_user_id for f in (await A.list_favorites(db, user)).items}


@pytest.mark.asyncio
async def test_list_favorites_hides_blocked_both_directions(db_session):
    me = await _user(db_session, "me1@example.com")
    blocked_by_me = await _user(db_session, "bm@example.com")
    blocks_me = await _user(db_session, "bme@example.com")
    ok = await _user(db_session, "ok1@example.com")
    for t in (blocked_by_me, blocks_me, ok):
        db_session.add(Favorite(user_id=me.id, target_user_id=t.id))
    db_session.add(Block(blocker_id=me.id, blocked_id=blocked_by_me.id))
    db_session.add(Block(blocker_id=blocks_me.id, blocked_id=me.id))
    await db_session.commit()

    assert await _fav_ids(db_session, me) == {ok.id}


@pytest.mark.asyncio
async def test_list_favorites_hides_banned_deleted_hidden(db_session):
    me = await _user(db_session, "me2@example.com")
    banned = await _user(db_session, "banned@example.com")
    deleted = await _user(db_session, "deleted@example.com")
    hidden = await _user(db_session, "hidden@example.com")
    ok = await _user(db_session, "ok2@example.com")
    for t in (banned, deleted, hidden, ok):
        db_session.add(Favorite(user_id=me.id, target_user_id=t.id))
    now = datetime.now(timezone.utc)
    banned.banned_at = now
    deleted.deleted_at = now
    db_session.add(
        UserSettings(user_id=hidden.id, search_radius_km=50, notifications={}, profile_hidden=True)
    )
    await db_session.commit()

    assert await _fav_ids(db_session, me) == {ok.id}


@pytest.mark.asyncio
async def test_list_favorites_pagination_skips_filtered_rows(db_session):
    """Filtrul e în SQL (înainte de LIMIT): o pagină nu iese goală/scurtă din cauza
    rândurilor ascunse, iar cursorul parcurge doar favoritele vizibile."""
    me = await _user(db_session, "me3@example.com")
    visible = []
    for i in range(6):
        t = await _user(db_session, f"pg{i}@example.com")
        db_session.add(Favorite(user_id=me.id, target_user_id=t.id))
        if i % 2:
            db_session.add(Block(blocker_id=t.id, blocked_id=me.id))
        else:
            visible.append(t.id)
    await db_session.commit()

    seen, cursor = [], None
    for _ in range(5):
        page = await A.list_favorites(db_session, me, limit=2, cursor=cursor)
        seen.extend(f.target_user_id for f in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break
    assert sorted(seen, key=str) == sorted(visible, key=str)


@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["i_blocked", "they_blocked"])
async def test_add_favorite_refused_when_blocked(db_session, direction):
    me = await _user(db_session, f"me4{direction}@example.com")
    other = await _user(db_session, f"o4{direction}@example.com")
    if direction == "i_blocked":
        db_session.add(Block(blocker_id=me.id, blocked_id=other.id))
    else:
        db_session.add(Block(blocker_id=other.id, blocked_id=me.id))
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await A.add_favorite(db_session, me, other.id)
    assert exc.value.status_code == 403
    rows = (await db_session.execute(select(Favorite))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["banned", "hidden"])
async def test_add_favorite_unavailable_target_is_404(db_session, state):
    me = await _user(db_session, f"me5{state}@example.com")
    other = await _user(db_session, f"o5{state}@example.com")
    if state == "banned":
        other.banned_at = datetime.now(timezone.utc)
    else:
        db_session.add(
            UserSettings(user_id=other.id, search_radius_km=50, notifications={}, profile_hidden=True)
        )
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await A.add_favorite(db_session, me, other.id)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_block_removes_favorites_both_ways_but_keeps_match_and_chat(db_session):
    me = await _user(db_session, "me6@example.com")
    other = await _user(db_session, "o6@example.com")
    bystander = await _user(db_session, "by6@example.com")
    db_session.add(Favorite(user_id=me.id, target_user_id=other.id))
    db_session.add(Favorite(user_id=other.id, target_user_id=me.id))
    db_session.add(Favorite(user_id=me.id, target_user_id=bystander.id))
    a, b = sorted([me.id, other.id], key=str)
    match = Match(user_a_id=a, user_b_id=b)
    db_session.add(match)
    await db_session.flush()
    db_session.add(Chat(match_id=match.id, user_a_id=a, user_b_id=b))
    await db_session.commit()

    await A.add_block(db_session, me, other.id)

    favs = {
        (f.user_id, f.target_user_id)
        for f in (await db_session.execute(select(Favorite))).scalars()
    }
    assert favs == {(me.id, bystander.id)}
    # Match + chat rămân (conversație read-only cât timp există blocul).
    assert (await db_session.execute(select(Match))).scalars().all()
    assert (await db_session.execute(select(Chat))).scalars().all()

    # După deblocare, favoritul NU reapare de la sine.
    await A.remove_block(db_session, me, other.id)
    assert other.id not in await _fav_ids(db_session, me)
