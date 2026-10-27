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
from jose.exceptions import JWTClaimsError
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


def _audience(audience: str | None) -> str:
    """Audiența implicită = clientul obișnuit (app mobil / Mini App)."""
    return audience or _cfg().jwt_audience_app


def create_access_token(
    sub: str,
    extra: dict[str, Any] | None = None,
    *,
    audience: str | None = None,
) -> str:
    """Emite un access token JWT semnat RS256.

    Claims: sub, exp, iat, jti, type="access", iss, aud (+ eventuale `extra`).
    `audience` = `jwt_audience_admin` pentru conturile de admin, altfel
    `jwt_audience_app`.
    """
    cfg = _cfg()
    now = _now()
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": now + timedelta(minutes=cfg.access_token_expire_minutes),
        "jti": uuid.uuid4().hex,
        "type": "access",
        "iss": cfg.jwt_issuer,
        "aud": _audience(audience),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, cfg.jwt_private_key, algorithm=cfg.jwt_algorithm)


def create_refresh_token(
    sub: str,
    family_id: str,
    jti: str,
    *,
    audience: str | None = None,
    expires_at: datetime | None = None,
    auth_time: int | None = None,
) -> str:
    """Emite un refresh token JWT semnat RS256.

    Claims: sub, exp, iat, jti, family_id, type="refresh", iss, aud, auth_time.
    `auth_time` = momentul login-ului inițial (epoch), purtat NESCHIMBAT prin
    rotații — permite un plafon absolut al sesiunii (folosit pentru admin).
    `expires_at` suprascrie durata implicită (`refresh_token_expire_days`).
    """
    cfg = _cfg()
    now = _now()
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": now,
        "exp": expires_at or now + timedelta(days=cfg.refresh_token_expire_days),
        "jti": jti,
        "family_id": family_id,
        "type": "refresh",
        "iss": cfg.jwt_issuer,
        "aud": _audience(audience),
        "auth_time": auth_time if auth_time is not None else int(now.timestamp()),
    }
    return jwt.encode(payload, cfg.jwt_private_key, algorithm=cfg.jwt_algorithm)


def _legacy_tokens_accepted(cfg: Settings) -> bool:
    """Mai acceptăm token-uri fără `iss`/`aud` (emise înainte de introducerea lor)?"""
    raw = (cfg.jwt_legacy_tokens_accepted_until or "").strip()
    if not raw:
        return False
    try:
        until = datetime.fromisoformat(raw)
    except ValueError:
        return False  # o dată scrisă greșit nu are voie să deschidă poarta
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return _now() < until


def decode_token(
    token: str, *, audiences: tuple[str, ...] | None = None
) -> dict[str, Any]:
    """Decodează și validează un JWT.

    Algoritmul este fixat la `settings.jwt_algorithm` (anti `alg=none`).
    Se validează `iss` (= `jwt_issuer`) și `aud` (∈ `audiences`; implicit oricare
    dintre audiențele noastre — app sau admin).

    Tranziție: un token fără NICIUNUL dintre `iss`/`aud` (emis de versiunea
    anterioară) e acceptat doar până la `jwt_legacy_tokens_accepted_until`.
    Un token cu doar unul dintre ele, sau cu valori străine, e respins.

    Ridică `jose.JWTError` la semnătură invalidă / token expirat / claim greșit.
    """
    cfg = _cfg()
    # `aud`/`iss` se verifică manual mai jos: jose nu acceptă o LISTĂ de
    # audiențe permise și ar respinge orice token cu `aud` dacă nu primește una.
    payload = jwt.decode(
        token,
        cfg.jwt_public_key,
        algorithms=[cfg.jwt_algorithm],
        options={"verify_aud": False, "verify_iss": False},
    )

    if "iss" not in payload and "aud" not in payload:
        if _legacy_tokens_accepted(cfg):
            return payload
        raise JWTClaimsError("Missing issuer and audience")

    if payload.get("iss") != cfg.jwt_issuer:
        raise JWTClaimsError("Invalid issuer")

    allowed = audiences or (cfg.jwt_audience_app, cfg.jwt_audience_admin)
    aud = payload.get("aud")
    token_auds = [aud] if isinstance(aud, str) else aud
    if not isinstance(token_auds, list) or not any(
        isinstance(a, str) and a in allowed for a in token_auds
    ):
        raise JWTClaimsError("Invalid audience")
    return payload


# ---------------------------------------------------------------------------
# Hashing token-uri (pentru stocare)
# ---------------------------------------------------------------------------
def hash_token(raw: str) -> str:
    """SHA-256 hex al unui token brut — folosit la stocarea refresh token-ului."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
