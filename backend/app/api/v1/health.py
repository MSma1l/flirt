"""Health checks: liveness (`/health`) și readiness REAL (`/health/ready`).

RO: Distincția e critică pentru orice orchestrator (Docker healthcheck, k8s,
load balancer):

- **liveness** (`/health`): „procesul e viu?". Nu atinge dependențele. Dacă pică,
  orchestratorul RESTARTEAZĂ containerul.
- **readiness** (`/health/ready`): „pot servi trafic real?". Verifică efectiv
  DB-ul (`SELECT 1`) și Redis-ul (`PING`, dacă e configurat). Dacă pică,
  orchestratorul SCOATE instanța din load balancer — dar NU o restartează
  (Postgres căzut nu se repară restartând API-ul).

Un `/health` care întoarce mereu 200 fără să atingă DB-ul e mai rău decât
niciun health check: raportează „sănătos" cu Postgres mort.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db

router = APIRouter()
log = logging.getLogger("app.health")

# Timp maxim acordat unei verificări de dependență (secunde). Peste el, o
# dependență lentă e tratată ca down — probe-ul nu are voie să atârne.
DEPENDENCY_TIMEOUT_SECONDS = 3.0


@router.get("/health", tags=["meta"], summary="Liveness — procesul e viu")
async def health() -> dict[str, str]:
    """Liveness: NU atinge dependențele. 200 = procesul răspunde."""
    return {"status": "ok", "app": settings.app_name, "env": settings.environment}


@router.get(
    "/health/ready",
    tags=["meta"],
    summary="Readiness — dependențele răspund (503 dacă nu)",
)
async def readiness(
    response: Response, db: AsyncSession = Depends(get_db)
) -> dict[str, object]:
    """Readiness REAL: `SELECT 1` pe DB + `PING` pe Redis (dacă e configurat).

    Întoarce **503** dacă orice dependență obligatorie e căzută.
    """
    checks: dict[str, str] = {}
    healthy = True

    # --- Postgres ---------------------------------------------------------- #
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # pragma: no cover - ramura de eroare e testată cu mock
        healthy = False
        checks["database"] = "down"
        # Logăm tipul erorii, nu DSN-ul (ar conține parola).
        log.error(
            "readiness: database check failed",
            extra={"dependency": "database", "error_type": type(exc).__name__},
        )

    # --- Redis (opțional: doar dacă e configurat) --------------------------- #
    if settings.redis_url:
        try:
            await _ping_redis()
            checks["redis"] = "ok"
        except Exception as exc:
            healthy = False
            checks["redis"] = "down"
            log.error(
                "readiness: redis check failed",
                extra={"dependency": "redis", "error_type": type(exc).__name__},
            )
    else:
        checks["redis"] = "not_configured"

    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {"status": "ready" if healthy else "degraded", "checks": checks}


async def _ping_redis() -> None:
    """`PING` pe Redis, cu timeout. Import lazy (Redis e opțional)."""
    import asyncio

    import redis.asyncio as aioredis  # import lazy — doar când REDIS_URL e setat

    client = aioredis.from_url(
        settings.redis_url,
        socket_connect_timeout=DEPENDENCY_TIMEOUT_SECONDS,
        socket_timeout=DEPENDENCY_TIMEOUT_SECONDS,
    )
    try:
        await asyncio.wait_for(client.ping(), timeout=DEPENDENCY_TIMEOUT_SECONDS)
    finally:
        close = getattr(client, "aclose", None) or getattr(client, "close", None)
        if close:
            await close()
