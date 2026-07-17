"""Client AI centralizat (OpenRouter) — singurul loc din care se cheamă un LLM.

DE CE OPENROUTER ȘI NU SDK-UL ANTHROPIC
---------------------------------------
Cheia de care dispunem e o cheie **OpenRouter** (prefix `sk-or-v1`), verificată:
pe `api.anthropic.com` întoarce 401 (invalid x-api-key), iar pe
`openrouter.ai/api/v1/chat/completions` întoarce 200. Adică SDK-ul `anthropic`
NU poate funcționa cu ea — providerul `anthropic` din `photo_moderation` rămâne
valid doar pentru cine are o cheie Anthropic reală.

DE CE `httpx` ȘI NU PACHETUL `openai`
-------------------------------------
OpenRouter vorbește protocolul OpenAI-compatibil (`choices[0].message.content`),
deci pachetul `openai` ar merge. Nu-l instalăm: tot proiectul cheamă providerii
externi prin `httpx` (vezi `billing.py`, `push.py`, `geo.py`), avem nevoie de un
singur endpoint (`POST /chat/completions`), iar o dependență nouă ar aduce zeci
de MB tranzitivi și încă un client HTTP cu propriile timeout-uri și retry-uri,
paralel cu convenția existentă. Un POST cu JSON nu justifică asta.

DEGRADARE, NU CRASH
-------------------
Nicio funcție de aici NU ridică excepții către apelant: orice eroare (429,
timeout, 5xx, răspuns nefolosibil) devine un `AIResult` cu `text=None` și o
etichetă în `error`. AI-ul e o funcție de CONFORT — o pană la OpenRouter nu are
voie să strice un upload de poză sau un chat.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import UserSettings
from app.models.user import User

logger = logging.getLogger("app.ai")

# Timeout pentru apelurile către OpenRouter (secunde). MAI MARE decât cel din
# `billing.py` (10s): un model care „gândește" peste o imagine răspunde în mod
# normal în zeci de secunde, iar un timeout prea strict ar transforma un răspuns
# perfect valid într-o degradare inutilă.
_HTTP_TIMEOUT = 30.0

# Endpoint-ul OpenAI-compatibil al OpenRouter (relativ la `openrouter_base_url`).
_CHAT_COMPLETIONS_PATH = "/chat/completions"

# Plafon implicit de tokeni în răspuns. Mic intenționat: cazurile noastre (hint de
# chat, verdict de moderare) sunt scurte, iar un plafon mic e și o limită de cost.
_DEFAULT_MAX_TOKENS = 512

# Etichetele de eroare întoarse în `AIResult.error`. Sunt STABILE: ajung în
# loguri și în `ModerationVerdict.raw_label`, deci se caută după ele.
ERR_NOT_CONFIGURED = "not_configured"
ERR_RATE_LIMIT = "rate_limit"
ERR_TIMEOUT = "timeout"
ERR_NETWORK = "network_error"
ERR_BAD_RESPONSE = "unparsable_response"
ERR_UNEXPECTED = "unexpected_error"


@dataclass(frozen=True)
class AIResult:
    """Rezultatul unui apel AI.

    - `text`: răspunsul modelului, sau None dacă apelul a eșuat;
    - `error`: eticheta erorii (vezi constantele ERR_*), None dacă a mers.

    Întoarcem un rezultat în loc să ridicăm excepții pentru că FIECARE apelant
    trebuie să degradeze, nu să propage: un hint de chat lipsă e acceptabil, un
    500 pe endpoint din cauza unui 429 la OpenRouter nu e.
    """

    text: str | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        """A reușit apelul și avem text de folosit?"""
        return self.error is None and self.text is not None


def is_configured() -> bool:
    """Avem cheia și base URL-ul ca să putem chema OpenRouter?

    Separat INTENȚIONAT de `settings.ai_provider`: moderarea foto
    (`photo_moderation_provider='openrouter'`) e o cerință Apple aplicată TUTUROR
    pozelor și nu depinde de comutatorul de AI per user; ea are nevoie doar de
    credențiale valide.
    """
    return bool(settings.openrouter_api_key and settings.openrouter_base_url)


def _endpoint() -> str:
    """URL-ul complet al endpoint-ului de chat (tolerant la `/` final în config)."""
    return settings.openrouter_base_url.rstrip("/") + _CHAT_COMPLETIONS_PATH


def _headers() -> dict[str, str]:
    """Headerele cererii. NU se loghează niciodată — conțin cheia."""
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "Content-Type": "application/json",
    }


def image_part(image: bytes, media_type: str) -> dict[str, Any]:
    """Construiește partea de tip imagine a unui mesaj (protocol OpenAI-compatibil).

    OpenRouter nu acceptă bytes: imaginea se trimite ca `data:` URI base64 în
    `image_url.url`. `media_type` e tipul canonic ('image/jpeg' | 'image/png' |
    'image/webp'), forțat server-side din magic-bytes de apelant.
    """
    data = base64.standard_b64encode(image).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {"url": f"data:{media_type};base64,{data}"},
    }


def user_message(text: str, *, image: bytes | None = None, media_type: str = "") -> dict:
    """Un mesaj `user`, opțional cu o imagine atașată (vision).

    Imaginea vine ÎNAINTEA textului: modelele vision răspund măsurabil mai bine
    când întrebarea urmează după conținutul la care se referă.
    """
    if image is None:
        return {"role": "user", "content": text}
    return {
        "role": "user",
        "content": [image_part(image, media_type), {"type": "text", "text": text}],
    }


async def complete(
    messages: list[dict],
    *,
    model: str | None = None,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    response_format: dict | None = None,
) -> AIResult:
    """Cere modelului un răspuns. NU ridică NICIODATĂ excepții spre apelant.

    `messages` e în formatul OpenAI (`[{"role": "user", "content": ...}]`) —
    construiește-le cu `user_message()` ca să nu depinzi de forma exactă.
    `model` implicit = `settings.ai_text_model`. `response_format` e opțional
    (ex. `{"type": "json_object"}`), pentru cine vrea JSON garantat.
    """
    if not is_configured():
        # RO: nu logăm ca eroare — e o stare NORMALĂ în dev/CI (fără cheie).
        logger.debug("ai: OpenRouter neconfigurat (lipsește cheia) — degradăm.")
        return AIResult(error=ERR_NOT_CONFIGURED)

    payload: dict[str, Any] = {
        "model": model or settings.ai_text_model,
        "messages": messages,
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        payload["response_format"] = response_format

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(_endpoint(), json=payload, headers=_headers())
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        # RO: 429 e REALIST aici — OpenRouter limitează pe cheie și pe model, iar
        # modelele `:free` îl dau la rafală. Îl tratăm explicit ca să fie vizibil
        # în loguri: e semnalul că trebuie urcat planul, nu că e un bug.
        status = exc.response.status_code if exc.response is not None else 0
        if status == 429:
            logger.warning("ai: OpenRouter rate limit (429) — degradăm fără eroare.")
            return AIResult(error=ERR_RATE_LIMIT)
        # Nu logăm corpul răspunsului: poate conține ecoul cererii noastre.
        logger.error("ai: OpenRouter a răspuns %s — degradăm.", status)
        return AIResult(error=f"http_{status}")
    except httpx.TimeoutException:
        logger.warning("ai: timeout la OpenRouter (%ss) — degradăm.", _HTTP_TIMEOUT)
        return AIResult(error=ERR_TIMEOUT)
    except httpx.HTTPError as exc:
        # RO: `exc` e o eroare de transport httpx — nu conține headerele cererii,
        # deci cheia NU ajunge în log.
        logger.warning("ai: OpenRouter inaccesibil (%s) — degradăm.", type(exc).__name__)
        return AIResult(error=ERR_NETWORK)
    except Exception:  # noqa: BLE001 — orice altceva: tot degradăm.
        logger.exception("ai: eroare neașteptată la apelul OpenRouter — degradăm.")
        return AIResult(error=ERR_UNEXPECTED)

    return _parse(data)


async def complete_vision(
    prompt: str,
    image: bytes,
    media_type: str,
    *,
    model: str | None = None,
    max_tokens: int = _DEFAULT_MAX_TOKENS,
    response_format: dict | None = None,
) -> AIResult:
    """Varianta VISION: același contract, dar cu o imagine atașată promptului.

    Model implicit = `settings.ai_vision_model` (separat de cel text: un model
    text-only ar întoarce o eroare pe orice poză).
    """
    return await complete(
        [user_message(prompt, image=image, media_type=media_type)],
        model=model or settings.ai_vision_model,
        max_tokens=max_tokens,
        response_format=response_format,
    )


def _parse(data: Any) -> AIResult:
    """Extrage textul dintr-un răspuns OpenAI-compatibil (`choices[0].message.content`).

    OpenRouter poate întoarce **200 cu un obiect `error`** în corp (ex. modelul
    upstream a picat) — nu doar coduri HTTP de eroare. Fără verificarea de mai
    jos, un astfel de răspuns ar fi arătat ca „fără text", cu o etichetă greșită.
    """
    if not isinstance(data, dict):
        logger.error("ai: răspuns OpenRouter neașteptat (nu e obiect) — degradăm.")
        return AIResult(error=ERR_BAD_RESPONSE)

    error = data.get("error")
    if error:
        code = error.get("code") if isinstance(error, dict) else None
        if str(code) == "429":
            logger.warning("ai: OpenRouter rate limit (200 + error 429) — degradăm.")
            return AIResult(error=ERR_RATE_LIMIT)
        logger.error("ai: OpenRouter a întors o eroare în corp (code=%s).", code)
        return AIResult(error=ERR_BAD_RESPONSE)

    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        logger.error("ai: răspuns OpenRouter fără `choices[0].message.content`.")
        return AIResult(error=ERR_BAD_RESPONSE)

    # Unele modele întorc `content` ca listă de blocuri ([{type: text, text: ...}]).
    if isinstance(content, list):
        content = "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        )
    if not isinstance(content, str) or not content.strip():
        logger.error("ai: OpenRouter a întors un conținut gol — degradăm.")
        return AIResult(error=ERR_BAD_RESPONSE)

    return AIResult(text=content)


# --- Comutatorul de AI per user ----------------------------------------------
async def ai_enabled_for(db: AsyncSession, user: User) -> bool:
    """Are userul ăsta funcțiile AI PORNITE?

    Adevărat DOAR dacă ambele condiții sunt îndeplinite:
      1. serverul are un provider AI real (`ai_provider != 'stub'`) — altfel
         n-avem ce chema, oricât ar vrea userul;
      2. userul l-a aprins EXPLICIT din setări (`UserSettings.ai_enabled`).

    Punctul 2 e cerința de produs: AI-ul e OPRIT implicit, pe fiecare cont, și se
    aprinde manual. De aceea lipsa rândului de setări (user nou care n-a atins
    niciodată ecranul de setări) înseamnă OPRIT — nu default-ul din config.

    Read-only: NU creează rândul de setări. O simplă verificare „pot folosi AI?"
    nu are voie să scrie în baza de date (vezi `get_search_preferences`).
    """
    if settings.ai_provider == "stub":
        return False  # scurtcircuit: nici măcar nu atingem baza de date

    result = await db.execute(
        select(UserSettings.ai_enabled).where(UserSettings.user_id == user.id)
    )
    return bool(result.scalar_one_or_none())
