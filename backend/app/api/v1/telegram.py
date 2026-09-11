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
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request, status

from app.core import ratelimit
from app.core.config import settings
from app.services import telegram_bot

log = logging.getLogger("app.telegram")

router = APIRouter()

# Antetul în care Telegram repetă secretul configurat la `setWebhook`.
SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token"

# Rate limiting per chat: bucket, fereastră și prag implicit (dacă nu e în config).
_RL_BUCKET = "telegram_webhook"
_RL_WINDOW_SECONDS = 60.0
DEFAULT_WEBHOOK_PER_MIN = 30

# Textele botului (RO). Botul nu poartă conversații — doar deschide Mini App-ul.
BUTTON_TEXT = "Deschide FLIRT"
WELCOME_TEXT = (
    "Salut și bine ai venit la FLIRT!\n\n"
    "Aici faci cunoștințe reale, cu oameni din apropierea ta. "
    "Apasă butonul de mai jos ca să deschizi aplicația direct în Telegram."
)
FALLBACK_TEXT = (
    "Eu doar deschid aplicația FLIRT — conversațiile se poartă în aplicație.\n\n"
    "Apasă butonul de mai jos sau trimite /start."
)
NO_MINIAPP_TEXT = (
    "Aplicația FLIRT nu este configurată pe acest bot. "
    "Revino puțin mai târziu."
)


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
    """Mesajul din update (normal sau editat), dacă update-ul e unul de mesaj."""
    for key in ("message", "edited_message", "channel_post"):
        value = update.get(key)
        if isinstance(value, dict):
            return value
    return None


def _start_param(text: str) -> str | None:
    """Argumentul comenzii `/start` (deep link `https://t.me/<bot>?start=<x>`)."""
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        return None
    return telegram_bot.normalize_start_param(parts[1])


def _is_start_command(text: str) -> bool:
    """True pentru `/start`, `/start <param>` și forma `/start@numebot`."""
    first = text.split(maxsplit=1)[0] if text else ""
    command = first.split("@", 1)[0]
    return command == "/start"


async def _reply_with_app(chat_id: int | str, text: str, start_param: str | None) -> None:
    """Răspunde cu textul dat + butonul care deschide Mini App-ul."""
    if not telegram_bot.miniapp_url():
        # Fără URL de Mini App un buton `web_app` ar fi respins de Telegram.
        log.warning("telegram: TELEGRAM_MINIAPP_URL lipsește → răspund fără buton")
        await telegram_bot.send_message(chat_id, NO_MINIAPP_TEXT)
        return
    await telegram_bot.send_message(
        chat_id,
        text,
        reply_markup=telegram_bot.web_app_keyboard(BUTTON_TEXT, start_param),
    )


async def _handle_update(update: dict) -> None:
    """Procesează un update deja autorizat. Nu ridică excepții."""
    message = _extract_message(update)
    if message is None:
        # callback_query, my_chat_member, inline_query... — nu ne interesează.
        log.info("telegram: update neprocesat, chei=%s", sorted(update.keys()))
        return

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if chat_id is None:
        log.info("telegram: mesaj fără chat.id, ignorat")
        return

    if not await _within_rate_limit(chat_id):
        log.warning("telegram: rate limit atins pentru chat_id=%s", chat_id)
        return

    text = (message.get("text") or "").strip()
    if _is_start_command(text):
        await _reply_with_app(chat_id, WELCOME_TEXT, _start_param(text))
        return

    await _reply_with_app(chat_id, FALLBACK_TEXT, None)


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
