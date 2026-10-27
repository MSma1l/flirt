"""Limitări PER USER (nu per IP) + „o dată pe fereastră" pentru acțiuni autentificate.

RO: `core/ratelimit.py` limitează per IP, ca dependency FastAPI, și e gândit pentru
rutele publice (login, OTP). Rutele de aici sunt AUTENTIFICATE: abuzul vine de la
un cont, nu de la o adresă — un NAT de operator mobil pune sute de useri pe același
IP, iar un atacator cu un singur cont își poate schimba IP-ul oricând. Deci cheia
corectă e `user_id`.

Refolosim store-ul din `core/ratelimit.py` (`check`: Redis partajat între workeri,
fallback in-memory) și același comutator (`_active`: `RATE_LIMIT_ENABLED`, oprit
implicit sub pytest, reactivat de teste cu `ratelimit.enable_for_tests()`).

`once_per` NU e o limitare de cereri, ci o deduplicare (ex. „notificarea de match
pentru perechea X pleacă cel mult o dată pe zi"). Ea nu depinde de comutatorul de
rate limiting: o notificare dublată e un bug de produs, nu o protecție opțională.
Redis `SET NX EX` când e configurat, altfel un dicționar in-memory cu expirare.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import uuid

from fastapi import HTTPException, status

from app.core import ratelimit
from app.core.config import settings

log = logging.getLogger("app.user_ratelimit")

KEY_PREFIX = "url:"  # „user rate limit" — namespace separat de `rl:` (per IP)
ONCE_PREFIX = "once:"
REDIS_TIMEOUT_SECONDS = 1.0

DEFAULT_DETAIL = "Prea multe cereri. Încearcă din nou mai târziu."


def limit_from_settings(name: str, default: int) -> int:
    """Pragul `name`: din `settings` dacă e declarat acolo, altfel din variabila
    de mediu `NAME` (majuscule), altfel `default`.

    Pragurile noi nu sunt (încă) declarate în `core/config.py`; așa rămân
    configurabile din mediu (ex. `AI_DAILY_QUOTA_PER_USER=50`) fără să atingem
    modelul de configurare. Testele suprascriu constanta-default a modulului
    apelant.
    """
    raw = getattr(settings, name, None)
    if raw is None:
        raw = os.environ.get(name.upper())
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


async def hit(
    bucket: str, user_id: uuid.UUID | str, limit: int, window_seconds: float
) -> bool:
    """Consumă o unitate din cota userului. True = încape; False = depășit.

    Cu rate limiting-ul oprit (`RATE_LIMIT_ENABLED=false` sau sub pytest fără
    `enable_for_tests`) întoarce mereu True.
    """
    if not ratelimit._active():
        return True
    return await ratelimit.check(f"{KEY_PREFIX}{bucket}:{user_id}", limit, window_seconds)


async def enforce(
    bucket: str,
    user_id: uuid.UUID | str,
    limit: int,
    window_seconds: float,
    detail: str = DEFAULT_DETAIL,
) -> None:
    """Ca `hit`, dar ridică HTTP 429 la depășire."""
    if not await hit(bucket, user_id, limit, window_seconds):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail
        )


# --------------------------------------------------------------------------- #
# „O dată pe fereastră" (deduplicare cu TTL)
# --------------------------------------------------------------------------- #
_once_local: dict[str, float] = {}
_once_lock = threading.Lock()
_ONCE_LOCAL_MAX_KEYS = 50_000

_redis_client = None
_redis_client_url: str | None = None
_redis_lock = threading.Lock()


def _get_redis():
    global _redis_client, _redis_client_url

    url = settings.redis_url
    if not url:
        return None
    if _redis_client is None or _redis_client_url != url:
        import redis.asyncio as aioredis  # import lazy (dependență opțională)

        with _redis_lock:
            if _redis_client is None or _redis_client_url != url:
                _redis_client = aioredis.from_url(
                    url,
                    decode_responses=True,
                    socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
                    socket_timeout=REDIS_TIMEOUT_SECONDS,
                )
                _redis_client_url = url
    return _redis_client


def _reset_redis() -> None:
    global _redis_client, _redis_client_url
    _redis_client = None
    _redis_client_url = None


def _once_in_memory(key: str, ttl_seconds: float) -> bool:
    now = time.monotonic()
    with _once_lock:
        expires = _once_local.get(key)
        if expires is not None and expires > now:
            return False
        if len(_once_local) >= _ONCE_LOCAL_MAX_KEYS:
            # Curățăm intrările expirate; dacă tot e plin, golim (fail-open:
            # cel mult o notificare în plus, niciodată memorie nemărginită).
            for k in [k for k, v in _once_local.items() if v <= now]:
                del _once_local[k]
            if len(_once_local) >= _ONCE_LOCAL_MAX_KEYS:
                _once_local.clear()
        _once_local[key] = now + ttl_seconds
        return True


async def once_per(key: str, ttl_seconds: float) -> bool:
    """True prima dată când e văzută `key` în fereastra `ttl_seconds`, apoi False.

    Redis indisponibil ⇒ cădem pe store-ul in-memory (per proces).
    """
    full_key = f"{ONCE_PREFIX}{key}"
    try:
        client = _get_redis()
        if client is not None:
            created = await client.set(full_key, "1", nx=True, ex=max(1, int(ttl_seconds)))
            return bool(created)
    except Exception as exc:  # noqa: BLE001 — deduplicarea nu are voie să strice fluxul
        log.warning(
            "once_per: Redis indisponibil, cad pe store-ul in-memory",
            extra={"error_type": type(exc).__name__},
        )
        _reset_redis()
    return _once_in_memory(full_key, ttl_seconds)


def reset_for_tests() -> None:
    """Golește store-ul in-memory de deduplicare."""
    with _once_lock:
        _once_local.clear()
    _reset_redis()
