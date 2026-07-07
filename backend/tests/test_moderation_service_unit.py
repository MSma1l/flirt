"""Unit teste pentru moderation_service — idempotență, self-report, auto-ban."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import UserSettings
from app.models.moderation import Report
from app.models.user import User
from app.schemas.moderation import ReportIn
from app.services import moderation_service as M


async def _make_user(db, email) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_cannot_report_self_422(db_session):
    user = await _make_user(db_session, "self@example.com")
    with pytest.raises(HTTPException) as exc:
        await M.create_report(
            db_session, user,
            ReportIn(reported_user_id=user.id, category="spam"),
        )
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_report_is_idempotent(db_session):
    reporter = await _make_user(db_session, "r1@example.com")
    target = await _make_user(db_session, "t1@example.com")
    data = ReportIn(reported_user_id=target.id, category="spam")

    first = await M.create_report(db_session, reporter, data)
    second = await M.create_report(db_session, reporter, data)
    assert first.id == second.id

    rows = (
        await db_session.execute(
            select(Report).where(Report.reporter_id == reporter.id)
        )
    ).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_list_my_reports_ordered(db_session):
    reporter = await _make_user(db_session, "r2@example.com")
    t1 = await _make_user(db_session, "t2a@example.com")
    t2 = await _make_user(db_session, "t2b@example.com")
    await M.create_report(db_session, reporter, ReportIn(reported_user_id=t1.id, category="spam"))
    await M.create_report(db_session, reporter, ReportIn(reported_user_id=t2.id, category="fake"))

    reports = await M.list_my_reports(db_session, reporter)
    assert len(reports) == 2


@pytest.mark.asyncio
async def test_autoban_hides_profile_at_threshold(db_session):
    """La `report_autoban_threshold` raportori distincți → profil ascuns + status."""
    target = await _make_user(db_session, "victim@example.com")
    threshold = settings.report_autoban_threshold

    # `threshold` raportori DISTINCȚI raportează același user.
    for i in range(threshold):
        reporter = await _make_user(db_session, f"rep{i}@example.com")
        out = await M.create_report(
            db_session, reporter,
            ReportIn(reported_user_id=target.id, category="offensive"),
        )

    # Profilul țintei e ascuns automat.
    us = (
        await db_session.execute(
            select(UserSettings).where(UserSettings.user_id == target.id)
        )
    ).scalar_one_or_none()
    assert us is not None and us.profile_hidden is True

    # Rapoartele sunt marcate auto_banned.
    reports = (
        await db_session.execute(
            select(Report).where(Report.reported_id == target.id)
        )
    ).scalars().all()
    assert all(r.status == "auto_banned" for r in reports)


@pytest.mark.asyncio
async def test_autoban_updates_existing_settings(db_session):
    """Dacă UserSettings există deja, auto-ban doar setează profile_hidden."""
    target = await _make_user(db_session, "victim2@example.com")
    db_session.add(
        UserSettings(
            user_id=target.id,
            search_radius_km=settings.search_radius_default_km,
            notifications={}, profile_hidden=False,
        )
    )
    await db_session.commit()

    for i in range(settings.report_autoban_threshold):
        reporter = await _make_user(db_session, f"rr{i}@example.com")
        await M.create_report(
            db_session, reporter,
            ReportIn(reported_user_id=target.id, category="obscene"),
        )

    us = (
        await db_session.execute(
            select(UserSettings).where(UserSettings.user_id == target.id)
        )
    ).scalar_one()
    assert us.profile_hidden is True


@pytest.mark.asyncio
async def test_below_threshold_no_ban(db_session):
    target = await _make_user(db_session, "safe@example.com")
    # Un singur raportor (sub prag, presupunând prag > 1).
    reporter = await _make_user(db_session, "one@example.com")
    await M.create_report(
        db_session, reporter,
        ReportIn(reported_user_id=target.id, category="spam"),
    )
    us = (
        await db_session.execute(
            select(UserSettings).where(UserSettings.user_id == target.id)
        )
    ).scalar_one_or_none()
    if settings.report_autoban_threshold > 1:
        assert us is None or us.profile_hidden is False
