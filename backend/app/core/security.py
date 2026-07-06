"""Utilitare pure de securitate: hashing parole, JWT RS256, hashing token-uri.

Toate valorile de configurare (chei, durate, algoritm) vin din `settings` —
zero hardcodare.
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import jwt
from passlib.context import CryptContext

from app.core.config import Settings, settings

# Context passlib pentru parole — Argon2.
_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def _cfg() -> Settings:
    """Returnează configurarea curentă.

    Singleton-ul `settings` poate fi cache-uit înainte ca variabilele de mediu
    (ex. cheile RSA injectate în teste) să fie disponibile. Dacă cheile JWT
    lipsesc, re-citim mediul printr-o instanță proaspătă `Settings` — tot din
    settings, fără hardcodare.
    """
    if settings.jwt_private_key and settings.jwt_public_key:
        return settings
    return Settings()


# ---------------------------------------------------------------------------
# Parole
# ---------------------------------------------------------------------------
def hash_password(p: str) -> str:
    """Returnează hash-ul Argon2 al parolei."""
    return _pwd_context.hash(p)


def verify_password(p: str, h: str) -> bool:
    """Verifică o parolă în clar față de hash-ul stocat."""
    return _pwd_context.verify(p, h)


# ---------------------------------------------------------------------------
# JWT (RS256)
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(sub: str, extra: dict[str, Any] | None = None) -> str:
    """Emite un access token JWT semnat RS256.

    Claims: sub, exp, iat, jti, type="access" (+ eventuale claim-uri `extra`).
    """
    cfg = _cfg()
    now = _now()
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=cfg.access_token_expire_minutes),
        "jti": uuid.uuid4().hex,
        "type": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, cfg.jwt_private_key, algorithm=cfg.jwt_algorithm)


def create_refresh_token(sub: str, family_id: str, jti: str) -> str:
    """Emite un refresh token JWT semnat RS256.

    Claims: sub, exp, iat, jti, family_id, type="refresh".
    """
    cfg = _cfg()
    now = _now()
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(days=cfg.refresh_token_expire_days),
        "jti": jti,
        "family_id": family_id,
        "type": "refresh",
    }
    return jwt.encode(payload, cfg.jwt_private_key, algorithm=cfg.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    """Decodează și validează un JWT.

    Algoritmul este fixat la `settings.jwt_algorithm` (anti `alg=none`).
    Ridică `jose.JWTError` la semnătură invalidă / token expirat.
    """
    cfg = _cfg()
    return jwt.decode(
        token,
        cfg.jwt_public_key,
        algorithms=[cfg.jwt_algorithm],
    )


# ---------------------------------------------------------------------------
# Hashing token-uri (pentru stocare)
# ---------------------------------------------------------------------------
def hash_token(raw: str) -> str:
    """SHA-256 hex al unui token brut — folosit la stocarea refresh token-ului."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
