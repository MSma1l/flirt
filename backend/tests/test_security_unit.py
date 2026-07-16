"""Unit teste pentru utilitarele de securitate (parole, JWT, hash token)."""
from datetime import timedelta

import pytest
from jose import JWTError, jwt

from app.core.security import (
    _cfg,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)


# --- Parole ------------------------------------------------------------------
def test_hash_password_is_not_plaintext():
    h = hash_password("Str0ng-Passw0rd!")
    assert h != "Str0ng-Passw0rd!"
    assert h.startswith("$argon2")


def test_verify_password_roundtrip():
    h = hash_password("Str0ng-Passw0rd!")
    assert verify_password("Str0ng-Passw0rd!", h) is True
    assert verify_password("gresit", h) is False


def test_hash_password_uses_salt_unique_hashes():
    # Argon2 foloseste salt aleator → hash-uri diferite pentru aceeasi parola.
    assert hash_password("abc12345") != hash_password("abc12345")


# --- Access token ------------------------------------------------------------
def test_access_token_claims():
    token = create_access_token("user-123")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["type"] == "access"
    assert "exp" in payload and "iat" in payload
    assert "jti" in payload


def test_access_token_extra_claims_merged():
    token = create_access_token("u1", extra={"role": "admin"})
    payload = decode_token(token)
    assert payload["role"] == "admin"


def test_access_tokens_have_unique_jti():
    a = decode_token(create_access_token("u1"))
    b = decode_token(create_access_token("u1"))
    assert a["jti"] != b["jti"]


# --- Refresh token -----------------------------------------------------------
def test_refresh_token_claims():
    token = create_refresh_token("u1", family_id="fam1", jti="jti1")
    payload = decode_token(token)
    assert payload["type"] == "refresh"
    assert payload["family_id"] == "fam1"
    assert payload["jti"] == "jti1"
    assert payload["sub"] == "u1"


def test_refresh_token_default_lifetime_is_7_days():
    """Decizie de produs: 7 zile de inactivitate → userul se reloghează.

    Se verifică default-ul DECLARAT pe câmp (nu `settings`, care poate fi
    suprascris dintr-un `.env` local — testul trebuie să rămână ermetic).
    """
    from app.core.config import Settings

    assert Settings.model_fields["refresh_token_expire_days"].default == 7


def test_refresh_token_exp_follows_configured_lifetime():
    """`exp - iat` respectă exact fereastra din config (fără zile hardcodate)."""
    payload = decode_token(create_refresh_token("u1", family_id="f", jti="j"))
    lifetime = timedelta(days=_cfg().refresh_token_expire_days)
    assert payload["exp"] - payload["iat"] == int(lifetime.total_seconds())


# --- Decode: erori -----------------------------------------------------------
def test_decode_rejects_garbage():
    with pytest.raises(JWTError):
        decode_token("nu-e-un-jwt")


def test_decode_rejects_expired_token():
    # Semnat corect (cheia din _cfg, cu fallback la mediu), dar deja expirat.
    from datetime import datetime, timezone

    cfg = _cfg()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {
            "sub": "u1",
            "iat": now - timedelta(hours=2),
            "exp": now - timedelta(hours=1),
            "type": "access",
        },
        cfg.jwt_private_key,
        algorithm=cfg.jwt_algorithm,
    )
    with pytest.raises(JWTError):
        decode_token(token)


def test_decode_rejects_alg_none():
    # Anti alg=none: un token nesemnat (construit manual) trebuie respins.
    import base64
    import json

    def _b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    token = f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64({'sub': 'u1'})}."
    with pytest.raises(JWTError):
        decode_token(token)


# --- hash_token --------------------------------------------------------------
def test_hash_token_is_deterministic_sha256():
    a = hash_token("raw-refresh")
    b = hash_token("raw-refresh")
    assert a == b
    assert len(a) == 64  # hex SHA-256
    assert a != hash_token("alt-token")
