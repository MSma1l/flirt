"""Securitate (logică de business): rapoartele nu mai sunt o armă de ban.

Înainte: 3 conturi proaspete raportau pe oricine (inclusiv un admin) → ban
definitiv + sesiuni revocate. Acum: la prag, doar ASCUNDERE în așteptarea
review-ului; contează doar raportori credibili; admin-ii sunt exceptați;
`POST /reports` e limitat per user.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core import ratelimit
from app.core.config import settings
from app.core.security import hash_password
from app.models.account import UserSettings
from app.models.activity import ProfileView
from app.models.chat import Chat
from app.models.moderation import Report
from app.models.session import RefreshSession
from app.models.swipe import Like, Match
from app.models.user import ROLE_ADMIN, User
from app.schemas.moderation import ReportIn
from app.services import moderation_service as M

API = "/api/v1"


async def _user(db, email: str, *, age_days: int = 0, completed: bool = False,
                role: str = "user") -> User:
    user = User(
        email=email, password_hash=hash_password("Str0ng-Passw0rd!"),
        profile_completed=completed, role=role,
    )
    db.add(user)
    await db.commit()
    if age_days:
        user.created_at = datetime.now(timezone.utc) - timedelta(days=age_days)
        await db.commit()
    await db.refresh(user)
    return user


async def _hidden(db, user: User) -> bool:
    us = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    ).scalar_one_or_none()
    return bool(us is not None and us.profile_hidden)


async def _report_n(db, target: User, reporters: list[User]) -> None:
    for r in reporters:
        await M.create_report(db, r, ReportIn(reported_user_id=target.id, category="spam"))


def _view(viewer: User, viewed: User) -> ProfileView:
    return ProfileView(viewer_id=viewer.id, viewed_id=viewed.id, view_date=date.today())


@pytest.mark.asyncio
async def test_fresh_accounts_cannot_hide_anyone(db_session):
    """Conturi noi (sub vechimea minimă), chiar cu profil și interacțiune: zero efect."""
    target = await _user(db_session, "t-fresh@example.com", completed=True)
    reporters = []
    for i in range(settings.report_autoban_threshold + 2):
        r = await _user(db_session, f"fresh{i}@example.com", completed=True)
        db_session.add(_view(r, target))
        reporters.append(r)
    await db_session.commit()

    await _report_n(db_session, target, reporters)

    assert not await _hidden(db_session, target)
    statuses = {
        r.status for r in (await db_session.execute(
            select(Report).where(Report.reported_id == target.id)
        )).scalars()
    }
    assert statuses == {"open"}, "Rapoartele rămân în coadă pentru review uman."


@pytest.mark.asyncio
async def test_old_accounts_without_interaction_do_not_count(db_session):
    target = await _user(db_session, "t-noint@example.com", completed=True)
    reporters = [
        await _user(db_session, f"noint{i}@example.com", age_days=30, completed=True)
        for i in range(settings.report_autoban_threshold)
    ]
    await _report_n(db_session, target, reporters)
    assert not await _hidden(db_session, target)


@pytest.mark.asyncio
async def test_incomplete_profiles_do_not_count(db_session):
    target = await _user(db_session, "t-inc@example.com", completed=True)
    reporters = []
    for i in range(settings.report_autoban_threshold):
        r = await _user(db_session, f"inc{i}@example.com", age_days=30, completed=False)
        db_session.add(_view(r, target))
        reporters.append(r)
    await db_session.commit()
    await _report_n(db_session, target, reporters)
    assert not await _hidden(db_session, target)


@pytest.mark.asyncio
async def test_credible_reporters_hide_but_never_ban(db_session):
    """Raportori credibili (vechi, profil complet, interacțiune reală) → profil
    ascuns, rapoarte marcate; contul NU e banat, sesiunile NU sunt revocate."""
    target = await _user(db_session, "t-cred@example.com", completed=True)
    session = RefreshSession(
        user_id=target.id, jti="jti-cred-target", family_id="fam-cred-target",
        token_hash="h" * 64, expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    db_session.add(session)
    reporters = []
    interactions = [
        lambda r: _view(r, target),
        lambda r: Like(from_user_id=target.id, to_user_id=r.id, is_like=True),
        lambda r: Match(user_a_id=min(r.id, target.id, key=str), user_b_id=max(r.id, target.id, key=str)),
    ]
    for i in range(settings.report_autoban_threshold):
        r = await _user(db_session, f"cred{i}@example.com", age_days=10, completed=True)
        db_session.add(interactions[i % len(interactions)](r))
        reporters.append(r)
    await db_session.commit()

    await _report_n(db_session, target, reporters)

    await db_session.refresh(target)
    assert await _hidden(db_session, target)
    assert target.banned_at is None
    await db_session.refresh(session)
    assert session.revoked is False
    statuses = {
        r.status for r in (await db_session.execute(
            select(Report).where(Report.reported_id == target.id)
        )).scalars()
    }
    assert statuses == {"auto_banned"}


@pytest.mark.asyncio
async def test_chat_counts_as_interaction(db_session):
    target = await _user(db_session, "t-chat@example.com", completed=True)
    reporters = []
    for i in range(settings.report_autoban_threshold):
        r = await _user(db_session, f"chat{i}@example.com", age_days=10, completed=True)
        a, b = sorted([r.id, target.id], key=str)
        match = Match(user_a_id=a, user_b_id=b)
        db_session.add(match)
        await db_session.flush()
        db_session.add(Chat(match_id=match.id, user_a_id=a, user_b_id=b))
        reporters.append(r)
    await db_session.commit()
    await _report_n(db_session, target, reporters)
    assert await _hidden(db_session, target)


@pytest.mark.asyncio
async def test_admin_is_never_auto_hidden(db_session):
    admin = await _user(db_session, "boss@example.com", completed=True, role=ROLE_ADMIN)
    reporters = []
    for i in range(settings.report_autoban_threshold + 1):
        r = await _user(db_session, f"vs-admin{i}@example.com", age_days=10, completed=True)
        db_session.add(_view(r, admin))
        reporters.append(r)
    await db_session.commit()

    await _report_n(db_session, admin, reporters)

    await db_session.refresh(admin)
    assert admin.banned_at is None
    assert not await _hidden(db_session, admin)


@pytest.mark.asyncio
async def test_min_account_age_is_configurable(db_session, monkeypatch):
    monkeypatch.setattr(M, "REPORT_MIN_REPORTER_ACCOUNT_AGE_DAYS", 0)
    target = await _user(db_session, "t-cfg@example.com", completed=True)
    reporters = []
    for i in range(settings.report_autoban_threshold):
        r = await _user(db_session, f"cfg{i}@example.com", completed=True)
        db_session.add(_view(r, target))
        reporters.append(r)
    await db_session.commit()
    await _report_n(db_session, target, reporters)
    assert await _hidden(db_session, target)


@pytest.mark.asyncio
async def test_reports_endpoint_is_rate_limited_per_user(client, db_session, monkeypatch):
    """`POST /reports` — plafon per user pe zi (aici 2) → 429."""
    from app.api.v1 import reports as reports_api

    monkeypatch.setattr(reports_api, "REPORTS_PER_DAY_DEFAULT", 2)
    resp = await client.post(
        f"{API}/auth/register",
        json={"email": "spammer@example.com", "password": "Str0ng-Passw0rd!"},
    )
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    targets = [await _user(db_session, f"victim{i}@example.com") for i in range(3)]

    ratelimit.enable_for_tests()
    try:
        codes = []
        for t in targets:
            r = await client.post(
                f"{API}/reports/",
                json={"reported_user_id": str(t.id), "category": "spam"},
                headers=headers,
            )
            codes.append(r.status_code)
    finally:
        ratelimit.disable_for_tests()

    assert codes == [201, 201, 429], codes
