"""Funcții AI de PRODUS peste clientul `services/ai.py`: hint de chat + chimie.

ÎMPĂRȚIREA RESPONSABILITĂȚILOR
------------------------------
`services/ai.py` e transportul (OpenRouter, degradare, zero excepții). Aici stă
tot ce ține de produs: cine are voie, ce context pleacă spre furnizor, cum se
citește răspunsul, ce se memorează temporar. Clientul NU se modifică — e bun așa.

TREI REGULI CARE NU SE NEGOCIAZĂ
-------------------------------
1. APARTENENȚĂ. Sugestiile se dau doar pentru o conversație a userului curent.
   Verificarea nu e rescrisă aici: citim mesajele prin `chat_service.get_messages`,
   care ridică deja 404 pentru cine nu e participant. O a doua implementare a
   aceleiași verificări ar diverge exact în cazul care contează.
2. DATE MINIME. Spre furnizorul extern pleacă doar ULTIMELE câteva mesaje
   (`HINT_HISTORY_LIMIT`), trunchiate, fără nume, fără id-uri, fără poze. Motiv:
   cost, latență și minimizarea datelor personale (GDPR art. 5(1)(c)).
3. CONTACTELE RĂMÂN MASCATE. Ce citim din `messages.body` e DEJA trecut prin
   `contact_masker` la salvare (`chat_service.send_message` și livrarea mesajelor
   deferred din `feed_service` sunt singurele căi care inserează mesaje, ambele
   maschează). Re-aplicăm `mask_contacts` oricum — pe INTRARE, pentru rânduri
   vechi de dinaintea măștii, și pe IEȘIRE, fiindcă un model poate halucina sau
   reconstrui un număr de telefon în sugestia pe care o afișăm userului.

DEGRADARE, NU EROARE
--------------------
Fără cheie AI, cu providerul căzut sau cu un răspuns gol întoarcem
`available=False` + un `reason` stabil (vezi `schemas/ai.py`), niciodată 5xx.
Singura excepție ridicată de aici e poarta de activare (403) și cea de
apartenență/vizibilitate (404/403), ambele venite din servicii existente.
"""
from __future__ import annotations

import logging
import re
import threading
import time
import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.profile import Profile
from app.models.user import User
from app.schemas.ai import (
    REASON_EMPTY,
    REASON_NOT_CONFIGURED,
    REASON_PROVIDER_ERROR,
    ChatHintOut,
    ChemistryOut,
)
from app.services import ai, chat_service, feed_service
from app.services.compatibility import behavior_score, compute_compatibility
from app.services.contact_masker import mask_contacts

logger = logging.getLogger("app.ai_assist")

# --- Cât context pleacă spre furnizor ----------------------------------------
# Ultimele N mesaje, nu tot istoricul. 8 e suficient ca modelul să prindă tonul
# și subiectul curent (un schimb de 4 replici dus-întors), dar ține promptul la
# câteva sute de tokeni: un chat cu 5.000 de mesaje ar costa dolari per apăsare
# și ar trimite anii de conversație ai userului unui furnizor extern.
HINT_HISTORY_LIMIT = 8
# Fiecare mesaj e trunchiat la atâtea caractere în prompt. Plafonul de schemă e
# 2.000 (`schemas/chat.MESSAGE_MAX_LENGTH`); 400 păstrează sensul replicii fără
# ca un singur mesaj lung să umple tot contextul.
HINT_MESSAGE_MAX_CHARS = 400
# Câte sugestii întoarcem, și cât de lungă poate fi una.
HINT_MAX_SUGGESTIONS = 3
HINT_SUGGESTION_MAX_CHARS = 200
# Plafon de tokeni în răspuns: 3 replici scurte încap lejer în 256.
HINT_MAX_TOKENS = 256
# Explicația de chimie: o frază-două.
CHEMISTRY_MAX_TOKENS = 200
CHEMISTRY_EXPLANATION_MAX_CHARS = 400

# --- Memorare temporară (Redis) ----------------------------------------------
# Cheia conține ID-ul ULTIMULUI mesaj din conversație, deci invalidarea la mesaj
# nou e automată: alt ultim mesaj ⇒ altă cheie ⇒ recalcul. Nu există „ștergere de
# cache" de întreținut și nici fereastră în care userul primește sugestii pentru
# o conversație care s-a mișcat între timp.
HINT_CACHE_PREFIX = "ai:hint:"
# TTL scurt: sugestiile nu sunt date de referință, iar 5 minute acoperă exact
# comportamentul care ne interesează — userul apasă butonul de mai multe ori la
# rând, fără să scrie nimic între timp.
HINT_CACHE_TTL_SECONDS = 300
# Separatorul dintre sugestii în valoarea memorată (o singură cheie, un singur
# round-trip). Mesajele trec prin validatorii de schemă, care taie caracterele
# de control, deci `\n` nu poate apărea în interiorul unei sugestii.
_CACHE_SEPARATOR = "\n"
# Timeout-uri scurte: un Redis lent nu are voie să încetinească ruta (ca în
# `ad_service` / `ratelimit`).
REDIS_TIMEOUT_SECONDS = 1.0

# Client Redis partajat la nivel de modul, recreat dacă URL-ul se schimbă
# (monkeypatch în teste) — exact tiparul din `ad_service`.
_redis_client = None
_redis_client_url: str | None = None
_redis_lock = threading.Lock()


async def _get_redis():
    """Clientul Redis partajat, sau `None` dacă `REDIS_URL` nu e configurat.

    Import LAZY al lui `redis.asyncio` (dependență opțională `[live]`/`[test]`):
    dev-ul/testul fără Redis nu trebuie s-o ceară. `None` ⇒ apelantul merge fără
    memorare temporară (recalculează), nu eșuează.
    """
    global _redis_client, _redis_client_url

    url = settings.redis_url
    if not url:
        return None
    if _redis_client is None or _redis_client_url != url:
        import redis.asyncio as aioredis  # import lazy (doar pe ramura live)

        with _redis_lock:
            if _redis_client is None or _redis_client_url != url:
                _redis_client = aioredis.from_url(
                    url,
                    decode_responses=True,
                    socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
                    socket_timeout=REDIS_TIMEOUT_SECONDS,
                )
                _redis_client_url = url
    return _redis_client


def reset_redis() -> None:
    """Uită clientul Redis memorat (teste / reconectare după eroare)."""
    global _redis_client, _redis_client_url
    _redis_client = None
    _redis_client_url = None


async def _cache_get(key: str) -> list[str] | None:
    """Citește sugestiile memorate, sau `None` (lipsă / Redis indisponibil)."""
    try:
        redis = await _get_redis()
        if redis is None:
            return None
        raw = await redis.get(key)
    except Exception as exc:  # noqa: BLE001 — cache-ul nu are voie să strice ruta
        logger.warning(
            "ai_assist: cache indisponibil la citire",
            extra={"error_type": type(exc).__name__},
        )
        reset_redis()  # forțăm reconectarea la următoarea cerere
        return None
    if not raw:
        return None
    return [line for line in str(raw).split(_CACHE_SEPARATOR) if line]


async def _cache_set(key: str, suggestions: list[str]) -> None:
    """Memorează sugestiile cu TTL scurt. Orice eroare e ignorată (best effort)."""
    if not suggestions:
        return
    try:
        redis = await _get_redis()
        if redis is None:
            return
        await redis.set(
            key, _CACHE_SEPARATOR.join(suggestions), ex=HINT_CACHE_TTL_SECONDS
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "ai_assist: cache indisponibil la scriere",
            extra={"error_type": type(exc).__name__},
        )
        reset_redis()


# --- Porți de acces ----------------------------------------------------------
# Mesajul e ACȚIONABIL: spune userului exact ce are de făcut și unde. Mobilul îl
# poate folosi ca atare sau poate ruta după codul 403 spre ecranul de setări
# (`PUT /api/v1/settings` cu `ai_enabled=true`).
AI_DISABLED_DETAIL = (
    "Funcțiile AI sunt oprite pe contul tău. Pornește-le din Setări "
    "(secțiunea „Funcții AI”) ca să primești sugestii."
)


def ai_available() -> bool:
    """Poate serverul chema un model, indiferent ce a bifat userul?

    Două condiții, ambele din config: providerul de produs e real
    (`ai_provider != 'stub'`) ȘI avem credențiale (`ai.is_configured()`).
    Separate intenționat de comutatorul per-cont: dacă serverul n-are AI, userul
    NU poate rezolva nimic din setări, deci nu-i cerem să încerce.
    """
    return settings.ai_provider != "stub" and ai.is_configured()


async def require_ai_enabled(db: AsyncSession, user: User) -> None:
    """403 dacă userul curent NU are funcțiile AI pornite pe cont.

    Se apelează DUPĂ `ai_available()`: acolo unde serverul n-are AI deloc
    răspundem „indisponibil" (200), nu „pornește-l din setări" (403) — altfel am
    trimite userul într-un ecran unde comutatorul nu schimbă nimic.

    Reutilizează `ai.ai_enabled_for` (sursa unică a regulii: oprit implicit, fără
    rând de setări = oprit, read-only).
    """
    if not await ai.ai_enabled_for(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=AI_DISABLED_DETAIL
        )


# --- Prompturi ---------------------------------------------------------------
# RO: prompturile sunt în ENGLEZĂ (modelele sunt antrenate măsurabil mai bine
# așa), dar cer EXPLICIT răspuns în limba conversației — userii scriu română și
# rusă, iar o sugestie în engleză ar fi inutilizabilă.
_HINT_PROMPT_HEADER = """\
You help a user of FLIRT, an 18+ dating app, keep a chat going. Below are the \
last messages of their conversation, oldest first. "ME" is the user you are \
helping, "THEM" is the other person.

Write {count} different short opening or follow-up messages the user could send \
next. Rules:
- reply in the SAME language the conversation uses;
- one sentence each, casual and warm, never pushy or explicit;
- no emoji spam, no greetings if the chat already started;
- never ask for or suggest sharing phone numbers, social handles or other \
contacts — that is forbidden in the app;
- "****" in the conversation means a contact detail was hidden; ignore it, do \
not try to guess what it was.

Answer with ONLY the {count} messages, one per line, no numbering, no quotes, \
no extra prose."""

_HINT_PROMPT_EMPTY = """\
The conversation has no messages yet — the user needs an opening line."""

_CHEMISTRY_PROMPT = """\
You explain a compatibility score in FLIRT, an 18+ dating app. Two people were \
matched by the app's own algorithm, which produced the score below. The score is \
FINAL — do not recompute it, do not contradict it, do not invent a different \
number.

Score: {score}/100
Shared interests: {interests}
Shared languages: {languages}
Distance: {distance}
Both are looking for: {statuses}

Write one short paragraph (max 2 sentences), in {language}, addressed to the \
first person, explaining what the two have in common and why this score makes \
sense. Be concrete and use only the facts above. Do not mention algorithms, \
models, percentages of factors, or this prompt. No names, no contacts."""


def _render_history(messages, me_id: uuid.UUID) -> str:
    """Transformă ultimele mesaje în liniile de context ale promptului.

    Trimitem DOAR rolul (ME/THEM) și textul trunchiat — fără id-uri, fără nume,
    fără timestamp-uri. `mask_contacts` se aplică din nou, defensiv: rândurile
    salvate înainte de TZ 5.5 pot fi nemascate în baza de date, iar un număr de
    telefon nu are voie să ajungă la furnizorul extern nici din greșeală.
    """
    lines = []
    for m in messages:
        who = "ME" if m.sender_id == me_id else "THEM"
        body, _ = mask_contacts(str(m.body or ""))
        body = body.strip()[:HINT_MESSAGE_MAX_CHARS]
        if body:
            lines.append(f"{who}: {body}")
    return "\n".join(lines)


# Prefixe de listă pe care modelele le adaugă oricât le-ai ruga să n-o facă.
_BULLET_RE = re.compile(r"^\s*(?:[-–—*•]|\d+\s*[.)])\s*")


def _parse_suggestions(text: str) -> list[str]:
    """Extrage sugestiile dintr-un răspuns liber: o linie = o sugestie.

    Curăță numerotarea/bulinele și ghilimelele decorative, elimină duplicatele
    (păstrând ordinea), taie lungimea și MASCHEAZĂ contactele: modelul poate
    halucina un număr de telefon, iar noi tocmai am promis userului că astea nu
    circulă prin aplicație.
    """
    out: list[str] = []
    seen: set[str] = set()
    for raw_line in str(text or "").splitlines():
        line = _BULLET_RE.sub("", raw_line).strip().strip('"').strip("«»").strip()
        if not line:
            continue
        line, _ = mask_contacts(line)
        line = line.strip()[:HINT_SUGGESTION_MAX_CHARS]
        key = line.casefold()
        if not line or key in seen:
            continue
        seen.add(key)
        out.append(line)
        if len(out) >= HINT_MAX_SUGGESTIONS:
            break
    return out


def _log_call(feature: str, started: float, result: ai.AIResult) -> None:
    """Jurnalizează APELUL, nu conținutul lui.

    Ce logăm: funcția, dacă a reușit, durata, eticheta de eroare. Ce NU logăm
    niciodată: mesajele userului, promptul, răspunsul modelului, cheia API.
    (Numărul de jetoane nu apare aici fiindcă `AIResult` nu îl expune, iar
    `services/ai.py` nu se modifică pentru asta — dacă ajunge vreodată în
    contract, se adaugă `tokens` în `extra`.)
    """
    logger.info(
        "ai_assist: apel AI încheiat",
        extra={
            "feature": feature,
            "ok": result.ok,
            "duration_ms": int((time.monotonic() - started) * 1000),
            "error": result.error,
        },
    )


def _unavailable_reason(result: ai.AIResult) -> str:
    """Traduce eticheta tehnică a clientului AI în `reason`-ul de contract."""
    if result.error == ai.ERR_NOT_CONFIGURED:
        return REASON_NOT_CONFIGURED
    return REASON_PROVIDER_ERROR


# --- 1. Sugestie de conversație ----------------------------------------------
async def chat_hint(
    db: AsyncSession, user: User, chat_id: uuid.UUID
) -> ChatHintOut:
    """Una sau mai multe sugestii scurte de mesaj pentru conversația `chat_id`.

    Ordinea verificărilor e deliberată:
      1. apartenența la conversație (404 dacă nu ești participant) — ÎNAINTE de
         orice altceva, ca ruta să nu poată fi folosită ca oracol („AI-ul e
         pornit?", „chat-ul ăsta există?") pe conversațiile altora;
      2. serverul are AI? altfel `available=False` (200);
      3. userul l-a pornit? altfel 403 acționabil;
      4. cache; 5. apelul propriu-zis.
    """
    # 1. Apartenență + ultimele mesaje, dintr-un singur apel: `get_messages`
    #    ridică 404 pentru cine nu e participant și întoarce exact fereastra cea
    #    mai NOUĂ de `limit` mesaje, în ordine cronologică.
    page = await chat_service.get_messages(
        db, user, chat_id, limit=HINT_HISTORY_LIMIT
    )

    # 2. Serverul poate chema un model?
    if not ai_available():
        return ChatHintOut(available=False, reason=REASON_NOT_CONFIGURED)

    # 3. Userul a pornit funcțiile AI pe contul lui?
    await require_ai_enabled(db, user)

    # 4. Memorare temporară. Cheia include ultimul mesaj ⇒ se invalidează singură
    #    la mesaj nou, ȘI userul curent: cei doi participanți la aceeași
    #    conversație primesc sugestii din perspective opuse („ME" e altcineva),
    #    deci o cheie comună ar servi fiecăruia replicile scrise pentru celălalt.
    last_id = page.items[-1].id if page.items else "empty"
    cache_key = f"{HINT_CACHE_PREFIX}{user.id}:{chat_id}:{last_id}"
    cached = await _cache_get(cache_key)
    if cached:
        return ChatHintOut(available=True, suggestions=cached, cached=True)

    # 5. Apelul. Context minim: doar ultimele mesaje, fără nume și fără id-uri.
    history = _render_history(page.items, user.id)
    prompt = _HINT_PROMPT_HEADER.format(count=HINT_MAX_SUGGESTIONS)
    prompt += "\n\n" + (history if history else _HINT_PROMPT_EMPTY)

    started = time.monotonic()
    result = await ai.complete(
        [ai.user_message(prompt)], max_tokens=HINT_MAX_TOKENS
    )
    _log_call("chat_hint", started, result)

    if not result.ok:
        return ChatHintOut(available=False, reason=_unavailable_reason(result))

    suggestions = _parse_suggestions(result.text or "")
    if not suggestions:
        # A răspuns, dar n-a ieșit nimic folosibil (text gol, doar punctuație).
        return ChatHintOut(available=False, reason=REASON_EMPTY)

    await _cache_set(cache_key, suggestions)
    return ChatHintOut(available=True, suggestions=suggestions, cached=False)


# --- 2. Scor de chimie -------------------------------------------------------
def _distance_phrase(distance_km: float | None) -> str:
    """Distanța, în cuvinte, pentru prompt (fără coordonate, fără adrese)."""
    if distance_km is None:
        return "unknown"
    km = round(distance_km)
    if km <= 1:
        return "same city, very close"
    if km <= 50:
        return f"about {km} km apart"
    return f"far apart (about {km} km)"


def _prompt_language(profile: Profile) -> str:
    """Limba în care cerem explicația: prima limbă a userului, altfel româna."""
    languages = [str(x) for x in (profile.languages or []) if x]
    if not languages:
        return "Romanian"
    first = languages[0].strip().lower()
    return {
        "ro": "Romanian",
        "ru": "Russian",
        "en": "English",
    }.get(first, "Romanian")


async def chemistry(
    db: AsyncSession, user: User, other_user_id: uuid.UUID
) -> ChemistryOut:
    """Scorul de chimie (compatibilitate) cu `other_user_id`, explicat de AI.

    SCORUL E AL NOSTRU, nu al modelului: `compute_compatibility`, aceeași funcție
    pură care alimentează feed-ul și lista de chat-uri, cu aceleași intrări
    (interese, distanță reală din coordonatele persistate, semnal comportamental).
    Deci cifra e reproductibilă, testabilă și identică cu cea afișată în restul
    aplicației. AI-ul primește scorul deja calculat și scrie doar explicația.

    VIZIBILITATE: reutilizăm `feed_service._authorize_swipe`, verificarea care
    păzește deja acțiunea de swipe (block în orice direcție, profil ascuns, cont
    banat, profil șters/incomplet, 18+, poze). Nu o rescriem, din două motive:
    o a doua copie ar diverge la prima modificare, iar o rută mai PERMISIVĂ decât
    swipe-ul ar deveni un oracol de enumerare — „există userul X?", „m-a blocat?"
    — exact pe conturile pe care aplicația le ascunde.
    """
    # 1. Poarta de vizibilitate (ridică 403/404 ca la swipe).
    await feed_service._authorize_swipe(db, user, other_user_id)

    # 2. Ambele profiluri într-un singur SELECT (fără N+1).
    profiles = (
        (
            await db.execute(
                select(Profile).where(Profile.user_id.in_([user.id, other_user_id]))
            )
        )
        .scalars()
        .all()
    )
    by_user = {p.user_id: p for p in profiles}
    my_profile = by_user.get(user.id)
    other_profile = by_user.get(other_user_id)
    if my_profile is None or other_profile is None:
        # `_authorize_swipe` a validat deja ambele profiluri; dacă am ajuns aici,
        # rândul a dispărut între cele două interogări (ștergere concurentă).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # 3. Aceleași intrări ca în feed: interese (batch), distanță reală, semnal
    #    comportamental. Refolosim helperii din `feed_service` ca scorul să nu
    #    poată devia de la cel afișat pe cartelă.
    interests_map = await feed_service._interests_by_profile(
        db, [my_profile.id, other_profile.id]
    )
    my_interests = interests_map.get(my_profile.id, set())
    other_interests = interests_map.get(other_profile.id, set())
    distance_km = feed_service._distance_between(my_profile, other_profile)
    other_user = await db.get(User, other_user_id)
    behavior = behavior_score(
        other_user.last_active_at if other_user is not None else None,
        verified=bool(getattr(other_profile, "verified", False)),
    )
    score = compute_compatibility(
        my_profile,
        other_profile,
        my_interests,
        other_interests,
        distance_km,
        behavior,
    )

    # 4. Explicația e opțională: fără AI, scorul rămâne complet valid.
    if not ai_available():
        return ChemistryOut(
            user_id=other_user_id,
            score=score,
            available=False,
            reason=REASON_NOT_CONFIGURED,
        )
    await require_ai_enabled(db, user)

    common_interests = sorted(my_interests & other_interests)
    common_languages = sorted(
        {str(x) for x in (my_profile.languages or []) if x}
        & {str(x) for x in (other_profile.languages or []) if x}
    )
    common_statuses = sorted(
        {str(x) for x in (my_profile.dating_statuses or []) if x}
        & {str(x) for x in (other_profile.dating_statuses or []) if x}
    )
    prompt = _CHEMISTRY_PROMPT.format(
        score=score,
        interests=", ".join(common_interests) or "none in common",
        languages=", ".join(common_languages) or "none in common",
        distance=_distance_phrase(distance_km),
        statuses=", ".join(common_statuses) or "different things",
        language=_prompt_language(my_profile),
    )

    started = time.monotonic()
    result = await ai.complete(
        [ai.user_message(prompt)], max_tokens=CHEMISTRY_MAX_TOKENS
    )
    _log_call("chemistry", started, result)

    if not result.ok:
        return ChemistryOut(
            user_id=other_user_id,
            score=score,
            available=False,
            reason=_unavailable_reason(result),
        )

    # Aceeași mască defensivă ca la sugestii + plafon de lungime.
    explanation, _ = mask_contacts(" ".join((result.text or "").split()))
    explanation = explanation.strip()[:CHEMISTRY_EXPLANATION_MAX_CHARS]
    if not explanation:
        return ChemistryOut(
            user_id=other_user_id,
            score=score,
            available=False,
            reason=REASON_EMPTY,
        )

    return ChemistryOut(
        user_id=other_user_id,
        score=score,
        available=True,
        explanation=explanation,
    )
