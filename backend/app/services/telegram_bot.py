"""Botul Telegram — poarta de intrare în Mini App (client subțire peste Bot API).

DE CE UN CLIENT SUBȚIRE, NU `aiogram` / `python-telegram-bot`
------------------------------------------------------------
Botul nostru NU are conversații, stări, scene sau comenzi complexe: singurul lui
rol e să DESCHIDĂ Mini App-ul — un buton inline `web_app` și butonul persistent
de meniu — plus câteva comenzi informative (/help, /contacts...) și o poză de bun
venit. O bibliotecă de bot ar aduce un dispatcher, un event loop propriu și
zeci de dependențe pentru câteva apeluri HTTP. Folosim `httpx` (deja
în dependențe, ca la push/billing/auth_providers).

MODUL STUB (`telegram_auth_mode == 'stub'`)
-------------------------------------------
Nu se face NICIUN apel de rețea: se loghează intenția și se întoarce un răspuns
fals `{"ok": True, "stub": True, ...}`. Exact tiparul din `push.StubPush` și din
`auth_providers` — dezvoltarea locală și testele merg fără token real. Același
lucru se întâmplă și în modul `live` dacă tokenul lipsește: degradăm în stub și
logăm, în loc să crăpăm webhookul.

SECRETELE NU AJUNG NICIODATĂ ÎN LOG
----------------------------------
Tokenul face parte din URL-ul Bot API (`/bot<token>/sendMessage`), deci apare
implicit în mesajele de eroare ale `httpx` (care includ URL-ul cererii) și în
orice `repr` al unei cereri. Al doilea secret e `secret_token` din payload-ul
`setWebhook`: exact valoarea pe care o verificăm în antetul
`X-Telegram-Bot-Api-Secret-Token` ca să știm că un update chiar vine de la
Telegram. De aceea TOT ce ajunge într-un log sau într-un mesaj de eroare trece
prin `_redact()` / `_redact_payload()`.

ROBUSTEȚE
---------
Nicio funcție publică nu ridică excepții: un webhook care crapă înseamnă că
Telegram reîncearcă update-ul la nesfârșit. Erorile se loghează și se întorc ca
`{"ok": False, "error": ...}`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from app.core.config import settings

logger = logging.getLogger("app.telegram")

# Baza oficială a Bot API (fără hardcodare la nivel de apel).
TELEGRAM_API_BASE = "https://api.telegram.org"

# Timeout comun pentru apelurile HTTP (secunde), ca la `push`.
_HTTP_TIMEOUT = 10.0
# Încărcarea unei poze (multipart) durează mai mult decât un `sendMessage`.
_UPLOAD_TIMEOUT = 30.0

# Ce punem în locul tokenului în orice text care ajunge într-un log.
_REDACTED = "***REDACTED***"

# Numele parametrului de deep link propagat în URL-ul Mini App-ului.
# Telegram trimite `/start <param>` pentru `https://t.me/<bot>?start=<param>`;
# noi îl mutăm în query-ul Mini App-ului ca aplicația web să-l poată citi.
START_PARAM_QUERY = "startapp"

# Telegram acceptă doar A-Z a-z 0-9 _ - în parametrul de start, max 64 caractere.
# Validăm STRICT: un parametru venit din exterior nu are voie să ajungă brut
# într-un URL (injecție de query params / fragment în URL-ul butonului).
_START_PARAM_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


# --------------------------------------------------------------------------- #
# Configurare (citită la fiecare apel → monkeypatch-ul din teste are efect)
# --------------------------------------------------------------------------- #


def _setting(name: str, default: str = "") -> str:
    """Citește o setare Telegram din `settings`, cu fallback pe `default`.

    `getattr` cu default (și nu acces direct) pentru că setările Telegram sunt
    opționale: o instanță care nu folosește Mini App-ul nu are de ce să le
    declare, iar un `AttributeError` aici ar doborî importul rutei.
    """
    value = getattr(settings, name, default)
    return value if isinstance(value, str) and value else default


def bot_token() -> str:
    """Tokenul botului (gol = neconfigurat). NU se loghează niciodată."""
    return _setting("telegram_bot_token")


def bot_username() -> str:
    """Username-ul botului, fără `@` (folosit în mesaje/instrucțiuni)."""
    return _setting("telegram_bot_username").lstrip("@")


def auth_mode() -> str:
    """Modul de lucru: 'stub' (implicit) sau 'live'."""
    return _setting("telegram_auth_mode", "stub")


def webhook_secret() -> str:
    """Secretul de webhook (antetul `X-Telegram-Bot-Api-Secret-Token`)."""
    return _setting("telegram_webhook_secret")


def miniapp_url() -> str:
    """URL-ul public al Mini App-ului (ce deschide butonul `web_app`)."""
    return _setting("telegram_miniapp_url")


def is_stub() -> bool:
    """True dacă NU trebuie atinsă rețeaua.

    Stub în două situații: modul e explicit 'stub', SAU e 'live' dar tokenul
    lipsește — caz în care degradăm (și logăm) în loc să trimitem cereri care
    oricum ar fi respinse de Telegram.
    """
    if auth_mode() != "live":
        return True
    if not bot_token():
        logger.warning(
            "telegram: mod 'live' fără TELEGRAM_BOT_TOKEN → degradez în stub"
        )
        return True
    return False


# --------------------------------------------------------------------------- #
# Redactare
# --------------------------------------------------------------------------- #


def _redact(text: Any) -> str:
    """Scoate SECRETELE din orice text care pleacă spre log/eroare.

    Două secrete, nu unul:

    1. Tokenul botului — e în URL-ul Bot API, deci apare în mesajele httpx.
    2. Secretul de webhook (`secret_token`) — e în PAYLOAD-ul `setWebhook`, deci
       apare oriunde se loghează payload-ul cererii. E secretul care
       autentifică webhookul: cine îl află poate POST-a update-uri Telegram
       false pe ruta noastră (mesaje și utilizatori fabricați, în numele
       botului). Redactarea acoperea doar (1).

    Secretul de webhook e curățat în DOUĂ feluri, pentru că nu e suficient
    niciunul singur:
      - după VALOAREA din configurație (acoperă textul liber, ex. un mesaj de
        eroare httpx care include corpul cererii);
      - după CHEIA `secret_token` din serializări (acoperă și un secret pasat ca
        argument, diferit de cel din `settings` — rotire de secret, script rulat
        cu altă valoare).
    """
    out = str(text)
    token = bot_token()
    if token:
        out = out.replace(token, _REDACTED)
        # `bot<token>` apare și URL-encodat în unele reprezentări httpx; acoperim
        # și forma fără prefix, apoi tăiem eventualele resturi de segment.
        out = re.sub(r"/bot[^/\s]+/", f"/bot{_REDACTED}/", out)

    secret = webhook_secret()
    if secret:
        out = out.replace(secret, _REDACTED)

    # `"secret_token": "..."`, `'secret_token': '...'`, `secret_token=...`
    out = _SECRET_ASSIGNMENT_RE.sub(lambda m: f"{m.group(1)}{_REDACTED}", out)
    return out


# Cheile de payload al căror CONȚINUT e secret. Redactăm după cheie (nu doar
# după valoarea cunoscută din `settings`), ca un secret pasat ca argument să fie
# acoperit chiar dacă diferă de cel configurat.
_SECRET_PAYLOAD_KEYS = frozenset({"secret_token"})

# Aceleași chei, dar în text deja serializat (JSON sau `repr` de dict).
_SECRET_ASSIGNMENT_RE = re.compile(
    r"""(['"]?(?:%s)['"]?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)"""
    % "|".join(sorted(_SECRET_PAYLOAD_KEYS))
)


def _redact_payload(value: Any) -> Any:
    """Copie a payload-ului cu valorile secrete înlocuite (recursiv).

    NU modifică originalul: payload-ul chiar se trimite la Telegram, doar copia
    ajunge în log / în răspunsul stub.
    """
    if isinstance(value, dict):
        return {
            key: _REDACTED if key in _SECRET_PAYLOAD_KEYS else _redact_payload(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_payload(item) for item in value]
    return value


def _api_url(method: str) -> str:
    """URL-ul complet pentru o metodă Bot API. NU se pune în loguri."""
    return f"{TELEGRAM_API_BASE}/bot{bot_token()}/{method}"


# --------------------------------------------------------------------------- #
# URL-ul Mini App-ului & tastatura
# --------------------------------------------------------------------------- #


def normalize_start_param(raw: str | None) -> str | None:
    """Validează parametrul de deep link; `None` dacă lipsește sau e invalid."""
    if not raw:
        return None
    candidate = raw.strip()
    if not _START_PARAM_RE.match(candidate):
        logger.info("telegram: parametru de start ignorat (format invalid)")
        return None
    return candidate


def build_miniapp_url(start_param: str | None = None) -> str:
    """URL-ul Mini App-ului, cu parametrul de deep link adăugat în query.

    Păstrează query-ul existent al URL-ului configurat (poate conține deja
    `?lang=ro`) și adaugă/suprascrie doar `startapp`.
    """
    base = miniapp_url()
    param = normalize_start_param(start_param)
    if not param or not base:
        return base

    parts = urlsplit(base)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
             if k != START_PARAM_QUERY]
    query.append((START_PARAM_QUERY, param))
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def web_app_button(text: str, start_param: str | None = None) -> dict:
    """Un buton inline `web_app` care deschide Mini App-ul (cu deep link opțional)."""
    return {"text": text, "web_app": {"url": build_miniapp_url(start_param)}}


def web_app_keyboard(text: str, start_param: str | None = None) -> dict:
    """Tastatură inline cu UN buton `web_app` care deschide Mini App-ul."""
    return {
        "inline_keyboard": [
            [{"text": text, "web_app": {"url": build_miniapp_url(start_param)}}]
        ]
    }


# --------------------------------------------------------------------------- #
# Apelul propriu-zis
# --------------------------------------------------------------------------- #


async def _call(method: str, payload: dict) -> dict:
    """Trimite o metodă Bot API. Nu ridică niciodată; întoarce mereu un dict.

    STUB: loghează intenția și întoarce `{"ok": True, "stub": True, ...}`.
    LIVE: POST JSON, cu erorile logate REDACTAT și întoarse ca `ok: False`.
    """
    if is_stub():
        # Payload-ul se loghează ÎNTREG. `setWebhook` îl are pe `secret_token`
        # în el — deci trece prin redactare înainte de log ȘI înainte de a fi
        # întors apelantului (care îl poate tipări mai departe: vezi
        # `scripts/setup_telegram_bot.py`).
        safe_payload = _redact_payload(payload)
        logger.info("STUB telegram -> %s payload=%s", method, _redact(repr(safe_payload)))
        return {"ok": True, "stub": True, "method": method, "payload": safe_payload}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as http:
            resp = await http.post(_api_url(method), json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        return _status_error(method, exc)
    except httpx.HTTPError as exc:
        # `str(exc)` conține URL-ul cererii → tokenul. Redactăm ÎNAINTE de log.
        message = _redact(exc)
        logger.warning("telegram: apelul %s a eșuat: %s", method, message)
        return {"ok": False, "method": method, "error": message}
    except ValueError as exc:  # răspuns care nu e JSON valid
        message = _redact(exc)
        logger.warning("telegram: răspuns invalid la %s: %s", method, message)
        return {"ok": False, "method": method, "error": message}

    return _checked(method, data)


def _checked(method: str, data: Any) -> dict:
    """Loghează (redactat) un răspuns `ok: false` și garantează un dict."""
    if isinstance(data, dict) and not data.get("ok", False):
        logger.warning(
            "telegram: %s respins de API: %s", method, _redact(data.get("description"))
        )
    return data if isinstance(data, dict) else {"ok": False, "method": method}


def _status_error(method: str, exc: httpx.HTTPStatusError) -> dict:
    """Răspuns non-2xx: Telegram trimite totuși JSON cu `error_code`/`description`.

    Le păstrăm (redactate) — apelantul are nevoie de ele ca să distingă, de ex.,
    o metodă inexistentă (404 „Not Found") de o cerere greșită (400).
    """
    out: dict = {"ok": False, "method": method, "error": _redact(exc)}
    response = getattr(exc, "response", None)
    try:
        body = response.json() if response is not None else None
    except Exception:  # corp gol / non-JSON
        body = None
    if isinstance(body, dict):
        if "error_code" in body:
            out["error_code"] = body.get("error_code")
        if body.get("description"):
            out["description"] = _redact(body.get("description"))
    elif response is not None and getattr(response, "status_code", None):
        out["error_code"] = response.status_code
    logger.warning(
        "telegram: apelul %s a eșuat: %s", method, out.get("description") or out["error"]
    )
    return out


async def _call_multipart(
    method: str, data: dict, files: dict[str, tuple[str, bytes, str]]
) -> dict:
    """Ca `_call`, dar `multipart/form-data` — pentru încărcarea unui fișier.

    Câmpurile ne-text (tastatura, obiectele) se serializează JSON, cum cere Bot API
    pentru multipart. În stub nu se citește/trimite nimic.
    """
    fields = {
        key: value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        for key, value in data.items()
        if value is not None
    }
    if is_stub():
        logger.info(
            "STUB telegram -> %s (multipart) fields=%s files=%s",
            method,
            _redact(repr(_redact_payload(fields))),
            sorted(files),
        )
        return {"ok": True, "stub": True, "method": method, "payload": _redact_payload(fields)}

    try:
        async with httpx.AsyncClient(timeout=_UPLOAD_TIMEOUT) as http:
            resp = await http.post(_api_url(method), data=fields, files=files)
            resp.raise_for_status()
            body = resp.json()
    except httpx.HTTPStatusError as exc:
        return _status_error(method, exc)
    except httpx.HTTPError as exc:
        message = _redact(exc)
        logger.warning("telegram: apelul %s a eșuat: %s", method, message)
        return {"ok": False, "method": method, "error": message}
    except ValueError as exc:
        message = _redact(exc)
        logger.warning("telegram: răspuns invalid la %s: %s", method, message)
        return {"ok": False, "method": method, "error": message}
    return _checked(method, body)


# --------------------------------------------------------------------------- #
# API public
# --------------------------------------------------------------------------- #


async def send_message(
    chat_id: int | str,
    text: str,
    reply_markup: dict | None = None,
    parse_mode: str | None = None,
    disable_preview: bool = False,
) -> dict:
    """`sendMessage` — trimite un mesaj, opțional cu tastatură / HTML."""
    payload: dict = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if disable_preview:
        payload["link_preview_options"] = {"is_disabled": True}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _call("sendMessage", payload)


async def send_photo(
    chat_id: int | str,
    photo: str,
    caption: str | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = None,
) -> dict:
    """`sendPhoto` cu o poză deja cunoscută de Telegram (`file_id`) sau un URL."""
    payload: dict = {"chat_id": chat_id, "photo": photo}
    if caption:
        payload["caption"] = caption
    if parse_mode:
        payload["parse_mode"] = parse_mode
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _call("sendPhoto", payload)


async def upload_photo(
    chat_id: int | str,
    path: Path,
    caption: str | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = None,
) -> dict:
    """`sendPhoto` cu încărcarea fișierului local (multipart)."""
    data = {
        "chat_id": str(chat_id),
        "caption": caption,
        "parse_mode": parse_mode,
        "reply_markup": reply_markup,
    }
    if is_stub():
        return await _call_multipart("sendPhoto", data, {"photo": (path.name, b"", "image/png")})
    try:
        content = path.read_bytes()
    except OSError as exc:
        logger.warning("telegram: nu pot citi poza %s: %s", path.name, exc)
        return {"ok": False, "method": "sendPhoto", "error": "asset lipsă"}
    return await _call_multipart("sendPhoto", data, {"photo": (path.name, content, "image/png")})


# --------------------------------------------------------------------------- #
# Poza de bun venit + memorarea `file_id`
# --------------------------------------------------------------------------- #
#
# Prima trimitere ÎNCARCĂ fișierul (multipart, ~400 KB); Telegram întoarce un
# `file_id` cu care orice trimitere ulterioară e un simplu JSON de câțiva octeți.
# `file_id` e specific BOTULUI, deci cheia conține id-ul botului (partea publică
# a tokenului, dinaintea `:` — nu e secret) și o amprentă a fișierului: o imagine
# regenerată ⇒ altă cheie ⇒ reîncărcare automată.
#
# Memorie (per proces) + Redis (comun tuturor workerilor, supraviețuiește
# repornirii). Redis e opțional: indisponibil ⇒ doar memorie, fără erori.

ASSETS_DIR = Path(__file__).resolve().parent.parent / "assets" / "bot"
WELCOME_IMAGE = ASSETS_DIR / "welcome.png"
AVATAR_IMAGE = ASSETS_DIR / "avatar.png"

FILE_ID_CACHE_PREFIX = "telegram:file_id:"
FILE_ID_CACHE_TTL_SECONDS = 90 * 24 * 3600
_REDIS_TIMEOUT_SECONDS = 1.0

_file_id_cache: dict[str, str] = {}


def _bot_id() -> str:
    return bot_token().split(":", 1)[0] or "nobot"


def _file_fingerprint(path: Path) -> str:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:16]
    except OSError:
        return "missing"


def file_id_cache_key(path: Path) -> str:
    return f"{FILE_ID_CACHE_PREFIX}{_bot_id()}:{path.stem}:{_file_fingerprint(path)}"


async def _get_redis():
    """Client Redis NOU (închis de apelant), sau `None` dacă nu e configurat.

    Client nou la fiecare folosire: cache-ul din memorie face ca Redis să fie
    atins doar la prima poză per proces, iar un client partajat ar rămâne legat
    de event loop-ul în care a fost creat.
    """
    url = getattr(settings, "redis_url", "") or ""
    if not url:
        return None
    import redis.asyncio as aioredis  # import lazy (dependență opțională)

    return aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=_REDIS_TIMEOUT_SECONDS,
        socket_timeout=_REDIS_TIMEOUT_SECONDS,
    )


async def _redis_op(op: str, key: str, value: str | None = None) -> str | None:
    """get / set / delete în Redis; orice eroare ⇒ `None`, fără excepții."""
    client = None
    try:
        client = await _get_redis()
        if client is None:
            return None
        if op == "get":
            return await client.get(key)
        if op == "set":
            await client.set(key, value, ex=FILE_ID_CACHE_TTL_SECONDS)
        elif op == "delete":
            await client.delete(key)
    except Exception as exc:  # Redis căzut nu are voie să strice botul
        logger.info("telegram: cache file_id indisponibil (%s)", type(exc).__name__)
    finally:
        if client is not None:
            try:
                await client.aclose()
            except Exception:
                pass
    return None


async def cached_file_id(key: str) -> str | None:
    if key in _file_id_cache:
        return _file_id_cache[key]
    value = await _redis_op("get", key)
    if value:
        _file_id_cache[key] = value
    return value or None


async def remember_file_id(key: str, file_id: str) -> None:
    _file_id_cache[key] = file_id
    await _redis_op("set", key, file_id)


async def forget_file_id(key: str) -> None:
    _file_id_cache.pop(key, None)
    await _redis_op("delete", key)


def _photo_file_id(result: dict) -> str | None:
    """`file_id`-ul celei mai mari variante din răspunsul `sendPhoto`."""
    message = result.get("result") if isinstance(result, dict) else None
    sizes = message.get("photo") if isinstance(message, dict) else None
    if isinstance(sizes, list) and sizes and isinstance(sizes[-1], dict):
        file_id = sizes[-1].get("file_id")
        return file_id if isinstance(file_id, str) and file_id else None
    return None


async def send_cached_photo(
    chat_id: int | str,
    path: Path,
    caption: str | None = None,
    reply_markup: dict | None = None,
    parse_mode: str | None = None,
) -> dict:
    """Trimite poza locală `path`, refolosind `file_id` memorat când există.

    `file_id` memorat dar respins (bot schimbat, fișier expirat) ⇒ îl uităm și
    reîncărcăm o singură dată. Întoarce rezultatul ultimului apel; apelantul
    decide fallback-ul (ex. mesaj text) dacă `ok` e fals.
    """
    key = file_id_cache_key(path)
    file_id = await cached_file_id(key)
    if file_id:
        result = await send_photo(chat_id, file_id, caption, reply_markup, parse_mode)
        if result.get("ok"):
            return result
        logger.info("telegram: file_id memorat respins → reîncarc poza")
        await forget_file_id(key)

    result = await upload_photo(chat_id, path, caption, reply_markup, parse_mode)
    if result.get("ok") and not result.get("stub"):
        new_id = _photo_file_id(result)
        if new_id:
            await remember_file_id(key, new_id)
    return result


async def answer_callback_query(callback_query_id: str, text: str | None = None) -> dict:
    """`answerCallbackQuery` — oprește „ceasul" de pe butonul apăsat."""
    payload: dict = {"callback_query_id": callback_query_id}
    if text:
        payload["text"] = text
    return await _call("answerCallbackQuery", payload)


# Tipurile de update de care are nevoie webhookul (mesaje + butoane callback).
ALLOWED_UPDATES = ["message", "callback_query"]


async def set_webhook(url: str, secret_token: str) -> dict:
    """`setWebhook` — înregistrează URL-ul de webhook + secretul de antet.

    `secret_token` ajunge la noi în `X-Telegram-Bot-Api-Secret-Token`; fără el,
    oricine ar putea POST-a update-uri false pe rută. `allowed_updates` explicit:
    altfel Telegram păstrează lista setată anterior (care poate să nu includă
    `callback_query` → butoanele „Ajutor"/„Contacte" n-ar răspunde).
    """
    payload: dict = {"url": url, "allowed_updates": list(ALLOWED_UPDATES)}
    if secret_token:
        payload["secret_token"] = secret_token
    return await _call("setWebhook", payload)


async def get_webhook_info() -> dict:
    """`getWebhookInfo` — URL-ul curent, `allowed_updates`, ultima eroare."""
    return await _call("getWebhookInfo", {})


async def get_me() -> dict:
    return await _call("getMe", {})


def _lang_payload(payload: dict, language_code: str | None) -> dict:
    if language_code:
        payload["language_code"] = language_code
    return payload


async def set_my_commands(
    commands: list[tuple[str, str]],
    scope: dict | None = None,
    language_code: str | None = None,
) -> dict:
    payload: dict = {
        "commands": [{"command": c, "description": d} for c, d in commands]
    }
    if scope:
        payload["scope"] = scope
    return await _call("setMyCommands", _lang_payload(payload, language_code))


async def get_my_description(language_code: str | None = None) -> dict:
    return await _call("getMyDescription", _lang_payload({}, language_code))


async def set_my_description(description: str, language_code: str | None = None) -> dict:
    return await _call(
        "setMyDescription", _lang_payload({"description": description}, language_code)
    )


async def get_my_short_description(language_code: str | None = None) -> dict:
    return await _call("getMyShortDescription", _lang_payload({}, language_code))


async def set_my_short_description(
    short_description: str, language_code: str | None = None
) -> dict:
    return await _call(
        "setMyShortDescription",
        _lang_payload({"short_description": short_description}, language_code),
    )


async def get_my_name(language_code: str | None = None) -> dict:
    return await _call("getMyName", _lang_payload({}, language_code))


async def set_my_name(name: str, language_code: str | None = None) -> dict:
    return await _call("setMyName", _lang_payload({"name": name}, language_code))


async def set_my_profile_photo(path: Path) -> dict:
    """`setMyProfilePhoto` — poza de profil a botului (metodă nouă în Bot API).

    Parametrul `photo` e un `InputProfilePhotoStatic` care trimite la fișierul
    atașat (`attach://`). Dacă serverul Bot API nu cunoaște metoda, întoarce
    404 „Not Found" — apelantul (scriptul de setup) arată atunci pașii manuali
    din @BotFather.
    """
    data = {"photo": {"type": "static", "photo": "attach://avatar"}}
    if is_stub():
        return await _call_multipart("setMyProfilePhoto", data, {"avatar": (path.name, b"", "image/png")})
    try:
        content = path.read_bytes()
    except OSError as exc:
        return {"ok": False, "method": "setMyProfilePhoto", "error": f"nu pot citi {path.name}: {exc}"}
    return await _call_multipart(
        "setMyProfilePhoto", data, {"avatar": (path.name, content, "image/png")}
    )


async def delete_webhook() -> dict:
    """`deleteWebhook` — oprește livrarea update-urilor (ex. la dezinstalare)."""
    return await _call("deleteWebhook", {"drop_pending_updates": False})


async def set_chat_menu_button(url: str, text: str) -> dict:
    """`setChatMenuButton` — butonul persistent care deschide Mini App-ul.

    Fără `chat_id` → se aplică implicit TUTUROR chat-urilor private ale botului.
    """
    return await _call(
        "setChatMenuButton",
        {"menu_button": {"type": "web_app", "text": text, "web_app": {"url": url}}},
    )
