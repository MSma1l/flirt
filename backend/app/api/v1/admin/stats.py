"""Statistici de admin — `/admin/stats`, `/admin/stats/timeseries`, `/admin/me`.

Toate contoarele sunt calculate în SQL AGREGAT (vezi `admin_service.get_stats`):
un dashboard care încarcă tabelele în Python ca să le numere devine, la scară,
cel mai scump endpoint al aplicației — și cade exact când produsul merge bine.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.admin import (
    AdminMeOut,
    AdminStats,
    MetricSeriesOut,
    TimeseriesPoint,
)
from app.services import admin_service
from app.services.admin_service import TIMESERIES_METRIC_NAMES

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]

# Plafonul e impus de FastAPI ÎNAINTE de a atinge DB-ul: fiecare zi cerută e un
# bucket agregat, deci `?days=1000000` ar fi un DoS gratuit.
DaysQuery = Annotated[int | None, Query(ge=1, le=settings.admin_timeseries_max_days)]


@router.get("/me", response_model=AdminMeOut)
async def me(admin: CurrentAdmin) -> AdminMeOut:
    """Cine sunt și ce rol am.

    Ruta există pentru că `GET /auth/me` (`UserOut`) NU expune `role`: panoul nu
    are din ce să decidă dacă utilizatorul logat e administrator. Fiind în spatele
    lui `require_admin`, un răspuns 200 e în sine dovada rolului (un user obișnuit
    primește 403 aici, nu un `role: "user"` pe care frontendul ar trebui să-l
    interpreteze — decizia rămâne pe server).
    """
    return AdminMeOut(id=admin.id, email=admin.email, role=admin.role)


@router.get("/stats", response_model=AdminStats)
async def get_stats(db: DbDep) -> AdminStats:
    """Dashboard-ul complet: useri, profiluri, swipe-uri, chat, moderare,
    abonamente (+ venit estimat) și evenimente.

    Răspunsul are două straturi: cifrele PLATE de pe cardurile panoului
    (`users_total`, `matches_24h`, …) și obiectele DETALIATE (`users`, `profiles`,
    …). Aceleași agregate SQL le alimentează pe amândouă — zero query-uri în plus.
    """
    return await admin_service.get_stats(db)


@router.get("/stats/timeseries", response_model=list[TimeseriesPoint])
async def get_timeseries(db: DbDep, days: DaysQuery = None) -> list[TimeseriesPoint]:
    """Seriile zilnice ale dashboard-ului (useri, match-uri, rapoarte, venit).

    TOATE seriile într-un singur apel: un endpoint „o metrică per cerere" ar fi
    cerut 4 round-trip-uri ca să deseneze un ecran care se deschide o dată, pentru
    exact aceleași agregări `GROUP BY`. Zilele fără activitate apar ca 0, nu lipsesc.
    """
    return await admin_service.get_timeseries(db, days=days)


@router.get("/stats/timeseries/{metric}", response_model=MetricSeriesOut)
async def get_metric_series(
    metric: str, db: DbDep, days: DaysQuery = None
) -> MetricSeriesOut:
    """Serie temporală pentru O metrică aleasă (analiză ad-hoc).

    Metrici disponibile: users, swipes, matches, messages, chats, reports,
    subscriptions, events. `metric` e validată contra unei allowlist (422 dacă e
    necunoscută) — nu ajunge NICIODATĂ interpolată într-un SQL.
    """
    return await admin_service.get_metric_series(db, metric=metric, days=days)


# Expus pentru documentație/OpenAPI (lista metricilor acceptate).
__all__ = ["router", "TIMESERIES_METRIC_NAMES"]
