"""Unit teste DIRECTE pentru `feed_service`.

Feed-ul e cel mai slab acoperit modul de serviciu la măsurare, fiindcă testele lui
merg prin API. Aici apelăm serviciul direct: helper-ele pure (vârstă/date, cursor,
pereche normalizată), fluxul de swipe→match→undo cu mesaj deferred mascat, controalele
de autorizare (self/incomplet/blocat/ascuns/banat) și limita zilnică non-premium.
"""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import Block, UserSettings
from app.models.chat import Chat, Message
from app.models.swipe import Like, Match
from app.models.user import User
from app.services import feed_service as F
from app.services.humor_service import HUMOR_TYPES

# `asyncio_mode = "auto"` marchează testele `async def`; fără `pytestmark` global,
# ca helper-ele pure SINCRONE de mai jos să nu fie marcate greșit ca asyncio.


# --------------------------------------------------------------------------- #
# Helper-e pure (fără DB)
# --------------------------------------------------------------------------- #
def test_calc_age_boundaries():
    today = date(2026, 7, 24)
    assert F._calc_age(date(2000, 7, 24), today) == 26  # exact azi
    assert F._calc_age(date(2000, 7, 25), today) == 25  # mâine împlinește


def test_shift_years_leap_day():
    # 29 feb într-un an nebisect → 28 feb.
    assert F._shift_years(date(2024, 2, 29), 1) == date(2023, 2, 28)
    assert F._shift_years(date(2020, 6, 15), 5) == date(2015, 6, 15)


def test_birth_date_bounds():
    today = date(2026, 1, 1)
    earliest, latest = F._birth_date_bounds(18, 30, today)
    # latest = azi - 18 ani; earliest = azi - 31 ani + 1 zi.
    assert latest == date(2008, 1, 1)
    assert earliest == date(1995, 1, 2)


def test_normalized_pair_is_order_independent():
    a, b = uuid.uuid4(), uuid.uuid4()
    assert F._normalized_pair(a, b) == F._normalized_pair(b, a)


def test_sort_key_orders_by_score_desc():
    uid = uuid.uuid4()
    assert F._sort_key(90, uid)[0] == -90
    assert F._sort_key(90, uid)[1] == str(uid)


def test_cursor_round_trip():
    uid = uuid.uuid4()
    cur = F._encode_cursor(85, uid)
    score, user_id_str = F._decode_cursor(cur)
    assert score == 85
    assert user_id_str == str(uid)


def test_decode_cursor_invalid_422():
    with pytest.raises(HTTPException) as exc:
        F._decode_cursor("!!!not-base64!!!")
    assert exc.value.status_code == 422


async def test_interests_by_profile_empty():
    # Lista goală → dict gol, fără query.
    assert await F._interests_by_profile(None, []) == {}  # type: ignore[arg-type]


# --------------------------------------------------------------------------- #
# Fixturi de profil complet
# --------------------------------------------------------------------------- #
async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _complete_profile(db, user, *, gender="female", age=28, name="Ana"):
    from app.models.profile import Profile

    profile = Profile(
        user_id=user.id,
        name=name,
        birth_date=date(date.today().year - age, 1, 1),
        gender=gender,
        height_cm=170,
        city="Chișinău",
        lat=47.0,
        lng=28.8,
        languages=["ro"],
        dating_statuses=["serious"],
        # Exact pragul din config: cu o singură poză, profilul ar fi sub
        # `min_photos` și n-ar mai fi vizibil în feed (vezi `_min_photos_clause`).
        photos=[
            f"https://cdn.flirt.local/p{i}.jpg" for i in range(settings.min_photos)
        ],
        # Testul de umor e obligatoriu SERVER-SIDE la swipe (`_authorize_swipe`):
        # un profil „complet" (anketă + poze) fără `humor_vector` non-gol nu poate
        # da swipe. Vector uniform pe cele 7 tipuri — orice non-gol trece gate-ul.
        humor_vector={t: 1.0 / len(HUMOR_TYPES) for t in HUMOR_TYPES},
        completed=True,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


async def _pair(db, prefix):
    a = await _make_user(db, f"{prefix}_a@example.com")
    b = await _make_user(db, f"{prefix}_b@example.com")
    await _complete_profile(db, a, gender="male", name="Andrei")
    await _complete_profile(db, b, gender="female", name="Bianca")
    return a, b


# --------------------------------------------------------------------------- #
# swipe: dislike / like fără reciprocitate / match reciproc
# --------------------------------------------------------------------------- #
async def test_swipe_dislike_no_match(db_session):
    a, b = await _pair(db_session, "dislike")
    res = await F.swipe(db_session, a, b.id, "dislike")
    assert res.matched is False
    assert res.match_id is None
    # Like-ul e persistat cu is_like=False.
    like = await db_session.scalar(
        select(Like).where(Like.from_user_id == a.id, Like.to_user_id == b.id)
    )
    assert like is not None and like.is_like is False


async def test_swipe_like_without_reciprocal_no_match(db_session):
    a, b = await _pair(db_session, "onelike")
    res = await F.swipe(db_session, a, b.id, "like")
    assert res.matched is False


async def test_swipe_reciprocal_creates_match_and_chat(db_session):
    a, b = await _pair(db_session, "match")
    await F.swipe(db_session, a, b.id, "like")
    res = await F.swipe(db_session, b, a.id, "super_like")
    assert res.matched is True
    assert res.match_id is not None
    assert res.chat_id is not None
    # Super like a fost înregistrat ca is_super.
    like = await db_session.scalar(
        select(Like).where(Like.from_user_id == b.id, Like.to_user_id == a.id)
    )
    assert like.is_super is True


async def test_swipe_deferred_message_delivered_and_masked(db_session):
    a, b = await _pair(db_session, "deferred")
    # Mesaj deferred cu un număr de telefon → trebuie mascat la livrare.
    await F.swipe(db_session, a, b.id, "like", message="Sună-mă la 069123456 te rog")
    res = await F.swipe(db_session, b, a.id, "like")
    assert res.matched is True

    msgs = (
        await db_session.scalars(
            select(Message).where(Message.chat_id == res.chat_id)
        )
    ).all()
    assert len(msgs) == 1
    assert msgs[0].was_masked is True
    assert "069123456" not in msgs[0].body
    # Textul deferred a fost consumat (golit) după livrare.
    like = await db_session.scalar(
        select(Like).where(Like.from_user_id == a.id, Like.to_user_id == b.id)
    )
    assert like.deferred_message is None


async def test_swipe_reswipe_upserts_flag(db_session):
    a, b = await _pair(db_session, "reswipe")
    await F.swipe(db_session, a, b.id, "like")
    # Re-swipe like → super_like ridică flagul; nu creează un al doilea rând.
    await F.swipe(db_session, a, b.id, "super_like")
    likes = (
        await db_session.scalars(
            select(Like).where(Like.from_user_id == a.id, Like.to_user_id == b.id)
        )
    ).all()
    assert len(likes) == 1
    assert likes[0].is_super is True


# --------------------------------------------------------------------------- #
# undo + get_matches
# --------------------------------------------------------------------------- #
async def test_undo_last_swipe_removes_match_and_chat(db_session):
    a, b = await _pair(db_session, "undo")
    await F.swipe(db_session, a, b.id, "like")
    res = await F.swipe(db_session, b, a.id, "like")
    assert res.matched is True

    undo = await F.undo_last_swipe(db_session, b)
    assert undo.undone is True
    assert undo.target_user_id == a.id
    # Match + chat demontate.
    assert (await db_session.scalars(select(Match))).all() == []
    assert (await db_session.scalars(select(Chat))).all() == []


async def test_undo_without_any_swipe(db_session):
    a = await _make_user(db_session, "undo_none@example.com")
    undo = await F.undo_last_swipe(db_session, a)
    assert undo.undone is False
    assert undo.target_user_id is None


async def test_get_matches_returns_other_profile(db_session):
    a, b = await _pair(db_session, "getmatch")
    await F.swipe(db_session, a, b.id, "like")
    await F.swipe(db_session, b, a.id, "like")

    matches_a = await F.get_matches(db_session, a)
    assert len(matches_a) == 1
    assert matches_a[0].user_id == b.id
    assert matches_a[0].name == "Bianca"


async def test_get_matches_empty(db_session):
    a = await _make_user(db_session, "nomatches@example.com")
    assert await F.get_matches(db_session, a) == []


# --------------------------------------------------------------------------- #
# Autorizare swipe (breșe critice)
# --------------------------------------------------------------------------- #
async def test_swipe_self_forbidden_403(db_session):
    a, _ = await _pair(db_session, "self")
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, a.id, "like")
    assert exc.value.status_code == 403


async def test_swipe_without_humor_403_distinct_detail(db_session):
    """Acting user fără `humor_vector` → 403 cu mesajul DISTINCT de umor.

    Gate SERVER-SIDE pe acțiune (`_authorize_swipe`), DOAR pe cel care acționează.
    """
    a = await _make_user(db_session, "no_humor_a@example.com")
    b = await _make_user(db_session, "no_humor_b@example.com")
    pa = await _complete_profile(db_session, a, gender="male", name="Fara")
    await _complete_profile(db_session, b, gender="female", name="Cu")
    # Golim umorul actorului: „complet" (anketă+poze) dar fără testul de umor.
    pa.humor_vector = None
    await db_session.commit()

    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 403
    assert exc.value.detail == F.HUMOR_REQUIRED_DETAIL


async def test_swipe_target_without_humor_allowed(db_session):
    """Ținta fără umor NU e blocată — umorul contează doar la scor pentru ea."""
    a, b = await _pair(db_session, "target_no_humor")
    # Doar ținta pierde umorul; actorul îl are (din `_complete_profile`).
    from app.models.profile import Profile

    pb = (
        await db_session.execute(select(Profile).where(Profile.user_id == b.id))
    ).scalar_one()
    pb.humor_vector = {}
    await db_session.commit()

    result = await F.swipe(db_session, a, b.id, "like")
    assert result.matched is False


async def test_swipe_incomplete_own_profile_403(db_session):
    a = await _make_user(db_session, "incomplete@example.com")  # fără profil
    b = await _make_user(db_session, "incomplete_target@example.com")
    await _complete_profile(db_session, b)
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 403


async def test_swipe_missing_target_404(db_session):
    a = await _make_user(db_session, "authz_a@example.com")
    await _complete_profile(db_session, a, gender="male")
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, uuid.uuid4(), "like")
    assert exc.value.status_code == 404


async def test_swipe_blocked_403(db_session):
    a, b = await _pair(db_session, "blocked")
    db_session.add(Block(blocker_id=a.id, blocked_id=b.id))
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 403


async def test_swipe_hidden_target_404(db_session):
    a, b = await _pair(db_session, "hidden")
    db_session.add(
        UserSettings(user_id=b.id, search_radius_km=50, profile_hidden=True)
    )
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 404


async def test_swipe_banned_target_404(db_session):
    from datetime import datetime, timezone

    a, b = await _pair(db_session, "banned")
    b.banned_at = datetime.now(timezone.utc)
    await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Limita zilnică (non-premium)
# --------------------------------------------------------------------------- #
async def test_daily_swipe_limit_429(db_session, monkeypatch):
    # Prag 0 → primul swipe NOU depășește limita pentru un user non-premium.
    monkeypatch.setattr(F.settings, "free_daily_swipe_limit", 0)
    a, b = await _pair(db_session, "limit")
    with pytest.raises(HTTPException) as exc:
        await F.swipe(db_session, a, b.id, "like")
    assert exc.value.status_code == 429
