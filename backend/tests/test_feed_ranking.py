"""Recomandările din feed: potrivire RECIPROCĂ, reciclare cu pauză, ranking.

Regresii pentru „recomandă foarte ciudat":
  * genul / vârsta erau verificate doar din partea MEA — un candidat care nu
    caută genul meu sau vârsta mea apărea oricum (și nu putea deveni match);
  * după epuizarea strict-ului apăreau genuri pe care userul NU le caută;
  * cine a fost raportat de mine revenea la următoarea trecere;
  * un dislike de acum câteva secunde revenea imediat într-o trecere nouă;
  * ordinea era doar procentul rotunjit + user_id: aceeași pentru toată lumea,
    fără activitate recentă, fără apropiere, fără „mi-a dat deja like".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from app.core.config import settings
from app.models.account import UserSettings
from app.models.moderation import Report
from app.models.profile import Profile
from app.models.swipe import Like
from app.models.user import User
from app.services import compatibility as C
from app.services import feed_service as F
from tests.test_feed_fallback import FAR, _age_swipe, _feed, _ids, _me, _person

NEAR_40KM = (47.36, 28.8)  # ~40 km nord de Chișinău — tot în raza de 50 km


async def _settings(db, user: User, **values) -> None:
    db.add(UserSettings(user_id=user.id, search_radius_km=50, **values))
    await db.commit()


async def _set_active(db, user: User, days_ago: float | None) -> None:
    value = None if days_ago is None else datetime.now(timezone.utc) - timedelta(days=days_ago)
    await db.execute(update(User).where(User.id == user.id).values(last_active_at=value))
    await db.commit()


# --------------------------------------------------------------------------- #
# Potrivire RECIPROCĂ (filtre dure)
# --------------------------------------------------------------------------- #
async def test_candidate_not_interested_in_my_gender_is_hidden(db_session):
    me = await _me(db_session)  # bărbat, caut femei
    lesbian = await _person(db_session, "w4w@example.com")
    await _settings(db_session, lesbian, interested_in=["female"])
    open_to_all = await _person(db_session, "all@example.com")
    await _settings(db_session, open_to_all, interested_in=[])
    wants_men = await _person(db_session, "w4m@example.com")
    await _settings(db_session, wants_men, interested_in=["male", "other"])
    no_settings = await _person(db_session, "nos@example.com")

    shown = set(_ids(await _feed(db_session, me)))
    assert lesbian.id not in shown
    assert shown == {open_to_all.id, wants_men.id, no_settings.id}


async def test_my_age_outside_candidate_range_is_hidden(db_session):
    me = await _me(db_session)  # 30 de ani
    young_only = await _person(db_session, "young@example.com")
    await _settings(db_session, young_only, age_min=18, age_max=25)
    older_only = await _person(db_session, "older@example.com")
    await _settings(db_session, older_only, age_min=35, age_max=50)
    fits = await _person(db_session, "fits@example.com")
    await _settings(db_session, fits, age_min=28, age_max=40)
    # Interval inversat (date vechi) ⇒ normalizat la age_min, ca în preferințe.
    inverted = await _person(db_session, "inv@example.com")
    await _settings(db_session, inverted, age_min=30, age_max=20)

    shown = set(_ids(await _feed(db_session, me)))
    assert shown == {fits.id, inverted.id}


async def test_wrong_gender_and_age_never_fill_an_exhausted_feed(db_session):
    me = await _me(db_session)
    man = await _person(db_session, "man@example.com", gender="male")
    old = await _person(db_session, "old@example.com", age=50)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "like")
    cards = await _feed(db_session, me)
    assert man.id not in _ids(cards) and old.id not in _ids(cards)
    assert cards == []


async def test_reported_profile_never_comes_back(db_session):
    me = await _me(db_session)
    reported = await _person(db_session, "rep@example.com")
    other = await _person(db_session, "other@example.com")
    db_session.add(Report(reporter_id=me.id, reported_id=reported.id, category="spam"))
    await db_session.commit()
    assert _ids(await _feed(db_session, me)) == [other.id]

    # Nici într-o trecere nouă (am refuzat-o înainte de raport).
    db_session.add(
        Like(
            from_user_id=me.id,
            to_user_id=reported.id,
            is_like=False,
            created_at=datetime.now(timezone.utc) - timedelta(days=3),
            updated_at=datetime.now(timezone.utc) - timedelta(days=3),
        )
    )
    await db_session.commit()
    await F.swipe(db_session, me, other.id, "dislike")
    await _age_swipe(db_session, me, other, hours=48)
    assert _ids(await _feed(db_session, me)) == [other.id]


# --------------------------------------------------------------------------- #
# Reciclare: dislike-ul nu revine imediat
# --------------------------------------------------------------------------- #
async def test_fresh_dislike_does_not_come_back_immediately(db_session, monkeypatch):
    monkeypatch.setattr(settings, "feed_recycle_cooldown_hours", 24)
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    other = await _person(db_session, "other@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await F.swipe(db_session, me, other.id, "dislike")

    # Toți văzuți, dar refuzați ACUM: fără trecere nouă, ecran gol.
    assert await _feed(db_session, me) == []
    profile = await db_session.scalar(select(Profile).where(Profile.user_id == me.id))
    assert profile.feed_cycle_started_at is None

    # După pauză, revin (trecere nouă), marcați „încă o șansă".
    await _age_swipe(db_session, me, her, hours=25)
    cards = await _feed(db_session, me)
    assert _ids(cards) == [her.id]
    assert cards[0].fallback_tier == "second_chance"

    # Cel refuzat recent revine abia când îi expiră pauza — în aceeași trecere.
    await _age_swipe(db_session, me, other, hours=25)
    assert set(_ids(await _feed(db_session, me))) == {her.id, other.id}


async def test_redislike_in_new_pass_waits_for_cooldown_again(db_session, monkeypatch):
    monkeypatch.setattr(settings, "feed_recycle_cooldown_hours", 24)
    me = await _me(db_session)
    her = await _person(db_session, "her@example.com")
    await F.swipe(db_session, me, her.id, "dislike")
    await _age_swipe(db_session, me, her, hours=30)
    assert _ids(await _feed(db_session, me)) == [her.id]  # trecere nouă
    await F.swipe(db_session, me, her.id, "dislike")
    assert await _feed(db_session, me) == []
    assert await _feed(db_session, me) == []


# --------------------------------------------------------------------------- #
# Ranking
# --------------------------------------------------------------------------- #
async def test_someone_who_liked_me_is_boosted(db_session):
    me = await _me(db_session)
    people = [await _person(db_session, f"p{i}@example.com") for i in range(5)]
    fan = people[-1]
    db_session.add(Like(from_user_id=fan.id, to_user_id=me.id, is_like=True))
    await db_session.commit()
    assert _ids(await _feed(db_session, me))[0] == fan.id


async def test_recently_active_before_dormant(db_session):
    me = await _me(db_session)
    dormant = await _person(db_session, "dormant@example.com")
    active = await _person(db_session, "active@example.com")
    await _set_active(db_session, dormant, days_ago=12)
    await _set_active(db_session, active, days_ago=0)
    assert _ids(await _feed(db_session, me)) == [active.id, dormant.id]


async def test_nearer_before_farther_inside_radius(db_session):
    me = await _me(db_session)
    farther = await _person(db_session, "farther@example.com", where=NEAR_40KM)
    nearer = await _person(db_session, "nearer@example.com")
    cards = await _feed(db_session, me)
    assert _ids(cards) == [nearer.id, farther.id]
    assert all(c.fallback_tier is None for c in cards)


async def test_far_is_relaxed_and_after_strict(db_session):
    me = await _me(db_session)
    far = await _person(db_session, "far@example.com", where=FAR)
    db_session.add(Like(from_user_id=far.id, to_user_id=me.id, is_like=True))
    await db_session.commit()
    near = await _person(db_session, "near@example.com")
    cards = await _feed(db_session, me)
    # Treapta bate ranking-ul: chiar și cu like-ul ei, cea din afara razei e după.
    assert _ids(cards) == [near.id, far.id]
    assert cards[1].fallback_tier == "relaxed" and cards[1].outside_filters


async def test_order_differs_between_viewers_but_is_stable(db_session):
    """Profiluri identice: fiecare privitor le vede în altă ordine (jitter
    determinist), dar același privitor le vede mereu în aceeași ordine."""
    me = await _me(db_session)
    other_viewer = await _person(db_session, "viewer2@example.com", gender="male", age=30)
    await _settings(db_session, other_viewer, interested_in=["female"], age_min=20, age_max=30)
    for i in range(8):
        await _person(db_session, f"same{i}@example.com")

    mine = _ids(await _feed(db_session, me))
    theirs = _ids(await _feed(db_session, other_viewer))
    assert set(mine) == set(theirs) and len(mine) == 8
    assert mine != theirs
    assert _ids(await _feed(db_session, me)) == mine
    # Nu e pur și simplu ordinea după user_id (vechiul tie-break comun).
    assert not (mine == sorted(mine, key=str) and theirs == sorted(theirs, key=str))


# --------------------------------------------------------------------------- #
# Funcțiile pure de ranking
# --------------------------------------------------------------------------- #
def test_rank_score_bounds_and_weights():
    top = C.feed_rank_score(100, proximity=1, activity=1, quality=1, liked_me=True, jitter=0.999)
    low = C.feed_rank_score(0, proximity=0, activity=0, quality=0, liked_me=False, jitter=0)
    assert low == 0 and top <= C.RANK_SCALE
    total = (
        C.RANK_W_COMPAT + C.RANK_W_PROXIMITY + C.RANK_W_ACTIVITY
        + C.RANK_W_QUALITY + C.RANK_W_LIKED_ME + C.RANK_W_JITTER
    )
    assert abs(total - 1.0) < 1e-9
    # Jitter-ul maxim nu poate întoarce o diferență de 7 puncte de compatibilitate.
    base = dict(proximity=0.5, activity=0.5, quality=0.5, liked_me=False)
    assert C.feed_rank_score(60, jitter=0.0, **base) > C.feed_rank_score(53, jitter=0.999, **base)


def test_viewer_jitter_is_deterministic_and_viewer_specific():
    a, b, cand = uuid4(), uuid4(), uuid4()
    assert C.viewer_jitter(a, cand, "x") == C.viewer_jitter(a, cand, "x")
    assert 0.0 <= C.viewer_jitter(a, cand) < 1.0
    values = {C.viewer_jitter(v, cand) for v in (a, b)} | {C.viewer_jitter(a, cand, "pass2")}
    assert len(values) == 3


def test_proximity_and_activity_scores():
    assert C.proximity_score(0, "A", "B") == 1.0
    assert C.proximity_score(50, None, None) == pytest.approx(0.5)
    assert C.proximity_score(500, "A", "A") == 0.0
    assert C.proximity_score(None, " Chișinău ", "chișinău") == C.RANK_PROXIMITY_SAME_CITY
    assert C.proximity_score(None, "Chișinău", "Bălți") == C.RANK_PROXIMITY_UNKNOWN

    now = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
    assert C.activity_score(now - timedelta(hours=5), now) == 1.0
    assert C.activity_score(now - timedelta(days=7), now) == pytest.approx(0.5)
    assert C.activity_score(now - timedelta(days=60), now) == 0.0
    assert C.activity_score(None, now) == C.RANK_ACTIVITY_UNKNOWN


def test_quality_score():
    bare = SimpleNamespace(verified=False, photos=["a", "b"], about="")
    full = SimpleNamespace(verified=True, photos=["a", "b", "c"], about="Salut")
    assert C.quality_score(bare) == 0.0
    assert C.quality_score(full) == 1.0
