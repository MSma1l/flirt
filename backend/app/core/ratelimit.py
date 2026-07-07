"""Rate limiting simplu, în memorie, pentru endpoint-uri sensibile (auth).

RO: Implementare cu ferestre glisante (sliding window) ținute într-un dict
`cheie -> listă de timestamp-uri`. Cheia este `bucket:IP`, deci limitarea e per
IP și per endpoint. E suficient pentru o singură instanță / dev.

EN: In production, behind multiple workers/instances, replace this with a shared
store (e.g. Redis `INCR` + `EXPIRE`, or a token-bucket in Redis) so the counters
are consistent across processes. The public API (`rate_limit(...)` dependency)
stays the same — only the backing store changes.
"""
from __future__ import annotations

import os
import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.core.config import settings

# --------------------------------------------------------------------------- #
# Store in-memory + limitator sliding-window
# --------------------------------------------------------------------------- #


class InMemoryRateLimiter:
    """Limitator sliding-window thread-safe, ținut în memorie.

    Fiecare cheie păstrează timestamp-urile (monotonic) ale cererilor din
    fereastra curentă. La fiecare hit curățăm intrările expirate și comparăm cu
    limita.
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


# Instanță globală per proces.
limiter = InMemoryRateLimiter()

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


def disable_for_tests() -> None:
    """Dezactivează la loc rate limiting-ul sub pytest și golește store-ul."""
    global _force_in_tests
    _force_in_tests = False
    limiter.reset()


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
        if not limiter.allow(key, limit, window_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests, please retry later",
            )

    return dependency
