"""Logica modulului Moderare / Raportări (TZ 5.5 + 10).

Raport idempotent pe (reporter, reported, category). La atingerea pragului de
raportori DISTINCȚI împotriva aceluiași user (config `report_autoban_threshold`),
contul acestuia este auto-ascuns din feed (`profile_hidden`), iar rapoartele lui
sunt marcate `auto_banned` — auto-ban la încredere mare (TZ 10).
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.chat import Chat
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

    # Userul raportat trebuie să existe (altfel abuz / rapoarte fantomă → 404).
    reported_exists = await db.scalar(
        select(User.id).where(User.id == data.reported_user_id)
    )
    if reported_exists is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Reported user not found"
        )

    # Dacă se indică un chat, raportorul trebuie să fie participant la el
    # (nu poți lega raportul de o conversație străină).
    if data.chat_id is not None:
        chat_ok = await db.scalar(
            select(Chat.id).where(
                Chat.id == data.chat_id,
                or_(
                    Chat.user_a_id == reporter.id,
                    Chat.user_b_id == reporter.id,
                ),
            )
        )
        if chat_ok is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a participant of the referenced chat",
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
    """Auto-ban REAL la atingerea pragului de raportori distincți.

    Înainte, „auto-ban"-ul doar ascundea profilul (`profile_hidden`) — dar userul
    mass-raportat se loga în continuare și folosea chat-ul. Docstring-ul din
    `models/user.py` promite că banul = login refuzat + token invalidat + dispariție
    din feed, deci auto-banul trebuie să aplice ACEEAȘI măsură ca banul de admin,
    nu doar o ascundere cosmetică.

    Refolosim primitivele de ban din `admin_service` (NU le duplicăm — o a doua
    implementare ar diverge): `_apply_ban` (banned_at + motiv), `_revoke_sessions`
    (refresh token-ul devine inutilizabil ACUM) și `_set_profile_hidden` (o singură
    semantică de „ascuns"). Import lazy ca să evităm orice ciclu la încărcarea
    modulelor. NU scriem în `AdminAuditLog`: nu există un actor uman, iar rapoartele
    rămân în coadă (`auto_banned`) pentru decizia umană cerută de Apple (Guideline
    1.2) — vezi `admin_service.REPORT_STATUS_AUTO_BANNED`.
    """
    from datetime import datetime, timezone

    from app.services import admin_service

    target = await db.get(User, reported_id)
    if target is not None:
        reason = (
            f"Auto-ban: {settings.report_autoban_threshold} raportări distincte."
        )
        admin_service._apply_ban(target, reason, datetime.now(timezone.utc))
        await admin_service._revoke_sessions(db, reported_id)
    await admin_service._set_profile_hidden(db, reported_id, True)

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
