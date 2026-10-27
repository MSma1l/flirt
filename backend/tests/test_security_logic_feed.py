"""Securitate (logică de business) în feed / profil:

* limita zilnică de swipe nu mai poate fi ocolită prin cereri PARALELE;
* bucla like → match → undo → like nu mai retrimite notificări de match;
* coordonatele persistate sunt aproximate (grilă ~1 km + decalaj stabil per user),
  iar schimbările de locație sunt limitate per user.
"""
from __future__ import annotations

import asyncio
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core import ratelimit
from app.db.session import AsyncSessionLocal
from app.models.profile import Profile
from app.models.swipe import Like
from app.models.user import User
from app.services import feed_service as F
from app.services import geo, profile_service, tg_notify
from app.services.profile_service import COORD_GRID_DEG, COORD_OFFSET_MAX_DEG, coarse_coords
from tests.test_feed_service_unit import _complete_profile, _make_user

API = "/api/v1"


# --------------------------------------------------------------------------- #
# 5. Limita zilnică de swipe — cursa count-then-insert
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_parallel_swipes_cannot_exceed_daily_limit(db_session, monkeypatch):
    limit = 2
    monkeypatch.setattr(F.settings, "free_daily_swipe_limit", limit)
    me = await _make_user(db_session, "racer@example.com")
    await _complete_profile(db_session, me, gender="male", name="Racer")
    targets = []
    for i in range(6):
        t = await _make_user(db_session, f"race-t{i}@example.com")
        await _complete_profile(db_session, t, gender="female", name=f"T{i}")
        targets.append(t.id)

    async def one(target_id):
        async with AsyncSessionLocal() as s:
            user = await s.get(User, me.id)
            return await F.swipe(s, user, target_id, "dislike")

    results = await asyncio.gather(*(one(t) for t in targets), return_exceptions=True)

    used = await db_session.scalar(
        select(func.count()).select_from(Like).where(Like.from_user_id == me.id)
    )
    assert used == limit, results
    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(refused) == len(targets) - limit
    assert all(r.status_code == 429 for r in refused)


# --------------------------------------------------------------------------- #
# 9. Notificarea de match — throttle per pereche
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_match_undo_like_loop_notifies_once(db_session, monkeypatch):
    a = await _make_user(db_session, "loop-a@example.com")
    b = await _make_user(db_session, "loop-b@example.com")
    await _complete_profile(db_session, a, gender="male", name="A")
    await _complete_profile(db_session, b, gender="female", name="B")

    pushes: list = []
    tg: list = []

    async def fake_notify(db, other_user_id):
        pushes.append(other_user_id)

    monkeypatch.setattr(F, "_notify_match", fake_notify)
    monkeypatch.setattr(tg_notify, "notify_match", lambda **kw: tg.append(kw))

    await F.swipe(db_session, a, b.id, "like")
    for _ in range(4):
        result = await F.swipe(db_session, b, a.id, "like")
        assert result.matched is True
        undone = await F.undo_last_swipe(db_session, b)
        assert undone.undone is True

    assert pushes == [a.id], "O singură notificare de match per pereche în fereastră."
    assert len(tg) == 1


@pytest.mark.asyncio
async def test_distinct_pairs_still_get_their_match_notification(db_session, monkeypatch):
    a = await _make_user(db_session, "pair-a@example.com")
    b = await _make_user(db_session, "pair-b@example.com")
    c = await _make_user(db_session, "pair-c@example.com")
    await _complete_profile(db_session, a, gender="male", name="A")
    await _complete_profile(db_session, b, gender="female", name="B")
    await _complete_profile(db_session, c, gender="female", name="C")
    pushes: list = []

    async def fake_notify(db, other_user_id):
        pushes.append(other_user_id)

    monkeypatch.setattr(F, "_notify_match", fake_notify)
    monkeypatch.setattr(tg_notify, "notify_match", lambda **kw: None)

    await F.swipe(db_session, a, b.id, "like")
    await F.swipe(db_session, a, c.id, "like")
    await F.swipe(db_session, b, a.id, "like")
    await F.swipe(db_session, c, a.id, "like")
    assert pushes == [a.id, a.id]


# --------------------------------------------------------------------------- #
# 8. Locația: coordonate aproximate + limită de schimbări
# --------------------------------------------------------------------------- #
def test_coarse_coords_snaps_to_grid_with_stable_offset():
    uid = "11111111-1111-1111-1111-111111111111"
    lat, lng = 47.012345, 28.861234
    out = coarse_coords(uid, lat, lng)
    # Stabil (aceeași valoare la fiecare salvare) și departe de cifrele exacte.
    assert coarse_coords(uid, lat, lng) == out
    assert out != (round(lat, 5), round(lng, 5))
    max_err = COORD_GRID_DEG / 2 + COORD_OFFSET_MAX_DEG + 1e-9
    assert abs(out[0] - lat) <= max_err and abs(out[1] - lng) <= max_err
    # Două străzi din aceeași celulă de ~1 km → exact același punct persistat:
    # mutarea în interiorul celulei nu dezvăluie nimic.
    assert coarse_coords(uid, 47.0141, 28.8589) == coarse_coords(uid, 47.0102, 28.8635)
    # Decalajul diferă între useri (grila nu e aliniată identic pentru toți).
    other = coarse_coords("22222222-2222-2222-2222-222222222222", lat, lng)
    assert other != out


def _anketa(city: str, street: str | None = None) -> dict:
    return {
        "name": "Loc",
        "birth_date": date(date.today().year - 25, 1, 1).isoformat(),
        "gender": "female",
        "height_cm": 165,
        "city": city,
        "street": street,
        "nationality": "Moldoveancă",
        "languages": ["ro"],
        "about": None,
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": [],
    }


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Passw0rd!"}
    )
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


@pytest.mark.asyncio
async def test_saved_profile_coordinates_are_coarse(client, db_session, monkeypatch):
    exact = (47.012345, 28.861234)

    async def fake_geocode(city, street=None):
        return exact

    monkeypatch.setattr(geo, "geocode_cached", fake_geocode)
    headers = await _register(client, "coords@example.com")
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa("Chișinău", "Str. Exactă 12"), headers=headers
    )
    assert resp.status_code == 200, resp.text

    user = (
        await db_session.execute(select(User).where(User.email == "coords@example.com"))
    ).scalar_one()
    profile = (
        await db_session.execute(select(Profile).where(Profile.user_id == user.id))
    ).scalar_one()
    assert (profile.lat, profile.lng) == coarse_coords(user.id, *exact)
    assert (profile.lat, profile.lng) != exact


@pytest.mark.asyncio
async def test_location_changes_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(profile_service, "LOCATION_CHANGES_PER_DAY_DEFAULT", 2)
    headers = await _register(client, "mover@example.com")

    ratelimit.enable_for_tests()
    try:
        codes = []
        # Prima setare (profil nou) nu consumă din cotă.
        for city in ["Chișinău", "Bălți", "Cahul", "Orhei"]:
            r = await client.put(f"{API}/profiles/me", json=_anketa(city), headers=headers)
            codes.append(r.status_code)
        # O salvare FĂRĂ schimbare de locație trece oricând.
        same = await client.put(f"{API}/profiles/me", json=_anketa("Cahul"), headers=headers)
    finally:
        ratelimit.disable_for_tests()

    assert codes == [200, 200, 200, 429], codes
    assert same.status_code == 200, same.text
