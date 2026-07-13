"""Teste de pregătire operațională (deployment readiness).

Acoperă exact lucrurile care te ard în producție, nu în dev:
  1. `/health/ready` întoarce 503 când DB-ul e căzut (probe-ul spune ADEVĂRUL);
  2. rate limiting-ul e PARTAJAT prin Redis (nu per proces × 4 workeri);
  3. handler-ul global de excepții NU scurge detalii interne către client;
  4. request-id-ul e propagat și corelabil.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import APIRouter
from httpx import ASGITransport, AsyncClient

from app.core import ratelimit
from app.core.logging import REQUEST_ID_HEADER
from app.db.session import get_db
from app.main import app

_aio = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# 1. Health checks
# --------------------------------------------------------------------------- #


@_aio
async def test_health_is_liveness_only(client: AsyncClient):
    """`/health` = liveness: 200 fără să atingă dependențele."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@_aio
async def test_readiness_ok_when_db_up(client: AsyncClient):
    """`/health/ready` = readiness: 200 + `SELECT 1` reușit pe DB."""
    resp = await client.get("/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["checks"]["database"] == "ok"
    # REDIS_URL nu e setat în teste → raportat explicit, nu ignorat tăcut.
    assert body["checks"]["redis"] == "not_configured"


class _BrokenSession:
    """Sesiune DB care cade la orice interogare (Postgres oprit / rețea moartă)."""

    async def execute(self, *args, **kwargs):
        raise ConnectionRefusedError("could not connect to server: Connection refused")


@_aio
async def test_readiness_returns_503_when_db_down(db_session):
    """Blocantul real: cu DB căzut, readiness TREBUIE să întoarcă 503.

    Vechiul `/health` întorcea `{"status": "ok"}` static — un load balancer ar fi
    trimis trafic către o instanță incapabilă să servească o singură cerere.
    """

    async def _broken_db():
        yield _BrokenSession()

    app.dependency_overrides[get_db] = _broken_db
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            resp = await ac.get("/health/ready")
            # Liveness rămâne 200 (procesul e viu — restartul nu ar rezolva nimic).
            live = await ac.get("/health")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["checks"]["database"] == "down"
    # Nu scurgem detalii de conexiune (DSN, parolă, host) în răspuns.
    assert "Connection refused" not in resp.text
    assert live.status_code == 200


# --------------------------------------------------------------------------- #
# 2. Rate limiting partajat (Redis)
# --------------------------------------------------------------------------- #


class _FakePipeline:
    """Pipeline Redis fals: INCR + EXPIRE pe un dict PARTAJAT."""

    def __init__(self, store: dict[str, int]) -> None:
        self._store = store
        self._ops: list[tuple[str, str]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def incr(self, key: str) -> None:
        self._ops.append(("incr", key))

    def expire(self, key: str, ttl: int) -> None:
        self._ops.append(("expire", key))

    async def execute(self) -> list[int]:
        results: list[int] = []
        for op, key in self._ops:
            if op == "incr":
                self._store[key] = self._store.get(key, 0) + 1
                results.append(self._store[key])
            else:
                results.append(1)
        self._ops.clear()
        return results


class _FakeRedis:
    def __init__(self, store: dict[str, int]) -> None:
        self._store = store

    def pipeline(self, transaction: bool = True) -> _FakePipeline:
        return _FakePipeline(self._store)


@_aio
async def test_rate_limit_is_shared_across_processes(monkeypatch):
    """Două instanțe de limitator (= doi workeri gunicorn) văd ACELAȘI contor.

    Cu store-ul in-memory de dinainte, fiecare worker avea contorul lui: 4
    workeri × limita 5 = 20 încercări de login reale. Aici limita e globală.
    """
    store: dict[str, int] = {}
    monkeypatch.setattr(
        ratelimit.RedisRateLimiter, "_get_client", lambda self: _FakeRedis(store)
    )

    worker_a = ratelimit.RedisRateLimiter("redis://fake:6379/0")
    worker_b = ratelimit.RedisRateLimiter("redis://fake:6379/0")

    limit, window = 3, 60
    results = []
    # Alternăm workerii: a, b, a, b, a, b — limita e comună, nu per worker.
    for i in range(6):
        worker = worker_a if i % 2 == 0 else worker_b
        results.append(await worker.allow("login:1.2.3.4", limit, window))

    assert results == [True, True, True, False, False, False]
    # O singură cheie în Redis, indiferent câți workeri o incrementează.
    assert len(store) == 1


@_aio
async def test_rate_limit_dependency_uses_redis_when_configured(client, monkeypatch):
    """End-to-end: cu REDIS_URL setat, /auth/login e limitat prin Redis (429)."""
    store: dict[str, int] = {}
    monkeypatch.setattr(ratelimit.settings, "redis_url", "redis://fake:6379/0")
    monkeypatch.setattr(
        ratelimit.RedisRateLimiter, "_get_client", lambda self: _FakeRedis(store)
    )
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 2)
    ratelimit.enable_for_tests()
    try:
        payload = {"email": "redis-rl@example.com", "password": "password12345"}
        await client.post("/api/v1/auth/register", json=payload)

        statuses = [
            (await client.post("/api/v1/auth/login", json=payload)).status_code
            for _ in range(4)
        ]
    finally:
        ratelimit.disable_for_tests()

    assert statuses[:2] == [200, 200]
    assert statuses[2:] == [429, 429]
    # Dovada că a mers pe Redis, nu pe fallback-ul in-memory.
    assert any(key.startswith(ratelimit.REDIS_KEY_PREFIX) for key in store)


@_aio
async def test_rate_limit_falls_back_to_memory_when_redis_down(monkeypatch):
    """Redis căzut → degradăm la in-memory, NU dăm 500 și NU rămânem fără limită."""

    def _boom(self):
        raise ConnectionError("Redis unreachable")

    monkeypatch.setattr(ratelimit.settings, "redis_url", "redis://down:6379/0")
    monkeypatch.setattr(ratelimit.RedisRateLimiter, "_get_client", _boom)
    ratelimit.enable_for_tests()
    try:
        results = [await ratelimit.check("login:9.9.9.9", 2, 60) for _ in range(3)]
    finally:
        ratelimit.disable_for_tests()

    # Fallback-ul in-memory a preluat limitarea (2 permise, a 3-a respinsă).
    assert results == [True, True, False]


@_aio
async def test_rate_limit_ignored_without_redis_url(monkeypatch):
    """Fără REDIS_URL (dev/teste) folosim direct store-ul in-memory."""
    monkeypatch.setattr(ratelimit.settings, "redis_url", "")
    ratelimit.reset_backend()
    assert ratelimit._get_redis_limiter() is None
    assert await ratelimit.check("dev:1.1.1.1", 1, 60) is True
    assert await ratelimit.check("dev:1.1.1.1", 1, 60) is False
    ratelimit.limiter.reset()


# --------------------------------------------------------------------------- #
# 3. Handler global de excepții — fără scurgeri de informație
# --------------------------------------------------------------------------- #

_SECRET_IN_ERROR = "postgresql://flirt:SuperSecretPassword@db:5432/flirt"

_boom_router = APIRouter()


@_boom_router.get("/__test_boom")
async def _boom_endpoint():
    # Simulează o eroare internă care conține un secret în mesaj (exact ce ar
    # face un driver DB: pune DSN-ul cu parolă în textul excepției).
    raise RuntimeError(f"connection failed: {_SECRET_IN_ERROR}")


@pytest_asyncio.fixture
async def boom_client(db_session):
    """Client cu o rută care aruncă o excepție internă.

    `raise_app_exceptions=False` imită comportamentul unui server REAL: Starlette
    reridică excepția după ce handler-ul a trimis răspunsul (ca uvicorn/gunicorn
    să o poată loga), iar clientul de test ar reprimi-o. Ne interesează ce vede
    clientul HTTP — adică răspunsul.
    """

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    app.include_router(_boom_router)
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.router.routes = [
        r for r in app.router.routes if getattr(r, "path", "") != "/__test_boom"
    ]
    app.dependency_overrides.clear()


@_aio
async def test_unhandled_exception_returns_generic_500(boom_client: AsyncClient):
    """500 generic: fără stack trace, fără mesajul excepției, fără secrete."""
    resp = await boom_client.get("/__test_boom")

    assert resp.status_code == 500
    body = resp.json()
    assert body["detail"] == "Internal server error"
    # NIMIC din interiorul erorii nu ajunge la client.
    assert "SuperSecretPassword" not in resp.text
    assert "postgresql://" not in resp.text
    assert "RuntimeError" not in resp.text
    assert "Traceback" not in resp.text
    # Dar clientul primește request-id-ul: cu el, suportul găsește stack trace-ul
    # COMPLET în log-urile serverului.
    assert body["request_id"]
    assert resp.headers[REQUEST_ID_HEADER] == body["request_id"]


@_aio
async def test_unhandled_exception_is_logged_with_stacktrace(
    boom_client: AsyncClient, caplog
):
    """Pe server, în schimb, logăm TOT: mesaj + stack trace, cu request-id."""
    import logging

    with caplog.at_level(logging.ERROR, logger="app"):
        resp = await boom_client.get("/__test_boom")

    assert resp.status_code == 500
    records = [r for r in caplog.records if r.message == "unhandled exception"]
    assert records, "excepția neprinsă trebuie logată"
    record = records[0]
    assert record.exc_info is not None  # stack trace complet
    assert record.path == "/__test_boom"
    assert record.error_type == "RuntimeError"
    assert record.request_id == resp.json()["request_id"]


# --------------------------------------------------------------------------- #
# 4. Request-id (corelarea log-urilor)
# --------------------------------------------------------------------------- #


@_aio
async def test_request_id_is_generated_when_missing(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.headers.get(REQUEST_ID_HEADER)


@_aio
async def test_request_id_from_proxy_is_reused(client: AsyncClient):
    """Nginx pune X-Request-ID; îl păstrăm ca trasarea să meargă cap-coadă."""
    resp = await client.get("/health", headers={REQUEST_ID_HEADER: "abc123XYZ"})
    assert resp.headers[REQUEST_ID_HEADER] == "abc123XYZ"


@_aio
async def test_malicious_request_id_is_sanitized(client: AsyncClient):
    """Un request-id ostil (injecție în log / header splitting) e curățat."""
    resp = await client.get(
        "/health", headers={REQUEST_ID_HEADER: 'evil"\n\rX-Admin: 1' + "x" * 200}
    )
    value = resp.headers[REQUEST_ID_HEADER]
    assert len(value) <= 64
    assert all(c.isalnum() or c in "-_" for c in value)


# --------------------------------------------------------------------------- #
# 5. Purjarea GDPR chiar RULEAZĂ (înainte, `purge_expired_accounts` nu era
#    apelat de nimeni — datele „șterse" rămâneau în DB pe termen nelimitat)
# --------------------------------------------------------------------------- #


@_aio
async def test_gdpr_purge_script_deletes_expired_accounts(db_session, monkeypatch):
    """`scripts/gdpr_purge.py --loop` (serviciul `purge` din compose) chiar șterge."""
    import contextlib
    import importlib
    import sys
    from datetime import datetime, timedelta, timezone
    from pathlib import Path

    from sqlalchemy import select

    from app.core.security import hash_password
    from app.models.account import AccountDeletionRequest
    from app.models.user import User

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    gdpr_purge = importlib.import_module("gdpr_purge")

    user = User(email="purge-me@example.com", password_hash=hash_password("Str0ng-Passw0rd!"))
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    user_id = user.id

    # Cerere de ștergere cu perioada de grație EXPIRATĂ (ieri).
    db_session.add(
        AccountDeletionRequest(
            user_id=user_id,
            requested_at=datetime.now(timezone.utc) - timedelta(days=31),
            purge_after=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    await db_session.commit()

    @contextlib.asynccontextmanager
    async def _session():
        yield db_session

    monkeypatch.setattr(gdpr_purge, "AsyncSessionLocal", _session)

    purged = await gdpr_purge.run_once()

    assert purged == 1
    remaining = await db_session.execute(
        select(AccountDeletionRequest).where(AccountDeletionRequest.user_id == user_id)
    )
    assert remaining.scalars().first() is None  # cererea a fost consumată


def test_gdpr_purge_interval_is_clamped(monkeypatch):
    """Un interval absurd nu are voie să bombardeze DB-ul.

    Intervalul vine acum din `Settings` (nu direct din `os.environ`), deci se
    patch-uiește obiectul de config, nu mediul: `settings` e un singleton citit
    o singură dată, la import.
    """
    import importlib
    import sys
    from pathlib import Path

    from app.core.config import settings

    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    gdpr_purge = importlib.import_module("gdpr_purge")

    monkeypatch.setattr(settings, "gdpr_purge_interval_seconds", 1)
    assert gdpr_purge._interval_seconds() == 60  # plafonat la minim un minut

    monkeypatch.setattr(settings, "gdpr_purge_interval_seconds", 7200)
    assert gdpr_purge._interval_seconds() == 7200


@_aio
async def test_access_log_has_no_pii(client: AsyncClient, caplog):
    """Access log-ul conține metadate de transport — NU tokenuri, parole, PII."""
    import logging

    with caplog.at_level(logging.INFO, logger="app.access"):
        await client.post(
            "/api/v1/auth/register?token=super-secret-token",
            json={"email": "log@example.com", "password": "password12345"},
            headers={"Authorization": "Bearer leaked.jwt.token"},
        )

    records = [r for r in caplog.records if r.name == "app.access"]
    assert records
    record = records[0]
    assert record.method == "POST"
    assert record.status in (201, 200)
    assert isinstance(record.duration_ms, float)
    blob = str(record.__dict__)
    assert "password12345" not in blob
    assert "leaked.jwt.token" not in blob
    assert "super-secret-token" not in blob  # query string-ul NU e logat
    assert "log@example.com" not in blob
