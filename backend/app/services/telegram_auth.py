"""Verificarea `initData` trimis de un Telegram Mini App (TZ 2.1 — canal nou).

CUM SE AUTENTIFICĂ UN MINI APP
------------------------------
Mini App-ul NU primește un `id_token` OIDC, ca Apple/Google. Telegram îi dă
clientului un query-string (`window.Telegram.WebApp.initData`) care conține
datele userului și un câmp `hash`. Hash-ul e un HMAC-SHA256 calculat de Telegram
peste celelalte câmpuri, cu o cheie derivată din TOKENUL BOTULUI:

    secret_key = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
    hash       = HMAC_SHA256(key=secret_key,   msg=data_check_string)

ATENȚIE la ordinea argumentelor în derivarea cheii: constanta `WebAppData` este
CHEIA, iar tokenul botului este MESAJUL. Inversarea celor două (greșeala clasică,
fiindcă „secretul" pare să fie tokenul) produce o funcție care se auto-validează
perfect în teste scrise cu aceeași greșeală, dar respinge ORICE initData real de
la Telegram. De aceea testele din `tests/test_auth_telegram.py` semnează cu
algoritmul corect, nu prin refolosirea funcției de aici.

`data_check_string` = toate câmpurile EXCEPTÂND `hash` și `signature`, sortate
alfabetic după cheie, în forma `cheie=valoare`, unite cu `\n`. `signature` e
semnătura Ed25519 (validare de către terți) adăugată ulterior de Telegram și NU
face parte din șirul verificat cu HMAC — dacă o includem, orice initData modern
e respins.

MODUL 'stub' (dev/teste) sare peste verificarea de hash, exact ca
`auth_providers._decode_stub_token` pentru Google/Apple. Este refuzat în
producție de garda din `app/core/config.py` și, defensiv, și aici.
"""
from __future__ import annotations

import binascii
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import parse_qsl

from fastapi import HTTPException, status

from app.core import ratelimit
from app.core.config import settings

log = logging.getLogger("app.telegram_auth")

# Constanta de derivare impusă de protocolul Telegram (Mini Apps).
_WEBAPP_DATA = b"WebAppData"

# Câmpuri care NU intră în `data_check_string` (vezi docstring-ul modulului).
_EXCLUDED_FIELDS = frozenset({"hash", "signature"})

# Marjă de ceas acceptată pentru un `auth_date` „din viitor": serverul nostru și
# serverele Telegram pot fi desincronizate cu câteva secunde. Peste marjă,
# datele sunt fabricate (cineva încearcă să-și prelungească fereastra de
# valabilitate), deci le respingem.
_CLOCK_SKEW_SECONDS = 60

# Prefix de namespace în Redis pentru hash-urile deja consumate (anti-replay).
# Distinct de `rl:` (rate limiting) și de `otp:` (coduri OTP).
_REPLAY_PREFIX = "tg_initdata:"


# ---------------------------------------------------------------------------
# Excepții — toate 401, cu mesaj generic (fără detalii criptografice)
# ---------------------------------------------------------------------------


class TelegramAuthError(HTTPException):
    """Bază pentru eșecurile de verificare a `initData`.

    Subclase DISTINCTE ca apelantul (și testele) să poată deosebi cauza, dar cu
    același contract HTTP ca la Apple/Google din `auth_providers`: 401 și un
    `detail` generic. NU scurgem niciodată către client ce anume n-a corespuns
    (hash, lungime, câmp) — ar fi un oracol pentru cineva care încearcă să
    fabrice initData.
    """

    message = "Invalid Telegram init data"

    def __init__(self, detail: str | None = None) -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail or self.message,
        )


class InvalidInitDataSignature(TelegramAuthError):
    """Hash lipsă sau care nu corespunde semnăturii calculate cu bot token-ul."""

    message = "Invalid Telegram init data signature"


class ExpiredInitData(TelegramAuthError):
    """`auth_date` lipsă, nenumeric, prea vechi sau plasat în viitor."""

    message = "Telegram init data expired"


class MalformedInitData(TelegramAuthError):
    """Query-string neparsabil, sau câmpul `user` lipsă / JSON corupt / fără `id`."""

    message = "Malformed Telegram init data"


class ReplayedInitData(TelegramAuthError):
    """Același `initData` prezentat a doua oară (replay)."""

    message = "Telegram init data already used"


def _not_configured() -> HTTPException:
    """Login Telegram cerut, dar imposibil de deservit în siguranță (503).

    NU e 401: nu userul a greșit, ci configurarea serverului. Un 401 ar trimite
    clientul să reîncerce la nesfârșit ceva ce nu poate reuși niciodată.
    """
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Telegram login is not configured",
    )


# ---------------------------------------------------------------------------
# Tipuri
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class TelegramUser:
    """Userul din câmpul `user` al lui `initData` (JSON), tipizat.

    Doar `id` e garantat de Telegram; restul depind de setările de
    confidențialitate ale contului, deci sunt opționale.
    """

    id: int
    first_name: str | None = None
    last_name: str | None = None
    username: str | None = None
    language_code: str | None = None
    photo_url: str | None = None
    is_premium: bool = False


@dataclass(frozen=True, slots=True)
class TelegramInitData:
    """Rezultatul verificării: userul + metadatele utile ale cererii."""

    user: TelegramUser
    auth_date: datetime
    hash: str
    query_id: str | None = None
    chat_type: str | None = None
    start_param: str | None = None


# ---------------------------------------------------------------------------
# Verificare
# ---------------------------------------------------------------------------


def _build_data_check_string(fields: dict[str, str]) -> str:
    """`cheie=valoare` sortate alfabetic, unite cu `\\n` (fără hash/signature)."""
    return "\n".join(
        f"{key}={fields[key]}"
        for key in sorted(fields)
        if key not in _EXCLUDED_FIELDS
    )


def _expected_hash(data_check_string: str, bot_token: str) -> str:
    """Hash-ul pe care TREBUIE să-l aibă `data_check_string` pentru acest bot.

    Ordinea argumentelor e esențială: `WebAppData` e CHEIA, tokenul e MESAJUL.

    Tokenul se curăță de spații ÎNCĂ O DATĂ aici, pe lângă curățarea din
    configurare: un secret e valoarea lui, nu formatarea fișierului din care a
    fost citit. Un singur „\n" invizibil ar intra ca octet în derivarea cheii și
    ar respinge TOATE datele reale ca „semnătură invalidă", în timp ce orice test
    semnat cu aceeași valoare murdară ar trece — un defect aproape imposibil de
    depistat din simptome.
    """
    secret_key = hmac.new(
        key=_WEBAPP_DATA, msg=bot_token.strip().encode(), digestmod=hashlib.sha256
    ).digest()
    return hmac.new(
        key=secret_key,
        msg=data_check_string.encode(),
        digestmod=hashlib.sha256,
    ).hexdigest()


def _parse_fields(init_data: str) -> dict[str, str]:
    """Parsează query-string-ul `initData` în perechi cheie→valoare decodate."""
    raw = (init_data or "").strip()
    if not raw:
        raise MalformedInitData()
    try:
        # `strict_parsing=True`: un șir care nu e un query-string valid trebuie
        # respins explicit, nu tăcut redus la un dicționar gol.
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeDecodeError) as exc:
        raise MalformedInitData() from exc
    return dict(pairs)


def _parse_user(raw_user: str | None) -> TelegramUser:
    """Decodează câmpul `user` (JSON) în `TelegramUser`; `id` e obligatoriu."""
    if not raw_user:
        raise MalformedInitData()
    try:
        payload = json.loads(raw_user)
    except (json.JSONDecodeError, ValueError) as exc:
        raise MalformedInitData() from exc
    if not isinstance(payload, dict):
        raise MalformedInitData()

    try:
        # `id` poate veni ca int sau ca string numeric; un bool NU e un id valid
        # (`isinstance(True, int)` e adevărat în Python — de-aia verificarea).
        raw_id = payload.get("id")
        if isinstance(raw_id, bool) or raw_id is None:
            raise MalformedInitData()
        telegram_id = int(raw_id)
    except (TypeError, ValueError) as exc:
        raise MalformedInitData() from exc
    if telegram_id <= 0:
        raise MalformedInitData()

    def _text(key: str) -> str | None:
        value = payload.get(key)
        return str(value) if isinstance(value, (str, int)) and value != "" else None

    return TelegramUser(
        id=telegram_id,
        first_name=_text("first_name"),
        last_name=_text("last_name"),
        username=_text("username"),
        language_code=_text("language_code"),
        photo_url=_text("photo_url"),
        is_premium=bool(payload.get("is_premium", False)),
    )


def _parse_auth_date(raw_auth_date: str | None, max_age_seconds: int) -> datetime:
    """Validează `auth_date` (epoch secunde) și îl întoarce ca datetime UTC."""
    if not raw_auth_date:
        raise ExpiredInitData()
    try:
        auth_epoch = int(raw_auth_date)
    except (TypeError, ValueError) as exc:
        raise ExpiredInitData() from exc

    now = int(time.time())
    if auth_epoch > now + _CLOCK_SKEW_SECONDS:
        # Datat în viitor = fabricat, ca să prelungească fereastra de valabilitate.
        raise ExpiredInitData()
    if max_age_seconds > 0 and now - auth_epoch > max_age_seconds:
        raise ExpiredInitData()

    try:
        return datetime.fromtimestamp(auth_epoch, tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise ExpiredInitData() from exc


def _build(fields: dict[str, str], *, auth_date: datetime, hash_hex: str) -> TelegramInitData:
    """Asamblează rezultatul din câmpurile deja validate."""
    return TelegramInitData(
        user=_parse_user(fields.get("user")),
        auth_date=auth_date,
        hash=hash_hex,
        query_id=fields.get("query_id"),
        chat_type=fields.get("chat_type"),
        start_param=fields.get("start_param"),
    )


def _verify_stub(init_data: str) -> TelegramInitData:
    """Acceptă un `initData` de TEST, fără verificare de hash (dev/teste).

    Formate acceptate (analog cu `auth_providers._decode_stub_token`):
      - `stub:123456789`             — doar id-ul de Telegram;
      - `stub:123456789:nume_user`   — id + username;
      - un initData real, dar NEVERIFICAT (se citește doar câmpul `user`).

    `auth_date` devine „acum", iar `hash` e un nonce PROASPĂT la fiecare apel —
    NU hash-ul primit și nici unul derivat din id. Altfel protecția anti-replay
    (care nu are ce apăra în stub: nu există semnătură de furat) ar bloca al
    doilea login de test pentru 24 de ore, adică dev-ul ar putea intra în
    aplicație o singură dată pe zi. Stub-ul rămâne repetabil, exact ca
    `_decode_stub_token` pentru Google/Apple.
    """
    if settings.environment == "production":
        # Plasă de siguranță peste garda din config: dacă cineva ar ocoli-o,
        # stub-ul NU are voie să autentifice pe nimeni în producție.
        log.error("telegram: modul 'stub' este refuzat în producție")
        raise _not_configured()

    raw = (init_data or "").strip()
    if raw.startswith("stub:"):
        parts = raw[len("stub:") :].split(":")
        try:
            telegram_id = int(parts[0])
        except (IndexError, ValueError) as exc:
            raise MalformedInitData() from exc
        username = parts[1] if len(parts) > 1 and parts[1] else None
        fields = {
            "user": json.dumps(
                {"id": telegram_id, "username": username, "first_name": username},
                separators=(",", ":"),
            ),
            "auth_date": str(int(time.time())),
        }
    else:
        fields = _parse_fields(raw)

    return _build(
        fields,
        auth_date=datetime.now(timezone.utc),
        hash_hex=secrets.token_hex(32),  # nonce, aceeași formă ca un hash real
    )


def verify_init_data(
    init_data: str, *, bot_token: str, max_age_seconds: int
) -> TelegramInitData:
    """Verifică `initData` și întoarce datele tipizate; 401 la orice eșec.

    În modul 'stub' se acceptă un initData de test, fără criptografie (vezi
    `_verify_stub`). În 'live' se verifică, în ordine: semnătura HMAC, apoi
    `auth_date`, apoi câmpul `user`.

    Ordinea NU e întâmplătoare: nu ne atingem de conținut înainte să știm că e
    semnat de Telegram. Un `user` JSON nesemnat n-are de ce să fie parsat.
    """
    if settings.telegram_auth_mode == "stub":
        return _verify_stub(init_data)

    if not bot_token:
        # 'live' fără token = nu putem verifica nimic. Garda din config oprește
        # asta la pornire în producție; aici acoperim dev/staging.
        log.error("telegram: TELEGRAM_AUTH_MODE=live fără TELEGRAM_BOT_TOKEN")
        raise _not_configured()

    fields = _parse_fields(init_data)

    received_hash = fields.get("hash", "")
    # Hash-ul e 64 de caractere hex; orice altceva nu poate proveni de la Telegram.
    if len(received_hash) != 64:
        raise InvalidInitDataSignature()
    try:
        binascii.unhexlify(received_hash)
    except (binascii.Error, ValueError) as exc:
        raise InvalidInitDataSignature() from exc

    expected = _expected_hash(_build_data_check_string(fields), bot_token)
    # `compare_digest`: comparație în timp constant (fără oracol de timing).
    if not hmac.compare_digest(expected, received_hash.lower()):
        _diagnose_signature_mismatch(init_data, fields, received_hash, bot_token)
        raise InvalidInitDataSignature()

    auth_date = _parse_auth_date(fields.get("auth_date"), max_age_seconds)
    return _build(fields, auth_date=auth_date, hash_hex=received_hash.lower())


# ---------------------------------------------------------------------------
# Anti-replay
# ---------------------------------------------------------------------------
#
# Semnătura dovedește că datele vin de la Telegram, NU că cererea e proaspătă:
# `initData` e valabil `max_age_seconds` (24h implicit) și e retrimis identic la
# fiecare deschidere a Mini App-ului. Cine îl interceptează o dată (log de proxy,
# extensie de browser, screenshot de la depanare) se poate loga ca victima
# oricând în fereastra aia. De-aia fiecare `hash` se consumă O SINGURĂ DATĂ.
#
# Store: Redis (partajat între workeri gunicorn și între instanțe), cu degradare
# la un store in-memory — EXACT tiparul din `app/core/ratelimit.py`. „Degradare"
# înseamnă protecție aproximativă (per proces), nu protecție zero: un Redis
# căzut nu are voie să transforme replay-ul în ceva permis.


class _InMemoryReplayGuard:
    """Set de hash-uri consumate, cu expirare — fallback thread-safe, per proces."""

    def __init__(self) -> None:
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def claim(self, key: str, ttl_seconds: float) -> bool:
        """True dacă `key` e folosit prima dată; False dacă e un replay."""
        now = time.monotonic()
        with self._lock:
            # Curățăm intrările expirate (store-ul rămâne mărginit fără cron).
            if self._seen:
                expired = [k for k, exp in self._seen.items() if exp <= now]
                for k in expired:
                    del self._seen[k]
            if key in self._seen:
                return False
            self._seen[key] = now + max(1.0, ttl_seconds)
            return True

    def reset(self) -> None:
        with self._lock:
            self._seen.clear()


_replay_guard = _InMemoryReplayGuard()


def reset_replay_state() -> None:
    """Golește store-ul in-memory de hash-uri consumate (util în teste)."""
    _replay_guard.reset()


def _get_redis():
    """Clientul Redis AL RATE-LIMITER-ULUI (`app/core/ratelimit.py`), sau None.

    Refolosim conexiunea existentă în loc să deschidem un al doilea pool către
    același Redis: aceleași timeout-uri scurte, aceeași reconectare, un singur
    loc unde se configurează URL-ul. Întoarce None dacă `REDIS_URL` nu e setat
    (dev/teste) — apelantul cade pe store-ul in-memory.
    """
    limiter = ratelimit._get_redis_limiter()
    if limiter is None:
        return None
    return limiter._get_client()


async def claim_init_data(data: TelegramInitData, *, ttl_seconds: int) -> None:
    """Consumă `data.hash` o singură dată; ridică `ReplayedInitData` la reluare.

    TTL-ul = fereastra de valabilitate a lui `initData`: după expirare, cheia nu
    mai e necesară, fiindcă `auth_date` respinge oricum datele vechi.
    """
    ttl = max(1, int(ttl_seconds))
    key = _REPLAY_PREFIX + data.hash

    client = _get_redis()
    if client is not None:
        try:
            # SET NX EX: „scrie doar dacă nu există" — atomic, deci două cereri
            # concurente cu același initData nu pot trece amândouă.
            created = await client.set(key, "1", ex=ttl, nx=True)
            if not created:
                raise ReplayedInitData()
            return
        except ReplayedInitData:
            raise
        except Exception as exc:
            # Fără date sensibile în log: doar tipul erorii.
            log.warning(
                "telegram anti-replay: Redis indisponibil, cad pe store-ul in-memory",
                extra={"error_type": type(exc).__name__},
            )
            ratelimit.reset_backend()  # forțăm reconectarea la următoarea cerere

    if not _replay_guard.claim(key, ttl):
        raise ReplayedInitData()


# ---------------------------------------------------------------------------
# Diagnostic TEMPORAR pentru nepotrivirea de semnătură
# ---------------------------------------------------------------------------
#
# Se activează doar cu TELEGRAM_DEBUG_SIGNATURE=1 în mediu. Loghează NUMELE
# câmpurilor și care variantă de calcul s-ar fi potrivit — NICIODATĂ valorile,
# tokenul sau hash-urile întregi. Scopul e să deosebim, fără să ghicim:
#   - alt bot a semnat datele (nicio variantă nu se potriveşte);
#   - o greşeală de parsare la noi (o variantă se potriveşte).
# De șters după ce cauza e stabilită.


def _diagnose_signature_mismatch(
    init_data: str, fields: dict[str, str], received_hash: str, bot_token: str
) -> None:
    if os.getenv("TELEGRAM_DEBUG_SIGNATURE") != "1":
        return
    try:
        from urllib.parse import parse_qsl as _pq

        target = received_hash.lower()
        variants: dict[str, str] = {}

        # 1. Referinţa actuală.
        variants["actual"] = _expected_hash(_build_data_check_string(fields), bot_token)

        # 2. Fără excluderea lui `signature`.
        only_hash = {k: v for k, v in fields.items() if k != "hash"}
        variants["include_signature"] = _expected_hash(
            "\n".join(f"{k}={v}" for k, v in sorted(only_hash.items())), bot_token
        )

        # 3. Valori NEdecodate (unii clienţi trimit deja decodat).
        rawp = dict(_pq(init_data, keep_blank_values=True))
        raw_pairs = [
            (k, v)
            for k, v in (
                pair.split("=", 1) for pair in init_data.split("&") if "=" in pair
            )
            if k not in _EXCLUDED_FIELDS
        ]
        variants["undecoded"] = _expected_hash(
            "\n".join(f"{k}={v}" for k, v in sorted(raw_pairs)), bot_token
        )

        # 4. Fără conversia `+` în spaţiu.
        noplus = {
            k: v.replace(" ", "+") for k, v in fields.items() if k not in _EXCLUDED_FIELDS
        }
        variants["plus_preserved"] = _expected_hash(
            "\n".join(f"{k}={v}" for k, v in sorted(noplus.items())), bot_token
        )

        matched = [name for name, h in variants.items() if hmac.compare_digest(h, target)]
        log.warning(
            "Diagnostic semnatura Telegram",
            extra={
                "campuri": sorted(fields.keys()),
                "numar_campuri": len(fields),
                "are_signature": "signature" in fields,
                "varianta_potrivita": matched or "niciuna",
                "lungime_initdata": len(init_data),
                "lungime_user": len(fields.get("user", "")),
                "rawp_egal_fields": rawp.keys() == fields.keys(),
            },
        )
    except Exception:  # diagnosticul nu are voie să schimbe comportamentul
        log.warning("Diagnostic semnatura Telegram: esuat", exc_info=False)
