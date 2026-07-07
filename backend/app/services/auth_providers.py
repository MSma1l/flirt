"""Verificarea identităților externe: Apple / Google Sign-In și telefon+OTP.

Acesta este SCHELETUL (TZ 2.1). În modul 'stub' NU se face niciun apel de rețea:
verificarea acceptă tokenuri/coduri de test, ca să putem dezvolta și testa fluxul
fără chei reale. La trecerea în 'live' se activează validarea criptografică reală
(JWKS Apple/Google) și SMS-ul real, folosind cheile din `settings`.
"""
from __future__ import annotations

import time

from app.core.config import settings

# ---------------------------------------------------------------------------
# Social Sign-In (Apple / Google)
# ---------------------------------------------------------------------------


def _decode_stub_token(id_token: str) -> dict:
    """Decodează un „token de test" pentru modul stub.

    Formate acceptate:
      - `stub:email@example.com`
      - `email@example.com` (tokenul ESTE emailul)

    Întoarce `{sub, email}`. `sub` este derivat determinist din email, ca să
    imite claim-ul stabil `sub` din tokenurile reale.
    """
    raw = id_token.strip()
    if raw.startswith("stub:"):
        raw = raw[len("stub:") :].strip()

    email = raw.lower()
    if "@" not in email:
        raise ValueError("Invalid stub token: expected an email")

    # `sub` stabil = partea locală a emailului (suficient pentru stub).
    sub = email.split("@", 1)[0]
    return {"sub": sub, "email": email}


async def verify_google(id_token: str) -> dict:
    """Verifică un `id_token` Google și întoarce `{sub, email}`.

    STUB: decodează un token de test, fără rețea.
    LIVE (de implementat): descarcă cheile JWKS Google
    (https://www.googleapis.com/oauth2/v3/certs), validează semnătura RS256,
    verifică `aud == settings.google_client_id`, `iss` și `exp`, apoi extrage
    claim-urile `sub` și `email`.
    """
    if settings.social_auth_mode == "stub":
        return _decode_stub_token(id_token)

    raise NotImplementedError(
        "Live Google Sign-In nu este încă implementat: setează social_auth_mode='stub' "
        "sau implementează validarea JWKS Google + google_client_id."
    )


async def verify_apple(id_token: str) -> dict:
    """Verifică un `id_token` Apple și întoarce `{sub, email}`.

    STUB: decodează un token de test, fără rețea.
    LIVE (de implementat): descarcă cheile JWKS Apple
    (https://appleid.apple.com/auth/keys), validează semnătura, verifică
    `aud == settings.apple_client_id`, `iss == https://appleid.apple.com` și
    `exp`, apoi extrage `sub` și `email`.
    """
    if settings.social_auth_mode == "stub":
        return _decode_stub_token(id_token)

    raise NotImplementedError(
        "Live Apple Sign-In nu este încă implementat: setează social_auth_mode='stub' "
        "sau implementează validarea JWKS Apple + apple_client_id."
    )


# ---------------------------------------------------------------------------
# Telefon + OTP
# ---------------------------------------------------------------------------

# Store in-memory al codurilor OTP: telefon -> (cod, expires_at_epoch).
# OK pentru stub/dev. În producție acest store trebuie mutat în Redis (cu TTL),
# altfel codurile se pierd la restart și nu funcționează pe mai multe instanțe.
_otp_store: dict[str, tuple[str, float]] = {}


def _now() -> float:
    return time.monotonic()


async def request_otp(phone: str) -> None:
    """„Trimite" un cod OTP către numărul de telefon.

    STUB: nu se trimite niciun SMS. Se „emite" codul fix `settings.otp_test_code`
    și se stochează in-memory cu expirare după `settings.otp_ttl_seconds`.
    LIVE (de implementat): generează un cod aleator, îl stochează în Redis cu TTL
    și îl trimite prin providerul SMS (folosind settings.sms_api_key).
    """
    phone = phone.strip()
    if settings.otp_mode == "stub":
        expires_at = _now() + settings.otp_ttl_seconds
        _otp_store[phone] = (settings.otp_test_code, expires_at)
        return

    raise NotImplementedError(
        "Live OTP prin SMS nu este încă implementat: setează otp_mode='stub' "
        "sau implementează generarea codului + trimiterea SMS (sms_api_key)."
    )


async def verify_otp(phone: str, code: str) -> bool:
    """Verifică un cod OTP pentru un număr de telefon.

    STUB: acceptă `settings.otp_test_code` dacă a fost „solicitat" în prealabil
    și nu a expirat. La succes, consumă codul (o singură utilizare).
    """
    phone = phone.strip()
    if settings.otp_mode == "stub":
        entry = _otp_store.get(phone)
        if entry is None:
            return False

        stored_code, expires_at = entry
        if _now() > expires_at:
            # Cod expirat: îl curățăm ca să nu rămână în store.
            _otp_store.pop(phone, None)
            return False

        if code.strip() == stored_code:
            _otp_store.pop(phone, None)  # single-use
            return True
        return False

    raise NotImplementedError(
        "Live OTP prin SMS nu este încă implementat: setează otp_mode='stub' "
        "sau implementează verificarea codului din Redis."
    )
