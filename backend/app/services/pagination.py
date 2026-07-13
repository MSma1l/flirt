"""Paginare pe cursor — codec opac + plafoane de limită, partajate de chat /
stories / events / social.

MODEL: identic cu `/feed` (commit 7d77d82) — corpul răspunsului rămâne o listă
simplă (compatibil cu clienții existenți), iar cursorul paginii următoare e
întors în header-ul `X-Next-Cursor`.

DE CE CURSOR ȘI NU OFFSET: pe liste care se schimbă în timp real (mesaje noi în
chat, povești care expiră), `OFFSET n` sare peste rânduri sau le repetă atunci
când lista se deplasează între două cereri. Cursorul e ancorat de un rând real.

DE CE CURSORUL CONȚINE DOAR UN UUID (nu și timestamp-ul):
Cheile de sortare sunt perechi `(timestamp, id)`. Dacă timestamp-ul ar fi
serializat în cursor și re-legat ca parametru, comparația `col == :param` ar fi
fragilă: pe SQLite coloanele `DateTime` scrise de `server_default=func.now()`
sunt stocate FĂRĂ microsecunde ("… 10:00:00"), în timp ce SQLAlchemy leagă
parametrii datetime CU microsecunde ("… 10:00:00.000000"). Comparația e
lexicografică → rândul-ancoră ar pica pe ramura `<` în loc de `==` și ar apărea
DUBLAT în pagina următoare.

Soluția: cursorul poartă doar `id`-ul rândului-ancoră, iar timestamp-ul lui e
citit DB-side printr-un scalar subquery. Comparăm astfel coloană cu coloană, în
exact aceeași reprezentare stocată — fără round-trip prin Python, fără
ambiguități de format, identic pe SQLite și pe Postgres.

Limitele implicite (cât întoarce o pagină fără `?limit=`) și plafoanele (anti-DoS)
vin din `Settings` — fără hardcodare, configurabile din `.env`.
"""
from __future__ import annotations

import base64
import binascii
import uuid

from fastapi import HTTPException, status

from app.core.config import settings

# Limite implicite (cât întoarce o pagină fără `?limit=`) și plafoane (anti-DoS).
MESSAGES_PAGE_LIMIT = settings.messages_page_limit
MESSAGES_MAX_LIMIT = settings.messages_max_limit
STORIES_PAGE_LIMIT = settings.stories_page_limit
STORIES_MAX_LIMIT = settings.stories_max_limit
EVENTS_PAGE_LIMIT = settings.events_page_limit
EVENTS_MAX_LIMIT = settings.events_max_limit
SOCIAL_PAGE_LIMIT = settings.social_page_limit
SOCIAL_MAX_LIMIT = settings.social_max_limit

# Lungimea maximă a unui cursor acceptat pe query string (anti-DoS), ca la /feed.
MAX_CURSOR_LENGTH = 128


def clamp_limit(limit: int | None, default: int, maximum: int) -> int:
    """Limita efectivă a paginii: default dacă lipsește, plafonată la `maximum`."""
    effective = default if limit is None else limit
    return max(1, min(effective, maximum))


def encode_cursor(anchor_id: uuid.UUID) -> str:
    """Cursor opac (base64url) peste id-ul ultimului rând redat în pagină."""
    raw = str(anchor_id).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> uuid.UUID:
    """Decodează cursorul → id-ul rândului-ancoră. 422 dacă e stricat/fabricat."""
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        # Validăm forma UUID: un cursor fabricat nu poate injecta nimic.
        return uuid.UUID(raw)
    except (ValueError, UnicodeDecodeError, binascii.Error) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid cursor",
        ) from exc
