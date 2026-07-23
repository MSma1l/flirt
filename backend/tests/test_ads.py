"""Teste funcționale pentru sistemul de reclame (Ads).

Acoperă:
  * CRUD admin (create/list/get/patch/delete + 404 + PATCH gol → 422)
  * setări globale GET (defaults 15/10/enabled) + PUT
  * ordinea rutelor: /ads/settings NU e capturat de /ads/{ad_id}
  * public /ads/config
  * public /ads/next — caz 204 (fără reclame / dezactivat), capping durată,
    excluderea reclamelor inactive
  * auth: user normal → 403 pe rutele de admin, neautentificat → 401

Rulează pe PostgreSQL efemer (fixturile din `conftest.py`).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.admin import AdminAuditLog
from app.models.profile import Profile
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str) -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


async def _register_with_profile(
    client, db, email: str, *, gender: str, age: int
) -> dict:
    """Înregistrează un user ȘI îi atașează un profil cu gen + vârstă (pentru targetare)."""
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    profile = Profile(
        user_id=user.id,
        name="Tester",
        # Naștere pe 1 ianuarie → vârsta = diferența de ani, indiferent de ziua curentă.
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
    return headers


async def _count_audit(db, action: str) -> int:
    return await db.scalar(
        select(func.count()).select_from(AdminAuditLog).where(
            AdminAuditLog.action == action
        )
    )


def _ad_payload(**over) -> dict:
    base = {
        "title": "Buy our thing",
        "video_url": "https://cdn.flirt.local/ad1.mp4",
        "image_url": "https://cdn.flirt.local/ad1.jpg",
        "duration_seconds": 30,
        "active": True,
        "weight": 1,
    }
    base.update(over)
    return base


# --------------------------------------------------------------------------- #
# CRUD admin
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_create_list_get_ad(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads@example.com")

    resp = await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    assert resp.status_code == 201, resp.text
    ad = resp.json()
    assert isinstance(ad["id"], int)
    assert ad["title"] == "Buy our thing"
    assert ad["duration_seconds"] == 30
    assert ad["active"] is True
    assert ad["weight"] == 1
    ad_id = ad["id"]

    resp = await client.get(f"{ADMIN}/ads", headers=admin)
    assert resp.status_code == 200
    assert [a["id"] for a in resp.json()] == [ad_id]

    resp = await client.get(f"{ADMIN}/ads/{ad_id}", headers=admin)
    assert resp.status_code == 200
    assert resp.json()["id"] == ad_id


@pytest.mark.asyncio
async def test_get_ad_404(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads404@example.com")
    resp = await client.get(f"{ADMIN}/ads/999999", headers=admin)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_patch_ad_partial_and_empty(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_patch@example.com")
    ad_id = (
        await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    ).json()["id"]

    # PATCH parțial: schimbă doar active, restul rămâne.
    resp = await client.patch(
        f"{ADMIN}/ads/{ad_id}", json={"active": False}, headers=admin
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["active"] is False
    assert body["title"] == "Buy our thing"  # neatins

    # PATCH gol → 422.
    resp = await client.patch(f"{ADMIN}/ads/{ad_id}", json={}, headers=admin)
    assert resp.status_code == 422

    # PATCH pe id inexistent → 404.
    resp = await client.patch(
        f"{ADMIN}/ads/999999", json={"active": False}, headers=admin
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_ad(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_del@example.com")
    ad_id = (
        await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    ).json()["id"]

    resp = await client.delete(f"{ADMIN}/ads/{ad_id}", headers=admin)
    assert resp.status_code == 204

    resp = await client.get(f"{ADMIN}/ads/{ad_id}", headers=admin)
    assert resp.status_code == 404

    resp = await client.delete(f"{ADMIN}/ads/{ad_id}", headers=admin)
    assert resp.status_code == 404


# --------------------------------------------------------------------------- #
# Setări globale
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_settings_defaults_and_update(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_set@example.com")

    # GET /ads/settings NU e capturat de /ads/{ad_id} (ordinea rutelor).
    resp = await client.get(f"{ADMIN}/ads/settings", headers=admin)
    assert resp.status_code == 200, resp.text
    s = resp.json()
    assert s["swipes_before_ad"] == 15
    assert s["max_video_seconds"] == 10
    assert s["enabled"] is True

    resp = await client.put(
        f"{ADMIN}/ads/settings",
        json={"swipes_before_ad": 20, "max_video_seconds": 8, "enabled": False},
        headers=admin,
    )
    assert resp.status_code == 200, resp.text
    s = resp.json()
    assert s["swipes_before_ad"] == 20
    assert s["max_video_seconds"] == 8
    assert s["enabled"] is False


# --------------------------------------------------------------------------- #
# Public
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_public_config(client, db_session):
    user = await _register(client, "user_ads_cfg@example.com")
    resp = await client.get(f"{API}/ads/config", headers=user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"enabled": True, "swipes_before_ad": 15, "max_video_seconds": 10}


@pytest.mark.asyncio
async def test_public_next_204_when_no_ads(client, db_session):
    user = await _register(client, "user_ads_none@example.com")
    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_public_next_caps_duration(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_cap@example.com")
    user = await _register(client, "user_ads_cap@example.com")

    # Creativ de 30s, plafon global 10s → clientul primește 10s.
    await client.post(
        f"{ADMIN}/ads", json=_ad_payload(duration_seconds=30), headers=admin
    )

    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["duration_seconds"] == 10  # min(30, max_video_seconds=10)
    assert body["title"] == "Buy our thing"
    assert "id" in body


@pytest.mark.asyncio
async def test_public_next_under_cap_not_inflated(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_short@example.com")
    user = await _register(client, "user_ads_short@example.com")

    # Creativ de 6s, sub plafon → rămâne 6s (nu se umflă la 10).
    await client.post(
        f"{ADMIN}/ads", json=_ad_payload(duration_seconds=6), headers=admin
    )
    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 200
    assert resp.json()["duration_seconds"] == 6


@pytest.mark.asyncio
async def test_public_next_skips_inactive(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_inactive@example.com")
    user = await _register(client, "user_ads_inactive@example.com")

    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="Inactive", active=False),
        headers=admin,
    )
    # Doar o reclamă, inactivă → 204.
    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_public_next_204_when_disabled(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ads_off@example.com")
    user = await _register(client, "user_ads_off@example.com")

    await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    # Dezactivăm global.
    await client.put(
        f"{ADMIN}/ads/settings",
        json={"swipes_before_ad": 15, "max_video_seconds": 10, "enabled": False},
        headers=admin,
    )
    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 204


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_admin_ads_requires_admin(client, db_session):
    user = await _register(client, "user_ads_forbidden@example.com")

    # User normal → 403 pe rutele de admin.
    assert (await client.get(f"{ADMIN}/ads", headers=user)).status_code == 403
    assert (
        await client.get(f"{ADMIN}/ads/settings", headers=user)
    ).status_code == 403
    assert (
        await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=user)
    ).status_code == 403

    # Neautentificat → 401.
    assert (await client.get(f"{ADMIN}/ads")).status_code == 401
    assert (await client.get(f"{API}/ads/config")).status_code == 401
    assert (await client.get(f"{API}/ads/next")).status_code == 401


# --------------------------------------------------------------------------- #
# Targetare pe gen
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_target_gender_female_only_not_shown_to_male(client, db_session):
    admin = await _make_admin(client, db_session, "admin_tg@example.com")
    male = await _register_with_profile(
        client, db_session, "male_tg@example.com", gender="male", age=30
    )

    # Singura reclamă țintește femei → un user male primește 204.
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="For her", target_gender="female"),
        headers=admin,
    )
    assert (await client.get(f"{API}/ads/next", headers=male)).status_code == 204


@pytest.mark.asyncio
async def test_target_gender_male_and_null_shown_to_male(client, db_session):
    admin = await _make_admin(client, db_session, "admin_tg2@example.com")
    male = await _register_with_profile(
        client, db_session, "male_tg2@example.com", gender="male", age=30
    )

    # Reclamă țintită pe male → livrată.
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="For him", target_gender="male"),
        headers=admin,
    )
    resp = await client.get(f"{API}/ads/next", headers=male)
    assert resp.status_code == 200
    assert resp.json()["title"] == "For him"


@pytest.mark.asyncio
async def test_target_gender_null_shown_to_everyone(client, db_session):
    admin = await _make_admin(client, db_session, "admin_tg3@example.com")
    female = await _register_with_profile(
        client, db_session, "female_tg3@example.com", gender="female", age=22
    )

    # target_gender null → oricine (inclusiv o femeie).
    await client.post(
        f"{ADMIN}/ads", json=_ad_payload(title="For all"), headers=admin
    )
    resp = await client.get(f"{API}/ads/next", headers=female)
    assert resp.status_code == 200
    assert resp.json()["title"] == "For all"


# --------------------------------------------------------------------------- #
# Targetare pe vârstă
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_target_age_out_of_range_not_shown(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ta@example.com")
    young = await _register_with_profile(
        client, db_session, "young_ta@example.com", gender="male", age=20
    )

    # Reclamă pentru 30–40 ani → un user de 20 nu o vede (204).
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="30-40", target_age_min=30, target_age_max=40),
        headers=admin,
    )
    assert (await client.get(f"{API}/ads/next", headers=young)).status_code == 204


@pytest.mark.asyncio
async def test_target_age_in_range_shown(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ta2@example.com")
    mid = await _register_with_profile(
        client, db_session, "mid_ta2@example.com", gender="female", age=35
    )

    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="30-40", target_age_min=30, target_age_max=40),
        headers=admin,
    )
    resp = await client.get(f"{API}/ads/next", headers=mid)
    assert resp.status_code == 200
    assert resp.json()["title"] == "30-40"


@pytest.mark.asyncio
async def test_target_age_excludes_user_without_profile(client, db_session):
    admin = await _make_admin(client, db_session, "admin_ta3@example.com")
    # User FĂRĂ profil → vârstă necunoscută → exclus de la reclame cu targetare de vârstă.
    no_profile = await _register(client, "noprofile_ta3@example.com")

    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="18-99", target_age_min=18, target_age_max=99),
        headers=admin,
    )
    assert (
        await client.get(f"{API}/ads/next", headers=no_profile)
    ).status_code == 204


# --------------------------------------------------------------------------- #
# Programare (fereastra de difuzare)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_schedule_expired_not_shown(client, db_session):
    admin = await _make_admin(client, db_session, "admin_sch@example.com")
    user = await _register(client, "user_sch@example.com")

    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="Expired", ends_at=past),
        headers=admin,
    )
    assert (await client.get(f"{API}/ads/next", headers=user)).status_code == 204


@pytest.mark.asyncio
async def test_schedule_future_not_shown(client, db_session):
    admin = await _make_admin(client, db_session, "admin_sch2@example.com")
    user = await _register(client, "user_sch2@example.com")

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(title="NotYet", starts_at=future),
        headers=admin,
    )
    assert (await client.get(f"{API}/ads/next", headers=user)).status_code == 204


@pytest.mark.asyncio
async def test_schedule_active_window_shown(client, db_session):
    admin = await _make_admin(client, db_session, "admin_sch3@example.com")
    user = await _register(client, "user_sch3@example.com")

    now = datetime.now(timezone.utc)
    await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(
            title="Live",
            starts_at=(now - timedelta(days=1)).isoformat(),
            ends_at=(now + timedelta(days=1)).isoformat(),
        ),
        headers=admin,
    )
    resp = await client.get(f"{API}/ads/next", headers=user)
    assert resp.status_code == 200
    assert resp.json()["title"] == "Live"


# --------------------------------------------------------------------------- #
# Tracking (impression / click)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_impression_and_click_increment(client, db_session):
    admin = await _make_admin(client, db_session, "admin_trk@example.com")
    user = await _register(client, "user_trk@example.com")
    ad_id = (
        await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    ).json()["id"]

    # Contoare inițiale = 0.
    ad = (await client.get(f"{ADMIN}/ads/{ad_id}", headers=admin)).json()
    assert ad["impressions"] == 0 and ad["clicks"] == 0

    assert (
        await client.post(f"{API}/ads/{ad_id}/impression", headers=user)
    ).status_code == 204
    assert (
        await client.post(f"{API}/ads/{ad_id}/impression", headers=user)
    ).status_code == 204
    assert (
        await client.post(f"{API}/ads/{ad_id}/click", headers=user)
    ).status_code == 204

    ad = (await client.get(f"{ADMIN}/ads/{ad_id}", headers=admin)).json()
    assert ad["impressions"] == 2
    assert ad["clicks"] == 1


@pytest.mark.asyncio
async def test_tracking_404_on_missing_ad(client, db_session):
    user = await _register(client, "user_trk404@example.com")
    assert (
        await client.post(f"{API}/ads/999999/impression", headers=user)
    ).status_code == 404
    assert (
        await client.post(f"{API}/ads/999999/click", headers=user)
    ).status_code == 404


# --------------------------------------------------------------------------- #
# Audit pe acțiunile admin
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_admin_actions_write_audit_log(client, db_session):
    admin = await _make_admin(client, db_session, "admin_audit@example.com")

    # create → ad.create
    ad_id = (
        await client.post(f"{ADMIN}/ads", json=_ad_payload(), headers=admin)
    ).json()["id"]
    assert await _count_audit(db_session, "ad.create") == 1

    # patch → ad.update
    await client.patch(
        f"{ADMIN}/ads/{ad_id}", json={"active": False}, headers=admin
    )
    assert await _count_audit(db_session, "ad.update") == 1

    # settings PUT → ad.settings.update
    await client.put(
        f"{ADMIN}/ads/settings",
        json={"swipes_before_ad": 12, "max_video_seconds": 9, "enabled": True},
        headers=admin,
    )
    assert await _count_audit(db_session, "ad.settings.update") == 1

    # delete → ad.delete
    await client.delete(f"{ADMIN}/ads/{ad_id}", headers=admin)
    assert await _count_audit(db_session, "ad.delete") == 1

    # Verificăm că intrarea de create poartă ad_id-ul în meta.
    row = await db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.action == "ad.create")
    )
    assert row.meta.get("ad_id") == ad_id
    assert row.target_type == "ad"


# --------------------------------------------------------------------------- #
# Validare scheme (targetare)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_invalid_target_rejected(client, db_session):
    admin = await _make_admin(client, db_session, "admin_val@example.com")

    # Gen invalid → 422.
    resp = await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(target_gender="other"),
        headers=admin,
    )
    assert resp.status_code == 422

    # Vârstă sub minim legal → 422.
    resp = await client.post(
        f"{ADMIN}/ads", json=_ad_payload(target_age_min=15), headers=admin
    )
    assert resp.status_code == 422

    # Fereastră de vârstă incoerentă (min > max) → 422.
    resp = await client.post(
        f"{ADMIN}/ads",
        json=_ad_payload(target_age_min=40, target_age_max=30),
        headers=admin,
    )
    assert resp.status_code == 422
