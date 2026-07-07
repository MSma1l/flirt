"""Verificarea identităților externe: Apple / Google Sign-In și telefon+OTP.

Acesta este SCHELETUL (TZ 2.1). În modul 'stub' NU se face niciun apel de rețea:
verificarea acceptă tokenuri/coduri de test, ca să putem dezvolta și testa fluxul
fără chei reale. La trecerea în 'live' se activează validarea criptografică reală
(JWKS Apple/Google) și SMS-ul real, folosind cheile din `settings`.
"""
from __future__ import annotations

import secrets
import time

import httpx
from fastapi import HTTPException, status
from jose import jwt
from jose.exceptions import JWTError

from app.core.config import settings

# JWKS endpoints & issueri acceptați (RFC pentru fiecare provider).
_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
_GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
_APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
_APPLE_ISSUERS = ("https://appleid.apple.com",)

# Prefix cheie Redis pentru codurile OTP live.
_OTP_REDIS_PREFIX = "otp:"
# Contor de încercări eșuate / telefon (anti brute-force) și contor de cereri OTP
# / telefon / oră (anti-spam), în Redis pentru modul live.
_OTP_ATTEMPTS_PREFIX = "otp_attempts:"
_OTP_REQ_PREFIX = "otp_req:"

# Fereastra pentru cooldown-ul cererilor OTP (o oră).
_OTP_REQUEST_WINDOW_SECONDS = 3600

# ---------------------------------------------------------------------------
# Social Sign-In (Apple / Google)
# ---------------------------------------------------------------------------


async def _fetch_jwks(url: str) -> dict:
    """Descarcă setul de chei publice JWKS de la `url` (endpoint provider).

    Izolat într-o funcție dedicată ca testele să poată monkeypatch-ui fetch-ul,
    fără rețea și fără chei reale.
    """
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.get(url)
        resp.raise_for_status()
        return resp.json()


async def _verify_social_id_token(
    id_token: str, *, jwks_url: str, audience: str, issuers: tuple[str, ...]
) -> dict:
    """Validează criptografic un `id_token` OIDC (RS256) și întoarce `{sub, email}`.

    Pași: citește `kid` din header → alege cheia potrivită din JWKS → verifică
    semnătura, `aud`, `iss` și `exp` cu `jose.jwt`. Orice eșec → HTTP 401.
    """
    try:
        header = jwt.get_unverified_header(id_token)
        kid = header.get("kid")

        jwks = await _fetch_jwks(jwks_url)
        keys = jwks.get("keys", [])
        # Alege STRICT cheia după `kid`. Fără fallback pe `keys[0]`: un `kid`
        # necunoscut înseamnă token nesemnat cu o cheie de încredere → respins.
        key = next((k for k in keys if k.get("kid") == kid), None)
        if key is None:
            raise JWTError("no matching JWKS key for kid")

        claims = jwt.decode(
            id_token,
            key,
            algorithms=["RS256"],
            audience=audience,
            issuer=issuers,
        )
    except (JWTError, KeyError, ValueError) as exc:
        # Nu scurgem detalii criptografice către client.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid identity token",
        ) from exc

    email = claims.get("email")
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Identity token missing 'sub'",
        )
    return {"sub": sub, "email": (email or "").lower()}


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

    # LIVE: validare criptografică reală cu JWKS Google.
    return await _verify_social_id_token(
        id_token,
        jwks_url=_GOOGLE_JWKS_URL,
        audience=settings.google_client_id,
        issuers=_GOOGLE_ISSUERS,
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

    # LIVE: validare criptografică reală cu JWKS Apple.
    return await _verify_social_id_token(
        id_token,
        jwks_url=_APPLE_JWKS_URL,
        audience=settings.apple_client_id,
        issuers=_APPLE_ISSUERS,
    )


# ---------------------------------------------------------------------------
# Telefon + OTP
# ---------------------------------------------------------------------------

# Store in-memory al codurilor OTP: telefon -> (cod, expires_at_epoch).
# OK pentru stub/dev. În producție acest store trebuie mutat în Redis (cu TTL),
# altfel codurile se pierd la restart și nu funcționează pe mai multe instanțe.
_otp_store: dict[str, tuple[str, float]] = {}
# Contor de încercări eșuate / telefon (anti brute-force) — stub/in-memory.
_otp_attempts: dict[str, int] = {}
# Istoric timestamp-uri cereri OTP / telefon (cooldown per oră) — stub/in-memory.
_otp_requests: dict[str, list[float]] = {}


def reset_stub_otp_state() -> None:
    """Golește store-urile OTP in-memory (util în teste)."""
    _otp_store.clear()
    _otp_attempts.clear()
    _otp_requests.clear()


def _now() -> float:
    return time.monotonic()


def _too_many_requests() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many OTP requests, please retry later",
    )


def _get_redis():
    """Client Redis async pentru store-ul OTP live.

    Import LAZY: `redis.asyncio` se încarcă doar pe ramura live, ca stub-ul să
    nu depindă de Redis. `decode_responses=True` → citim string-uri, nu bytes.
    """
    import redis.asyncio as aioredis  # import lazy (doar în modul live)

    return aioredis.from_url(settings.redis_url, decode_responses=True)


def _generate_otp_code() -> str:
    """Generează un cod numeric de 6 cifre, criptografic sigur (`secrets`)."""
    return f"{secrets.randbelow(1_000_000):06d}"


async def _send_sms(phone: str, body: str) -> None:
    """Trimite un SMS prin Twilio REST API (HTTP POST, basic auth sid:token)."""
    url = (
        "https://api.twilio.com/2010-04-01/Accounts/"
        f"{settings.twilio_account_sid}/Messages.json"
    )
    async with httpx.AsyncClient(timeout=10.0) as http:
        resp = await http.post(
            url,
            auth=(settings.twilio_account_sid, settings.twilio_auth_token),
            data={"From": settings.twilio_from, "To": phone, "Body": body},
        )
        resp.raise_for_status()


async def request_otp(phone: str) -> None:
    """„Trimite" un cod OTP către numărul de telefon.

    STUB: nu se trimite niciun SMS. Se „emite" codul fix `settings.otp_test_code`
    și se stochează in-memory cu expirare după `settings.otp_ttl_seconds`.
    LIVE (de implementat): generează un cod aleator, îl stochează în Redis cu TTL
    și îl trimite prin providerul SMS (folosind settings.sms_api_key).
    """
    phone = phone.strip()
    if settings.otp_mode == "stub":
        # Cooldown: max `otp_request_per_hour` cereri / telefon / oră.
        now = _now()
        cutoff = now - _OTP_REQUEST_WINDOW_SECONDS
        history = [t for t in _otp_requests.get(phone, []) if t > cutoff]
        if len(history) >= settings.otp_request_per_hour:
            _otp_requests[phone] = history
            raise _too_many_requests()
        history.append(now)
        _otp_requests[phone] = history

        expires_at = now + settings.otp_ttl_seconds
        _otp_store[phone] = (settings.otp_test_code, expires_at)
        _otp_attempts.pop(phone, None)  # cod nou → contor de încercări resetat
        return

    # LIVE: cod aleator → stocat în Redis cu TTL → trimis prin SMS (Twilio).
    code = _generate_otp_code()
    redis = _get_redis()
    try:
        # Cooldown per telefon / oră: contor în Redis (get/set, compatibil cu
        # clientul real și cu fake-urile din teste). INCR/EXPIRE ar fi mai atomic
        # în prod, dar get/set e suficient și portabil.
        req_key = _OTP_REQ_PREFIX + phone
        raw = await redis.get(req_key)
        count = (int(raw) if raw else 0) + 1
        if count > settings.otp_request_per_hour:
            raise _too_many_requests()
        await redis.set(req_key, str(count), ex=_OTP_REQUEST_WINDOW_SECONDS)

        await redis.set(
            _OTP_REDIS_PREFIX + phone, code, ex=settings.otp_ttl_seconds
        )
        # Cod nou → resetăm contorul de încercări eșuate.
        await redis.delete(_OTP_ATTEMPTS_PREFIX + phone)
    finally:
        # Închidem conexiunea dacă clientul o suportă (fake-urile din teste nu).
        close = getattr(redis, "aclose", None) or getattr(redis, "close", None)
        if close is not None:
            await close()

    await _send_sms(phone, f"Codul tău FLIRT: {code}")


async def verify_otp(phone: str, code: str) -> bool:
    """Verifică un cod OTP pentru un număr de telefon.

    STUB: acceptă `settings.otp_test_code` dacă a fost „solicitat" în prealabil
    și nu a expirat. La succes, consumă codul (o singură utilizare).

    Anti brute-force: după `settings.otp_max_attempts` încercări greșite, codul
    este invalidat — nici măcar cel corect nu mai este acceptat până la o nouă
    cerere OTP.
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
            _otp_attempts.pop(phone, None)
            return False

        if code.strip() == stored_code:
            _otp_store.pop(phone, None)  # single-use
            _otp_attempts.pop(phone, None)
            return True

        # Cod greșit → incrementează contorul; la prag invalidează codul.
        attempts = _otp_attempts.get(phone, 0) + 1
        _otp_attempts[phone] = attempts
        if attempts >= settings.otp_max_attempts:
            _otp_store.pop(phone, None)
            _otp_attempts.pop(phone, None)
        return False

    # LIVE: citim codul din Redis, comparăm și consumăm (single-use).
    key = _OTP_REDIS_PREFIX + phone
    attempts_key = _OTP_ATTEMPTS_PREFIX + phone
    redis = _get_redis()
    try:
        stored_code = await redis.get(key)
        if stored_code is None:
            return False
        if code.strip() == stored_code:
            await redis.delete(key)  # single-use
            await redis.delete(attempts_key)
            return True

        # Cod greșit → incrementează contorul; la prag invalidează codul.
        raw = await redis.get(attempts_key)
        attempts = (int(raw) if raw else 0) + 1
        if attempts >= settings.otp_max_attempts:
            await redis.delete(key)
            await redis.delete(attempts_key)
        else:
            await redis.set(attempts_key, str(attempts), ex=settings.otp_ttl_seconds)
        return False
    finally:
        close = getattr(redis, "aclose", None) or getattr(redis, "close", None)
        if close is not None:
            await close()
