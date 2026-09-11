"""Botul Telegram — poarta de intrare în Mini App (client subțire peste Bot API).

DE CE UN CLIENT SUBȚIRE, NU `aiogram` / `python-telegram-bot`
------------------------------------------------------------
Botul nostru NU are conversații, stări, scene sau comenzi complexe: singurul lui
rol e să DESCHIDĂ Mini App-ul — un buton inline `web_app` și butonul persistent
de meniu. O bibliotecă de bot ar aduce un dispatcher, un event loop propriu și
zeci de dependențe pentru, în total, patru apeluri HTTP. Folosim `httpx` (deja
în dependențe, ca la push/billing/auth_providers).

MODUL STUB (`telegram_auth_mode == 'stub'`)
-------------------------------------------
Nu se face NICIUN apel de rețea: se loghează intenția și se întoarce un răspuns
fals `{"ok": True, "stub": True, ...}`. Exact tiparul din `push.StubPush` și din
`auth_providers` — dezvoltarea locală și testele merg fără token real. Același
lucru se întâmplă și în modul `live` dacă tokenul lipsește: degradăm în stub și
logăm, în loc să crăpăm webhookul.

TOKENUL NU AJUNGE NICIODATĂ ÎN LOG
----------------------------------
Tokenul face parte din URL-ul Bot API (`/bot<token>/sendMessage`), deci apare
implicit în mesajele de eroare ale `httpx` (care includ URL-ul cererii) și în
orice `repr` al unei cereri. De aceea TOT ce ajunge într-un log sau într-un
mesaj de eroare trece prin `_redact()`.

ROBUSTEȚE
---------
Nicio funcție publică nu ridică excepții: un webhook care crapă înseamnă că
Telegram reîncearcă update-ul la nesfârșit. Erorile se loghează și se întorc ca
`{"ok": False, "error": ...}`.
"""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from app.core.config import settings

logger = logging.getLogger("app.telegram")

# Baza oficială a Bot API (fără hardcodare la nivel de apel).
TELEGRAM_API_BASE = "https://api.telegram.org"

# Timeout comun pentru apelurile HTTP (secunde), ca la `push`.
_HTTP_TIMEOUT = 10.0

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
    """Scoate tokenul botului din orice text care pleacă spre log/eroare."""
    out = str(text)
    token = bot_token()
    if token:
        out = out.replace(token, _REDACTED)
        # `bot<token>` apare și URL-encodat în unele reprezentări httpx; acoperim
        # și forma fără prefix, apoi tăiem eventualele resturi de segment.
        out = re.sub(r"/bot[^/\s]+/", f"/bot{_REDACTED}/", out)
    return out


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
        logger.info("STUB telegram -> %s payload=%r", method, payload)
        return {"ok": True, "stub": True, "method": method, "payload": payload}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as http:
            resp = await http.post(_api_url(method), json=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as exc:
        # `str(exc)` conține URL-ul cererii → tokenul. Redactăm ÎNAINTE de log.
        message = _redact(exc)
        logger.warning("telegram: apelul %s a eșuat: %s", method, message)
        return {"ok": False, "method": method, "error": message}
    except ValueError as exc:  # răspuns care nu e JSON valid
        message = _redact(exc)
        logger.warning("telegram: răspuns invalid la %s: %s", method, message)
        return {"ok": False, "method": method, "error": message}

    if isinstance(data, dict) and not data.get("ok", False):
        logger.warning(
            "telegram: %s respins de API: %s", method, _redact(data.get("description"))
        )
    return data if isinstance(data, dict) else {"ok": False, "method": method}


# --------------------------------------------------------------------------- #
# API public
# --------------------------------------------------------------------------- #


async def send_message(
    chat_id: int | str, text: str, reply_markup: dict | None = None
) -> dict:
    """`sendMessage` — trimite un mesaj, opțional cu tastatură."""
    payload: dict = {"chat_id": chat_id, "text": text}
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    return await _call("sendMessage", payload)


async def set_webhook(url: str, secret_token: str) -> dict:
    """`setWebhook` — înregistrează URL-ul de webhook + secretul de antet.

    `secret_token` ajunge la noi în `X-Telegram-Bot-Api-Secret-Token`; fără el,
    oricine ar putea POST-a update-uri false pe rută.
    """
    payload: dict = {"url": url}
    if secret_token:
        payload["secret_token"] = secret_token
    return await _call("setWebhook", payload)


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
