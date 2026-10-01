"""Rute Telegram — sub prefixul /api/v1/telegram. Webhookul botului.

SECURITATE: NU există autentificare de utilizator pe această rută și nici nu
poate exista — Telegram nu trimite tokenuri JWT. Singura poartă e secretul de
webhook: la `setWebhook` îi dăm lui Telegram un `secret_token`, iar el ni-l
trimite înapoi la fiecare update în antetul `X-Telegram-Bot-Api-Secret-Token`.
Comparăm cu `hmac.compare_digest` (timp constant) și respingem cu 403 sec, fără
detalii — un atacator nu trebuie să afle DE CE a fost respins.

DE CE ÎNTOARCEM MEREU 200: orice status ≠ 2xx face Telegram să reia update-ul,
cu backoff, la nesfârșit. Un update pe care nu-l înțelegem (sau o eroare internă
la procesare) se LOGHEAZĂ și se confirmă cu 200 — altfel un singur update
malformat ne inundă webhookul.

RATE LIMITING PE `chat_id`, NU PE IP: toate update-urile vin de la aceleași IP-uri
ale Telegram-ului, deci o limitare pe IP ar bloca chiar Telegram. Limităm pe
chat, iar la depășire NU întoarcem 429 (l-ar face să reîncerce), ci 200 fără
procesare.

CE ÎNȚELEGE BOTUL
-----------------
`/start [param]` → poza de bun venit (cu `file_id` memorat) + meniu inline;
`/help`, `/contacts`, `/privacy`, `/events`, `/tickets` → mesaje scurte cu buton
spre ecranul potrivit din Mini App; butoanele callback „Ajutor" / „Contacte" /
„Confidențialitate" (`callback_query`). Orice alt text → indiciu + butonul app-ului.
Limba: din `from.language_code` (ro implicit, ru pentru ru/uk/be, en).
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.core import ratelimit
from app.core.config import settings
from app.services import bot_texts, telegram_bot

log = logging.getLogger("app.telegram")

router = APIRouter()

# Antetul în care Telegram repetă secretul configurat la `setWebhook`.
SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"

# Rate limiting per chat: bucket, fereastră și prag implicit (dacă nu e în config).
_RL_BUCKET = "telegram_webhook"
_RL_WINDOW_SECONDS = 60.0
DEFAULT_WEBHOOK_PER_MIN = 30

# Textele (ro/ru/en) stau în `services/bot_texts.py` — comune cu scriptul de setup.
HTML = "HTML"


def _forbidden() -> HTTPException:
    """403 fără detalii: nu confirmăm atacatorului ce anume a greșit."""
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


def _authorize(request: Request) -> None:
    """Verifică secretul de webhook. Ridică 403 dacă nu se potrivește."""
    secret = telegram_bot.webhook_secret()
    provided = request.headers.get(SECRET_HEADER, "")

    if not secret:
        # Fără secret configurat în modul 'live' ruta ar fi complet deschisă →
        # o închidem de tot. În 'stub' (dev/teste) o lăsăm, dar cu avertisment.
        if telegram_bot.auth_mode() == "live":
            log.error(
                "telegram: webhook în mod 'live' fără TELEGRAM_WEBHOOK_SECRET → "
                "resping toate cererile"
            )
            raise _forbidden()
        log.warning(
            "telegram: webhook fără secret configurat (mod stub) — acceptat doar în dev"
        )
        return

    # `compare_digest` pe bytes: timp constant, fără surprize de encoding.
    if not provided or not hmac.compare_digest(
        provided.encode("utf-8"), secret.encode("utf-8")
    ):
        log.warning("telegram: update respins (secret de webhook invalid)")
        raise _forbidden()


async def _within_rate_limit(chat_id: int | str) -> bool:
    """Limitare pe `chat_id` (NU pe IP — toate update-urile vin de la Telegram)."""
    # `_active()` respectă `rate_limit_enabled` și dezactivarea implicită sub
    # pytest; îl refolosim ca limitarea de aici să se comporte exact ca restul
    # aplicației, fără o a doua implementare care ar diverge.
    if not ratelimit._active():
        return True
    limit = int(getattr(settings, "telegram_webhook_per_min", DEFAULT_WEBHOOK_PER_MIN))
    return await ratelimit.check(f"{_RL_BUCKET}:{chat_id}", limit, _RL_WINDOW_SECONDS)


def _extract_message(update: dict) -> dict | None:
    """Mesajul nou din update, dacă update-ul e unul de mesaj.

    Doar `message`: un mesaj EDITAT (`edited_message`) nu e o cerere nouă — un
    `/start` corectat ar retrimite tot bun venitul; în canale botul nu are rol.
    """
    value = update.get("message")
    return value if isinstance(value, dict) else None


def _start_param(text: str) -> str | None:
    """Argumentul comenzii `/start` (deep link `https://t.me/<bot>?start=<x>`)."""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None
    return telegram_bot.normalize_start_param(parts[1])


def _command(text: str) -> str | None:
    """Numele comenzii (`/help@numebot arg` → `help`), sau None dacă nu e comandă."""
    if not text.startswith("/"):
        return None
    first = text.split(maxsplit=1)[0]
    name, _, target = first[1:].partition("@")
    # `/cmd@altbot` în grup e pentru alt bot — nu răspundem în locul lui.
    own = telegram_bot.bot_username().lower()
    if target and own and target.lower() != own:
        return None
    return name.lower() or None


def _is_start_command(text: str) -> bool:
    """True pentru `/start`, `/start <param>` și forma `/start@numebot`."""
    return _command(text) == "start"


def _lang(user: dict | None) -> str:
    code = user.get("language_code") if isinstance(user, dict) else None
    return bot_texts.lang_for(code if isinstance(code, str) else None)


# --------------------------------------------------------------------------- #
# Tastaturi
# --------------------------------------------------------------------------- #


def _app_row(lang: str, key: str, start_param: str | None) -> list[dict]:
    return [telegram_bot.web_app_button(bot_texts.button(lang, key), start_param)]


def _callback(lang: str, key: str, data: str) -> dict:
    return {"text": bot_texts.button(lang, key), "callback_data": data}


def _welcome_keyboard(lang: str, start_param: str | None) -> dict:
    """Meniul de sub poza de bun venit.

    Fără URL de Mini App rămân doar butoanele callback — un buton `web_app` fără
    URL valid ar face Telegram să respingă TOT mesajul.
    """
    rows: list[list[dict]] = []
    if telegram_bot.miniapp_url():
        rows.append(_app_row(lang, "open", start_param))
        rows.append([
            telegram_bot.web_app_button(bot_texts.button(lang, "events"), bot_texts.START_EVENTS),
            telegram_bot.web_app_button(bot_texts.button(lang, "tickets"), bot_texts.START_TICKETS),
        ])
    rows.append([
        _callback(lang, "help", bot_texts.CB_HELP),
        _callback(lang, "contacts", bot_texts.CB_CONTACTS),
    ])
    return {"inline_keyboard": rows}


def _keyboard(rows: list[list[dict]]) -> dict | None:
    rows = [row for row in rows if row]
    return {"inline_keyboard": rows} if rows else None


def _open_rows(lang: str, key: str = "open", start_param: str | None = None) -> list[list[dict]]:
    """Rândul cu butonul care deschide Mini App-ul (gol dacă nu e configurat)."""
    return [_app_row(lang, key, start_param)] if telegram_bot.miniapp_url() else []


# --------------------------------------------------------------------------- #
# Răspunsuri
# --------------------------------------------------------------------------- #


async def _send(chat_id: int | str, text: str, rows: list[list[dict]]) -> None:
    await telegram_bot.send_message(
        chat_id, text, reply_markup=_keyboard(rows), parse_mode=HTML, disable_preview=True
    )


async def _send_welcome(
    chat_id: int | str, lang: str, first_name: str | None, start_param: str | None
) -> None:
    """Poza de bun venit cu legendă + meniu; la eșec, același conținut ca text."""
    caption = bot_texts.welcome(lang, first_name)
    keyboard = _welcome_keyboard(lang, start_param)
    result = await telegram_bot.send_cached_photo(
        chat_id, telegram_bot.WELCOME_IMAGE, caption, keyboard, HTML
    )
    if result.get("ok"):
        return
    log.warning("telegram: poza de bun venit a eșuat → trimit varianta text")
    await telegram_bot.send_message(
        chat_id, caption, reply_markup=keyboard, parse_mode=HTML, disable_preview=True
    )


async def _send_help(chat_id: int | str, lang: str) -> None:
    rows = _open_rows(lang)
    rows.append([
        _callback(lang, "contacts", bot_texts.CB_CONTACTS),
        _callback(lang, "privacy", bot_texts.CB_PRIVACY),
    ])
    await _send(chat_id, bot_texts.help_text(lang), rows)


async def _send_contacts(chat_id: int | str, lang: str) -> None:
    rows: list[list[dict]] = []
    tg = bot_texts.support_telegram_username()
    if tg:
        rows.append([{"text": bot_texts.button(lang, "write_support"), "url": f"https://t.me/{tg}"}])
    site = bot_texts.website_url()
    if site.startswith("https://"):
        rows.append([{"text": bot_texts.button(lang, "website"), "url": site}])
    rows += _open_rows(lang)
    await _send(chat_id, bot_texts.contacts_text(lang), rows)


async def _send_privacy(chat_id: int | str, lang: str) -> None:
    rows = _open_rows(lang, "privacy_app", bot_texts.START_PRIVACY)
    await _send(chat_id, bot_texts.privacy_text(lang), rows)


async def _send_events(chat_id: int | str, lang: str) -> None:
    if not telegram_bot.miniapp_url():
        await _send(chat_id, bot_texts.no_miniapp_text(lang), [])
        return
    await _send(
        chat_id, bot_texts.events_text(lang), _open_rows(lang, "events", bot_texts.START_EVENTS)
    )


async def _send_tickets(chat_id: int | str, lang: str) -> None:
    if not telegram_bot.miniapp_url():
        await _send(chat_id, bot_texts.no_miniapp_text(lang), [])
        return
    await _send(
        chat_id, bot_texts.tickets_text(lang), _open_rows(lang, "tickets", bot_texts.START_TICKETS)
    )


async def _send_fallback(chat_id: int | str, lang: str) -> None:
    if not telegram_bot.miniapp_url():
        # Fără URL de Mini App un buton `web_app` ar fi respins de Telegram.
        log.warning("telegram: TELEGRAM_MINIAPP_URL lipsește → răspund fără buton")
        await _send(chat_id, bot_texts.no_miniapp_text(lang), [])
        return
    await _send(chat_id, bot_texts.fallback_text(lang), _open_rows(lang))


# Comenzile/callback-urile simple: nume → funcție (chat_id, lang).
_SIMPLE_HANDLERS = {
    "help": _send_help,
    "contacts": _send_contacts,
    "privacy": _send_privacy,
    "events": _send_events,
    "tickets": _send_tickets,
}


async def _handle_message(message: dict) -> None:
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        log.info("telegram: mesaj fără chat.id, ignorat")
        return

    if not await _within_rate_limit(chat_id):
        log.warning("telegram: rate limit atins pentru chat_id=%s", chat_id)
        return

    user = message.get("from") if isinstance(message.get("from"), dict) else {}
    lang = _lang(user)
    text = (message.get("text") or "").strip()
    command = _command(text)

    if command == "start":
        await _send_welcome(chat_id, lang, user.get("first_name"), _start_param(text))
        return
    handler = _SIMPLE_HANDLERS.get(command or "")
    if handler is not None:
        await handler(chat_id, lang)
        return
    if text.startswith("/") and command is None:
        # Comandă adresată altui bot din grup — tăcem.
        return
    await _send_fallback(chat_id, lang)


async def _handle_callback(callback: dict) -> None:
    """Butoanele inline „Ajutor" / „Contacte" / „Confidențialitate"."""
    query_id = callback.get("id")
    user = callback.get("from") if isinstance(callback.get("from"), dict) else {}
    message = callback.get("message") if isinstance(callback.get("message"), dict) else {}
    chat_id = (message.get("chat") or {}).get("id") or user.get("id")
    data = callback.get("data")

    if not isinstance(query_id, str) or chat_id is None:
        log.info("telegram: callback_query incomplet, ignorat")
        return

    if not await _within_rate_limit(chat_id):
        log.warning("telegram: rate limit atins pentru chat_id=%s", chat_id)
        return

    # Răspundem MEREU la callback (altfel butonul rămâne „în încărcare" ~15s).
    await telegram_bot.answer_callback_query(query_id)
    if data not in bot_texts.CALLBACKS:
        log.info("telegram: callback necunoscut, ignorat")
        return
    await _SIMPLE_HANDLERS[data](chat_id, _lang(user))


async def _handle_update(update: dict) -> None:
    """Procesează un update deja autorizat. Nu ridică excepții."""
    callback = update.get("callback_query")
    if isinstance(callback, dict):
        await _handle_callback(callback)
        return

    message = _extract_message(update)
    if message is None:
        # my_chat_member, inline_query... — nu ne interesează.
        log.info("telegram: update neprocesat, chei=%s", sorted(update.keys()))
        return
    await _handle_message(message)


@router.post("/webhook")
async def webhook(request: Request) -> dict:
    """Primește update-uri de la Telegram. Mereu 200, în afară de 403 la secret."""
    _authorize(request)

    try:
        update = await request.json()
    except Exception:  # corp lipsă / JSON invalid — confirmăm și mergem mai departe
        log.warning("telegram: corp de update invalid (nu e JSON)")
        return {"ok": True}

    if not isinstance(update, dict):
        log.warning("telegram: update care nu e obiect JSON, ignorat")
        return {"ok": True}

    try:
        await _handle_update(update)
    except Exception as exc:  # niciun update nu are voie să doboare webhookul
        log.exception("telegram: eroare la procesarea update-ului: %s", type(exc).__name__)

    return {"ok": True}
