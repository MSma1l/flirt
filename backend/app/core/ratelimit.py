"""Rate limiting pentru endpoint-uri sensibile (auth), PARTAJAT prin Redis.

RO: Contorul trebuie să fie comun tuturor proceselor. Cu 4 workeri gunicorn
(vezi `entrypoint.sh`) și un limitator in-memory *per proces*, limita reală
devine 4× cea configurată — iar la scale-out orizontal (2 instanțe) 8×. Practic
brute-force-ul pe login trece.

Soluția: `INCR` + `EXPIRE` pe Redis, într-o tranzacție (MULTI/EXEC), pe o
fereastră FIXĂ. Cheia conține indexul ferestrei (`floor(now / window)`), deci
expiră singură și nu trebuie curățată.

Fallback: dacă `REDIS_URL` nu e setat (dev, teste) sau Redis e indisponibil,
cădem pe limitatorul in-memory. Fail-OPEN către store-ul local, nu fail-closed:
un Redis căzut nu are voie să blocheze login-ul tuturor userilor — dar nici nu
lăsăm limitarea complet la zero.

API-ul public (`rate_limit(...)` ca dependency FastAPI) rămâne neschimbat.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.core.config import settings

log = logging.getLogger("app.ratelimit")

# Prefix de namespace în Redis (evită coliziuni cu store-ul OTP din auth_providers).
REDIS_KEY_PREFIX = "rl:"
# Timeout-uri scurte: un Redis lent nu are voie să încetinească fiecare cerere.
REDIS_TIMEOUT_SECONDS = 1.0

# --------------------------------------------------------------------------- #
# Store in-memory (fallback: dev, teste, Redis indisponibil)
# --------------------------------------------------------------------------- #


class InMemoryRateLimiter:
    """Limitator sliding-window thread-safe, ținut în memorie.

    Fiecare cheie păstrează timestamp-urile (monotonic) ale cererilor din
    fereastra curentă. La fiecare hit curățăm intrările expirate și comparăm cu
    limita. Valabil doar PER PROCES — vezi `RedisRateLimiter` pentru producție.
    """

    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        """Întoarce True dacă cererea încape în limită; False dacă o depășește."""
        if limit <= 0:
            # Limită 0 sau negativă = blocare totală (defensiv).
            return False
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            bucket = self._hits[key]
            # Curățăm intrările din afara ferestrei.
            if bucket and bucket[0] <= cutoff:
                bucket[:] = [t for t in bucket if t > cutoff]
            if len(bucket) >= limit:
                return False
            bucket.append(now)
            return True

    def reset(self) -> None:
        """Golește complet store-ul (util în teste)."""
        with self._lock:
            self._hits.clear()


# Instanță globală per proces (fallback).
limiter = InMemoryRateLimiter()


# --------------------------------------------------------------------------- #
# Store Redis (producție: partajat între workeri ȘI instanțe)
# --------------------------------------------------------------------------- #


class RedisRateLimiter:
    """Fereastră fixă pe Redis: `INCR` + `EXPIRE` atomic (MULTI/EXEC).

    `allow()` întoarce True dacă cererea încape în limită, False dacă o
    depășește, și propagă excepția dacă Redis nu răspunde (apelantul decide
    fallback-ul).
    """

    def __init__(self, url: str) -> None:
        self._url = url
        self._client = None
        self._lock = threading.Lock()

    def _get_client(self):
        # Import LAZY: `redis` e dependență opțională (extras `[live]` / `[test]`);
        # dev-ul fără Redis nu trebuie să o ceară.
        import redis.asyncio as aioredis

        if self._client is None:
            with self._lock:
                if self._client is None:
                    self._client = aioredis.from_url(
                        self._url,
                        decode_responses=True,
                        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
                        socket_timeout=REDIS_TIMEOUT_SECONDS,
                    )
        return self._client

    async def allow(self, key: str, limit: int, window_seconds: float) -> bool:
        if limit <= 0:
            return False

        window = max(1, int(window_seconds))
        bucket_index = int(time.time()) // window
        redis_key = f"{REDIS_KEY_PREFIX}{key}:{bucket_index}"

        client = self._get_client()
        # MULTI/EXEC: INCR + EXPIRE ajung la server ca o singură operație
        # atomică. Fără asta, o cădere între cele două comenzi ar lăsa o cheie
        # FĂRĂ TTL — adică un IP blocat pentru totdeauna.
        async with client.pipeline(transaction=True) as pipe:
            pipe.incr(redis_key)
            pipe.expire(redis_key, window)
            results = await pipe.execute()

        count = int(results[0])
        return count <= limit

    async def close(self) -> None:
        if self._client is None:
            return
        close = getattr(self._client, "aclose", None) or getattr(
            self._client, "close", None
        )
        if close:
            await close()
        self._client = None


_redis_limiter: RedisRateLimiter | None = None
_redis_limiter_url: str | None = None


def _get_redis_limiter() -> RedisRateLimiter | None:
    """Limitatorul Redis pentru `settings.redis_url` (None dacă nu e configurat).

    Recreat automat dacă URL-ul s-a schimbat (monkeypatch în teste).
    """
    global _redis_limiter, _redis_limiter_url

    url = settings.redis_url
    if not url:
        return None
    if _redis_limiter is None or _redis_limiter_url != url:
        _redis_limiter = RedisRateLimiter(url)
        _redis_limiter_url = url
    return _redis_limiter


def reset_backend() -> None:
    """Uită clientul Redis memorat (teste / reconectare după eroare)."""
    global _redis_limiter, _redis_limiter_url
    _redis_limiter = None
    _redis_limiter_url = None


async def check(key: str, limit: int, window_seconds: float) -> bool:
    """Verifică limita: Redis dacă e configurat, altfel in-memory.

    Dacă Redis e configurat dar cade, degradăm la in-memory (și logăm): o
    limitare aproximativă e mult mai bună decât zero limitare — sau decât un API
    complet mort pentru că store-ul de rate limiting a cedat.
    """
    redis_limiter = _get_redis_limiter()
    if redis_limiter is not None:
        try:
            return await redis_limiter.allow(key, limit, window_seconds)
        except Exception as exc:
            log.warning(
                "rate limit: Redis indisponibil, cad pe store-ul in-memory",
                extra={"error_type": type(exc).__name__},
            )
            reset_backend()  # forțăm reconectarea la următoarea cerere
    return limiter.allow(key, limit, window_seconds)


# --------------------------------------------------------------------------- #
# Comutatoare pentru teste
# --------------------------------------------------------------------------- #

# RO: Sub pytest dezactivăm implicit rate limiting-ul ca suita existentă (care
# lovește endpoint-urile de auth de multe ori de la același IP) să nu fie
# throttled. Testele de securitate îl reactivează explicit prin
# `enable_for_tests()`. În producție `PYTEST_CURRENT_TEST` nu există niciodată.
_force_in_tests = False


def enable_for_tests() -> None:
    """Reactivează rate limiting-ul sub pytest și golește store-ul."""
    global _force_in_tests
    _force_in_tests = True
    limiter.reset()
    reset_backend()


def disable_for_tests() -> None:
    """Dezactivează la loc rate limiting-ul sub pytest și golește store-ul."""
    global _force_in_tests
    _force_in_tests = False
    limiter.reset()
    reset_backend()


def _under_pytest() -> bool:
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def _active() -> bool:
    """Rate limiting activ dacă e pornit din settings și nu suntem sub pytest
    (decât dacă un test l-a reactivat explicit)."""
    if not settings.rate_limit_enabled:
        return False
    if _under_pytest() and not _force_in_tests:
        return False
    return True


def _client_ip(request: Request) -> str:
    """Determină IP-ul clientului, respectând `X-Forwarded-For` (reverse proxy).

    RO: Nginx (vezi nginx.conf) setează `X-Forwarded-For`; luăm primul IP din
    listă. Cădem pe `request.client.host` dacă antetul lipsește.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client and request.client.host:
        return request.client.host
    return "anonymous"


# --------------------------------------------------------------------------- #
# Dependency factory
# --------------------------------------------------------------------------- #


def rate_limit(bucket: str, limit_attr: str, window_seconds: float):
    """Construiește o dependency FastAPI care limitează per IP + `bucket`.

    - `bucket`: nume logic al endpoint-ului (ex. "login").
    - `limit_attr`: numele atributului din `settings` cu pragul (citit la fiecare
      cerere ca monkeypatch-ul din teste să aibă efect).
    - `window_seconds`: mărimea ferestrei.

    La depășire ridică HTTP 429.
    """

    async def dependency(request: Request) -> None:
        if not _active():
            return
        limit = int(getattr(settings, limit_attr))
        key = f"{bucket}:{_client_ip(request)}"
        if not await check(key, limit, window_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, please retry later",
            )

    return dependency
