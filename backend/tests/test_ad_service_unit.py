"""Unit teste DIRECTE pentru `ad_service` — apelează serviciul, nu API-ul.

DE CE DIRECT (nu prin HTTP): coverage-ul se măsoară pe modulul serviciului. Testele
funcționale din `test_ads.py` trec prin app și acoperă comportamentul, dar apelul
direct al funcțiilor de serviciu e ce înregistrează liniile ca acoperite (aceeași
convenție ca `test_event_service_unit.py`). Aici țintim ramurile de CRUD admin,
audit, settings singleton, targetare, programare, rotație și tracking.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.core.security import hash_password
from app.models.ad import Ad, AdSettings
from app.models.admin import (
    ACTION_AD_CREATE,
    ACTION_AD_DELETE,
    ACTION_AD_SETTINGS_UPDATE,
    ACTION_AD_UPDATE,
    AdminAuditLog,
)
from app.models.profile import Profile
from app.models.user import ROLE_ADMIN, User
from app.schemas.ad import AdIn, AdSettingsIn, AdUpdate
from app.services import ad_service as A

# NB: `asyncio_mode = "auto"` (pyproject) marchează automat testele `async def`; nu
# punem un `pytestmark` global, ca testele SINCRONE de helper să nu fie marcate greșit.


async def _make_user(db, email, *, admin=False) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    if admin:
        user.role = ROLE_ADMIN
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(db, user, *, gender, age) -> Profile:
    profile = Profile(
        user_id=user.id,
        name="Tester",
        birth_date=date(date.today().year - age, 1, 1),
        gender=gender,
        height_cm=175,
        city="Chișinău",
        languages=["ro"],
        dating_statuses=["serious"],
        photos=["https://cdn.flirt.local/p1.jpg"],
        completed=True,
    )
    db.add(profile)
    await db.commit()
    return profile


async def _count_audit(db, action) -> int:
    return await db.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == action
        )
    )


def _ad_in(**over) -> AdIn:
    base = dict(
        title="Buy our thing",
        video_url="https://cdn.flirt.local/ad.mp4",
        image_url="https://cdn.flirt.local/ad.jpg",
        duration_seconds=30,
        active=True,
        weight=1,
    )
    base.update(over)
    return AdIn(**base)


# --------------------------------------------------------------------------- #
# Settings singleton (creare leneșă + update cu audit)
# --------------------------------------------------------------------------- #
async def test_get_settings_creates_singleton_with_defaults(db_session):
    out = await A.get_settings(db_session)
    assert out.swipes_before_ad == A.DEFAULT_SWIPES_BEFORE_AD
    assert out.max_video_seconds == A.DEFAULT_MAX_VIDEO_SECONDS
    assert out.enabled is True

    # Al doilea apel NU creează un al doilea rând (rămâne singleton id=1).
    await A.get_settings(db_session)
    count = await db_session.scalar(
        select(func.count()).select_from(AdSettings)
    )
    assert count == 1


async def test_update_settings_writes_audit_when_actor(db_session):
    admin = await _make_user(db_session, "ad_settings_actor@example.com", admin=True)
    out = await A.update_settings(
        db_session,
        AdSettingsIn(swipes_before_ad=7, max_video_seconds=5, enabled=False),
        actor=admin,
        ip="1.2.3.4",
    )
    assert out.swipes_before_ad == 7
    assert out.max_video_seconds == 5
    assert out.enabled is False
    assert await _count_audit(db_session, ACTION_AD_SETTINGS_UPDATE) == 1


async def test_update_settings_no_audit_without_actor(db_session):
    await A.update_settings(
        db_session, AdSettingsIn(swipes_before_ad=9, max_video_seconds=8, enabled=True)
    )
    assert await _count_audit(db_session, ACTION_AD_SETTINGS_UPDATE) == 0


async def test_get_config_reflects_settings(db_session):
    await A.update_settings(
        db_session, AdSettingsIn(swipes_before_ad=20, max_video_seconds=12, enabled=True)
    )
    cfg = await A.get_config(db_session)
    assert cfg.enabled is True
    assert cfg.swipes_before_ad == 20
    assert cfg.max_video_seconds == 12


# --------------------------------------------------------------------------- #
# CRUD reclame
# --------------------------------------------------------------------------- #
async def test_create_ad_with_actor_writes_audit(db_session):
    admin = await _make_user(db_session, "ad_create_actor@example.com", admin=True)
    out = await A.create_ad(db_session, _ad_in(title="Promo"), actor=admin, ip="9.9.9.9")
    assert out.id > 0
    assert out.title == "Promo"
    assert out.impressions == 0 and out.clicks == 0
    assert await _count_audit(db_session, ACTION_AD_CREATE) == 1


async def test_create_ad_without_actor_no_audit(db_session):
    out = await A.create_ad(db_session, _ad_in())
    assert out.id > 0
    assert await _count_audit(db_session, ACTION_AD_CREATE) == 0


async def test_list_ads_newest_first(db_session):
    a1 = await A.create_ad(db_session, _ad_in(title="First"))
    a2 = await A.create_ad(db_session, _ad_in(title="Second"))
    rows = await A.list_ads(db_session)
    # created_at desc, id desc → cel mai nou (a2) primul.
    assert [r.id for r in rows][:2] == [a2.id, a1.id]


async def test_get_ad_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await A.get_ad(db_session, 999999)
    assert exc.value.status_code == 404


async def test_update_ad_partial_with_actor(db_session):
    admin = await _make_user(db_session, "ad_update_actor@example.com", admin=True)
    ad = await A.create_ad(db_session, _ad_in(title="Old", weight=1))
    out = await A.update_ad(
        db_session, ad.id, AdUpdate(title="New", weight=5), actor=admin, ip="8.8.8.8"
    )
    assert out.title == "New"
    assert out.weight == 5
    # video_url neatins (nu a fost trimis).
    assert out.video_url == "https://cdn.flirt.local/ad.mp4"
    assert await _count_audit(db_session, ACTION_AD_UPDATE) == 1


async def test_update_ad_empty_payload_422(db_session):
    ad = await A.create_ad(db_session, _ad_in())
    with pytest.raises(HTTPException) as exc:
        await A.update_ad(db_session, ad.id, AdUpdate())
    assert exc.value.status_code == 422


async def test_update_ad_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await A.update_ad(db_session, 999999, AdUpdate(title="x"))
    assert exc.value.status_code == 404


async def test_delete_ad_with_actor_writes_audit(db_session):
    admin = await _make_user(db_session, "ad_delete_actor@example.com", admin=True)
    ad = await A.create_ad(db_session, _ad_in())
    await A.delete_ad(db_session, ad.id, actor=admin, ip="7.7.7.7")
    assert await db_session.get(Ad, ad.id) is None
    assert await _count_audit(db_session, ACTION_AD_DELETE) == 1


async def test_delete_ad_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await A.delete_ad(db_session, 999999)
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# get_next — targetare, programare, dezactivare
# --------------------------------------------------------------------------- #
async def test_get_next_none_when_disabled(db_session):
    await A.update_settings(
        db_session, AdSettingsIn(swipes_before_ad=15, max_video_seconds=10, enabled=False)
    )
    await A.create_ad(db_session, _ad_in())
    user = await _make_user(db_session, "ad_next_off@example.com")
    assert await A.get_next(db_session, user) is None


async def test_get_next_none_when_no_ads(db_session):
    user = await _make_user(db_session, "ad_next_empty@example.com")
    assert await A.get_next(db_session, user) is None


async def test_get_next_caps_duration_and_returns_ad(db_session):
    await A.create_ad(db_session, _ad_in(duration_seconds=30))
    user = await _make_user(db_session, "ad_next_cap@example.com")
    out = await A.get_next(db_session, user)
    assert out is not None
    assert out.duration_seconds == 10  # min(30, max_video_seconds=10)


async def test_get_next_uses_profile_gender_and_age(db_session):
    # Reclamă țintită pe femei 25-35.
    await A.create_ad(
        db_session,
        _ad_in(target_gender="female", target_age_min=25, target_age_max=35),
    )
    male = await _make_user(db_session, "ad_next_male@example.com")
    await _make_profile(db_session, male, gender="male", age=30)
    # Gen greșit → nicio reclamă.
    assert await A.get_next(db_session, male) is None

    female = await _make_user(db_session, "ad_next_female@example.com")
    await _make_profile(db_session, female, gender="female", age=30)
    assert await A.get_next(db_session, female) is not None


async def test_get_next_age_out_of_range_excluded(db_session):
    await A.create_ad(db_session, _ad_in(target_age_min=18, target_age_max=25))
    user = await _make_user(db_session, "ad_next_old@example.com")
    await _make_profile(db_session, user, gender="male", age=40)
    assert await A.get_next(db_session, user) is None


async def test_get_next_age_below_min_excluded(db_session):
    await A.create_ad(db_session, _ad_in(target_age_min=30, target_age_max=40))
    user = await _make_user(db_session, "ad_next_young@example.com")
    await _make_profile(db_session, user, gender="male", age=22)
    assert await A.get_next(db_session, user) is None


async def test_get_next_user_without_profile_excluded_from_targeted(db_session):
    await A.create_ad(db_session, _ad_in(target_age_min=18, target_age_max=99))
    user = await _make_user(db_session, "ad_next_noprofile@example.com")
    # Fără profil → age None → exclus de reclama cu margine de vârstă.
    assert await A.get_next(db_session, user) is None


async def test_get_next_schedule_windows(db_session):
    now = datetime.now(timezone.utc)
    # Expirat.
    await A.create_ad(
        db_session,
        _ad_in(title="Expired", starts_at=now - timedelta(days=2), ends_at=now - timedelta(days=1)),
    )
    user = await _make_user(db_session, "ad_next_sched@example.com")
    assert await A.get_next(db_session, user) is None

    # Viitor.
    await A.create_ad(
        db_session,
        _ad_in(title="Future", starts_at=now + timedelta(days=1)),
    )
    assert await A.get_next(db_session, user) is None

    # Fereastră activă (start în trecut, fără end).
    active = await A.create_ad(
        db_session, _ad_in(title="Active", starts_at=now - timedelta(hours=1))
    )
    out = await A.get_next(db_session, user)
    assert out is not None and out.id == active.id


async def test_get_next_without_user_uses_weighted(db_session):
    await A.create_ad(db_session, _ad_in())
    out = await A.get_next(db_session, None)
    assert out is not None


# --------------------------------------------------------------------------- #
# Rotație cu Redis (monkeypatch pe _get_redis) — ramura live din get_next
# --------------------------------------------------------------------------- #
class _FakePipeline:
    def __init__(self, redis):
        self._redis = redis
        self._ops = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def sadd(self, key, *values):
        self._ops.append(("sadd", key, values))

    def expire(self, key, ttl):
        self._ops.append(("expire", key, ttl))

    async def execute(self):
        for op in self._ops:
            if op[0] == "sadd":
                self._redis.sets.setdefault(op[1], set()).update(
                    str(v) for v in op[2]
                )
        self._ops.clear()


class _FakeRedis:
    def __init__(self):
        self.sets = {}

    async def smembers(self, key):
        return set(self.sets.get(key, set()))

    async def delete(self, key):
        self.sets.pop(key, None)

    def pipeline(self, transaction=True):
        return _FakePipeline(self)


async def test_get_next_rotation_covers_all_before_repeat(db_session, monkeypatch):
    fake = _FakeRedis()

    async def _fake_get_redis():
        return fake

    monkeypatch.setattr(A, "_get_redis", _fake_get_redis)

    ids = set()
    for i in range(3):
        ad = await A.create_ad(db_session, _ad_in(title=f"Ad{i}"))
        ids.add(ad.id)
    user = await _make_user(db_session, "ad_rotation@example.com")

    seen = set()
    for _ in range(3):
        out = await A.get_next(db_session, user)
        assert out is not None
        seen.add(out.id)
    # Toate cele 3 văzute înainte de orice repetare.
    assert seen == ids

    # A 4-a cerere: ciclul s-a epuizat → resetare + reia din mulțimea completă.
    out4 = await A.get_next(db_session, user)
    assert out4 is not None and out4.id in ids


async def test_get_next_redis_failure_falls_back_to_weighted(db_session, monkeypatch):
    class _BoomRedis:
        async def smembers(self, key):
            raise RuntimeError("redis down")

    async def _fake_get_redis():
        return _BoomRedis()

    monkeypatch.setattr(A, "_get_redis", _fake_get_redis)
    await A.create_ad(db_session, _ad_in())
    user = await _make_user(db_session, "ad_redis_boom@example.com")
    # Redis crapă → fallback weighted, NU excepție.
    out = await A.get_next(db_session, user)
    assert out is not None


async def test_pick_rotating_ignores_corrupt_shown_members(db_session):
    fake = _FakeRedis()
    key = f"{A.ROTATION_KEY_PREFIX}42"
    fake.sets[key] = {"not-an-int", "3"}  # un membru corupt + unul valid

    class _Ad:
        def __init__(self, id):
            self.id = id

    ads = [_Ad(3), _Ad(4)]
    # Membrul "3" e marcat ca văzut → rămâne doar 4 candidat; "not-an-int" ignorat.
    chosen = await A._pick_rotating(fake, 42, ads)
    assert chosen.id == 4


# --------------------------------------------------------------------------- #
# Tracking (contoare) + 404
# --------------------------------------------------------------------------- #
async def test_track_impression_and_click_increment(db_session):
    ad = await A.create_ad(db_session, _ad_in())
    await A.track_impression(db_session, ad.id)
    await A.track_impression(db_session, ad.id)
    await A.track_click(db_session, ad.id)
    fresh = await A.get_ad(db_session, ad.id)
    assert fresh.impressions == 2
    assert fresh.clicks == 1


async def test_track_impression_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await A.track_impression(db_session, 999999)
    assert exc.value.status_code == 404


async def test_track_click_404(db_session):
    with pytest.raises(HTTPException) as exc:
        await A.track_click(db_session, 999999)
    assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Dedup per (user, ad) cu Redis — anti-fraudă metrici (fix)
# --------------------------------------------------------------------------- #
class _FakeDedupRedis:
    """Redis minimal pentru dedup: doar `SET key val NX EX=ttl`.

    Întoarce truthy la prima scriere a cheii (NX reușește) și `None` la o
    repetare (cheia există deja) — exact contractul folosit de `_dedup_first_hit`.
    """

    def __init__(self):
        self.store: dict[str, str] = {}

    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.store:
            return None
        self.store[key] = value
        return True


def _patch_redis(monkeypatch, redis):
    async def _fake_get_redis():
        return redis

    monkeypatch.setattr(A, "_get_redis", _fake_get_redis)


async def test_track_impression_deduped_per_user_with_redis(db_session, monkeypatch):
    _patch_redis(monkeypatch, _FakeDedupRedis())
    ad = await A.create_ad(db_session, _ad_in())
    uid = uuid.uuid4()

    # Aceeași pereche (user, ad): cel mult O impresie în fereastră.
    await A.track_impression(db_session, ad.id, uid)
    await A.track_impression(db_session, ad.id, uid)
    await A.track_impression(db_session, ad.id, uid)
    assert (await A.get_ad(db_session, ad.id)).impressions == 1

    # Alt user → o impresie nouă e numărată.
    await A.track_impression(db_session, ad.id, uuid.uuid4())
    assert (await A.get_ad(db_session, ad.id)).impressions == 2


async def test_track_click_deduped_per_user_with_redis(db_session, monkeypatch):
    _patch_redis(monkeypatch, _FakeDedupRedis())
    ad = await A.create_ad(db_session, _ad_in())
    uid = uuid.uuid4()

    await A.track_click(db_session, ad.id, uid)
    await A.track_click(db_session, ad.id, uid)
    assert (await A.get_ad(db_session, ad.id)).clicks == 1

    await A.track_click(db_session, ad.id, uuid.uuid4())
    assert (await A.get_ad(db_session, ad.id)).clicks == 2


async def test_impression_and_click_deduped_independently(db_session, monkeypatch):
    """O impresie NU consumă dreptul la un click (chei separate imp/clk)."""
    _patch_redis(monkeypatch, _FakeDedupRedis())
    ad = await A.create_ad(db_session, _ad_in())
    uid = uuid.uuid4()

    await A.track_impression(db_session, ad.id, uid)
    await A.track_click(db_session, ad.id, uid)  # cheie diferită → se numără
    fresh = await A.get_ad(db_session, ad.id)
    assert fresh.impressions == 1 and fresh.clicks == 1


async def test_track_dedup_still_404_on_missing_ad(db_session, monkeypatch):
    """404 pe id inexistent rămâne, și la primul hit, și la repetarea dedup-uită."""
    _patch_redis(monkeypatch, _FakeDedupRedis())
    uid = uuid.uuid4()

    # Primul hit: ramura de numărare → UPDATE rowcount 0 → 404.
    with pytest.raises(HTTPException) as e1:
        await A.track_impression(db_session, 999999, uid)
    assert e1.value.status_code == 404

    # Al doilea hit (deduplicat): ramura else verifică existența → tot 404.
    with pytest.raises(HTTPException) as e2:
        await A.track_impression(db_session, 999999, uid)
    assert e2.value.status_code == 404


async def test_track_without_redis_counts_each_time(db_session):
    """Fără Redis (REDIS_URL gol în teste) → degradare grațioasă: numără fiecare hit."""
    ad = await A.create_ad(db_session, _ad_in())
    uid = uuid.uuid4()
    await A.track_impression(db_session, ad.id, uid)
    await A.track_impression(db_session, ad.id, uid)
    assert (await A.get_ad(db_session, ad.id)).impressions == 2


async def test_track_redis_failure_falls_back_to_counting(db_session, monkeypatch):
    """Redis căzut la `SET` → degradăm (permitem numărarea), nu crăpăm."""

    class _BoomRedis:
        async def set(self, *a, **k):
            raise RuntimeError("redis down")

    _patch_redis(monkeypatch, _BoomRedis())
    ad = await A.create_ad(db_session, _ad_in())
    uid = uuid.uuid4()
    await A.track_impression(db_session, ad.id, uid)
    await A.track_impression(db_session, ad.id, uid)
    assert (await A.get_ad(db_session, ad.id)).impressions == 2


# --------------------------------------------------------------------------- #
# Helpers puri
# --------------------------------------------------------------------------- #
def test_calc_age_before_and_after_birthday():
    today = date(2026, 7, 24)
    # Ziua de naștere a trecut anul ăsta.
    assert A._calc_age(date(2000, 1, 1), today) == 26
    # Ziua de naștere încă nu a venit.
    assert A._calc_age(date(2000, 12, 31), today) == 25


def test_pick_weighted_respects_weight():
    class _Ad:
        def __init__(self, id, weight):
            self.id = id
            self.weight = weight

    # O singură reclamă cu weight mare → mereu aleasă.
    only = _Ad(1, 100)
    for _ in range(10):
        assert A._pick_weighted([only]).id == 1
