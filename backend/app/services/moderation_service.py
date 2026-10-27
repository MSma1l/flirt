"""Logica modulului Moderare / Raportări (TZ 5.5 + 10).

Raport idempotent pe (reporter, reported, category). La atingerea pragului de
raportori DISTINCȚI și CREDIBILI împotriva aceluiași user (config
`report_autoban_threshold`), profilul acestuia e auto-ASCUNS din feed
(`profile_hidden`) în așteptarea deciziei umane, iar rapoartele lui sunt marcate
`auto_banned` (= „acțiune automată aplicată, așteaptă review"; numele stării e
păstrat pentru coada de admin).

DE CE NU UN BAN AUTOMAT: cu ban real (banned_at + sesiuni revocate) trei conturi
proaspete puteau scoate DEFINITIV pe oricine din aplicație — inclusiv un admin.
Acum acțiunea automată e reversibilă și fără efect asupra login-ului, banul
rămâne o decizie umană, iar votul contează doar de la raportori credibili (vezi
`_credible_reporters_count`). Conturile admin nu sunt niciodată auto-ascunse.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.user_ratelimit import limit_from_settings
from app.models.activity import ProfileView
from app.models.chat import Chat
from app.models.moderation import Report
from app.models.swipe import Like, Match
from app.models.user import ROLE_USER, User

# Vechimea minimă (zile) a contului raportorului ca raportul să conteze la pragul
# de auto-ascundere. Configurabil prin `settings.report_min_reporter_account_age_days`.
REPORT_MIN_REPORTER_ACCOUNT_AGE_DAYS = 3
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

    # AUTO-ASCUNDERE (TZ 10): numărăm doar raportorii DISTINCȚI și CREDIBILI.
    distinct_reporters = await _credible_reporters_count(db, data.reported_user_id)
    if distinct_reporters >= settings.report_autoban_threshold:
        await _auto_hide(db, data.reported_user_id)

    await db.commit()
    await db.refresh(report)
    return _to_report_out(report)


def _min_reporter_age() -> timedelta:
    days = limit_from_settings(
        "report_min_reporter_account_age_days", REPORT_MIN_REPORTER_ACCOUNT_AGE_DAYS
    )
    return timedelta(days=max(0, days))


def _interacted_with(reported_id: uuid.UUID):
    """Raportorul (`Report.reporter_id`) a avut o interacțiune REALĂ cu ținta:
    match, chat, swipe (în orice direcție) sau o vizualizare de profil (în orice
    direcție — o vizualizare e înregistrată când cartela i-a fost afișată în feed
    și a dat swipe, sau când i-a deschis profilul)."""
    reporter = Report.reporter_id
    a, b = Match.user_a_id, Match.user_b_id
    match = (
        select(Match.id)
        .where(or_(and_(a == reporter, b == reported_id), and_(a == reported_id, b == reporter)))
        .exists()
    )
    chat = (
        select(Chat.id)
        .where(
            or_(
                and_(Chat.user_a_id == reporter, Chat.user_b_id == reported_id),
                and_(Chat.user_a_id == reported_id, Chat.user_b_id == reporter),
            )
        )
        .exists()
    )
    like = (
        select(Like.id)
        .where(
            or_(
                and_(Like.from_user_id == reporter, Like.to_user_id == reported_id),
                and_(Like.from_user_id == reported_id, Like.to_user_id == reporter),
            )
        )
        .exists()
    )
    view = (
        select(ProfileView.id)
        .where(
            or_(
                and_(ProfileView.viewer_id == reporter, ProfileView.viewed_id == reported_id),
                and_(ProfileView.viewer_id == reported_id, ProfileView.viewed_id == reporter),
            )
        )
        .exists()
    )
    return or_(match, chat, like, view)


async def _credible_reporters_count(db: AsyncSession, reported_id: uuid.UUID) -> int:
    """Câți raportori DISTINCȚI și credibili are ținta.

    Credibil = cont cu vechime ≥ `report_min_reporter_account_age_days` (implicit
    3 zile), profil completat, nebanat/neșters ȘI cu o interacțiune reală cu ținta
    (`_interacted_with`). Rapoartele celorlalți rămân în coadă pentru review uman,
    dar nu declanșează nicio acțiune automată — altfel câteva conturi create pe
    loc puteau ascunde pe oricine.
    """
    cutoff = datetime.now(timezone.utc) - _min_reporter_age()
    count = await db.scalar(
        select(func.count(func.distinct(Report.reporter_id)))
        .join(User, User.id == Report.reporter_id)
        .where(
            Report.reported_id == reported_id,
            User.created_at <= cutoff,
            User.profile_completed.is_(True),
            User.banned_at.is_(None),
            User.deleted_at.is_(None),
            _interacted_with(reported_id),
        )
    )
    return int(count or 0)


async def _auto_hide(db: AsyncSession, reported_id: uuid.UUID) -> None:
    """Acțiunea automată la prag: profil ASCUNS din feed, în așteptarea review-ului.

    NU banăm și NU revocăm sesiunile: un ban automat declanșat de rapoarte era o
    armă (trei conturi → oricine scos definitiv din aplicație). Ascunderea e
    reversibilă din panoul de admin, iar banul rămâne decizia unui om (rapoartele
    stau în coadă ca `auto_banned` — vezi `admin_service.REPORT_STATUS_AUTO_BANNED`).

    Conturile cu rol privilegiat (orice alt rol decât `user`, azi `admin`) sunt
    EXCEPTATE: rapoartele rămân `open` pentru review, fără acțiune automată.
    Refolosim `admin_service._set_profile_hidden` (o singură semantică de
    „ascuns"); import lazy ca să evităm orice ciclu la încărcarea modulelor.
    """
    from app.services import admin_service

    target = await db.get(User, reported_id)
    if target is None or target.role != ROLE_USER:
        return
    await admin_service._set_profile_hidden(db, reported_id, True)

    # Marchează rapoartele acestui user ca „acțiune automată aplicată".
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
