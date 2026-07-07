"""Logica modulului Moderare / Raportări (TZ 5.5 + 10).

Raport idempotent pe (reporter, reported, category). La atingerea pragului de
raportori DISTINCȚI împotriva aceluiași user (config `report_autoban_threshold`),
contul acestuia este auto-ascuns din feed (`profile_hidden`), iar rapoartele lui
sunt marcate `auto_banned` — auto-ban la încredere mare (TZ 10).
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import UserSettings
from app.models.moderation import Report
from app.models.user import User
from app.schemas.moderation import ReportIn, ReportOut


def _to_report_out(report: Report) -> ReportOut:
    return ReportOut(
        id=report.id,
        reported_id=report.reported_id,
        category=report.category,
        status=report.status,
        created_at=report.created_at,
    )


async def create_report(
    db: AsyncSession, reporter: User, data: ReportIn
) -> ReportOut:
    """Creează (sau întoarce, idempotent) un raport și aplică auto-ban la prag."""
    # Nu te poți raporta pe tine.
    if data.reported_user_id == reporter.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot report yourself",
        )

    # Idempotență pe (reporter, reported, category): dacă există deja, îl întoarcem.
    existing_result = await db.execute(
        select(Report).where(
            Report.reporter_id == reporter.id,
            Report.reported_id == data.reported_user_id,
            Report.category == data.category,
        )
    )
    report = existing_result.scalar_one_or_none()
    if report is None:
        report = Report(
            reporter_id=reporter.id,
            reported_id=data.reported_user_id,
            category=data.category,
            chat_id=data.chat_id,
            note=data.note,
        )
        db.add(report)
        await db.flush()

    # AUTO-BAN (TZ 10): numărăm raportorii DISTINCȚI împotriva userului raportat.
    distinct_reporters = await db.scalar(
        select(func.count(func.distinct(Report.reporter_id))).where(
            Report.reported_id == data.reported_user_id
        )
    )
    if (distinct_reporters or 0) >= settings.report_autoban_threshold:
        await _auto_ban(db, data.reported_user_id)

    await db.commit()
    await db.refresh(report)
    return _to_report_out(report)


async def _auto_ban(db: AsyncSession, reported_id: uuid.UUID) -> None:
    """Ascunde profilul userului raportat și marchează rapoartele ca auto_banned."""
    # Ascunde profilul (creează UserSettings dacă lipsesc, cu valori din config).
    settings_result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == reported_id)
    )
    user_settings = settings_result.scalar_one_or_none()
    if user_settings is None:
        user_settings = UserSettings(
            user_id=reported_id,
            search_radius_km=settings.search_radius_default_km,
            notifications={},
            profile_hidden=True,
        )
        db.add(user_settings)
    else:
        user_settings.profile_hidden = True

    # Marchează toate rapoartele acestui user ca auto_banned.
    await db.execute(
        update(Report)
        .where(Report.reported_id == reported_id)
        .values(status="auto_banned")
    )


async def list_my_reports(db: AsyncSession, reporter: User) -> list[ReportOut]:
    """Rapoartele depuse de userul curent, cel mai recent primul."""
    result = await db.execute(
        select(Report)
        .where(Report.reporter_id == reporter.id)
        .order_by(Report.created_at.desc())
    )
    return [_to_report_out(r) for r in result.scalars().all()]
