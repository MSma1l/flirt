"""Notificările BOTULUI Telegram: „ți-a scris", like, super like, match, poveste.

Când i se întâmplă ceva unui user (mesaj, like, super like, match, poveste nouă a
unui match), botul @flrt_party_bot îi trimite un mesaj scurt, cald, cu un buton
`web_app` care deschide EXACT ecranul potrivit din Mini App. Push-ul nativ
(`push.py`) rămâne neatins — acesta e un canal în plus, nu un înlocuitor.

CÂND ȘI CUM PLEACĂ (regulile de bază)
------------------------------------
* DUPĂ commit-ul cererii, niciodată înainte: o notificare pentru un mesaj/match
  care n-a ajuns în bază e o minciună pe care nu o mai putem retrage.
* ÎN FUNDAL: apelantul doar programează o sarcină (`asyncio.create_task`, cu
  referință tare în `_pending` ca garbage collectorul să n-o omoare la jumătate)
  și primește imediat controlul înapoi. Cererea nu așteaptă nici baza, nici
  Telegramul.
* DOAR DATE SIMPLE trec spre fundal (id-uri, texte). Sesiunea DB a cererii NU:
  ea se închide odată cu cererea. Sarcina își deschide propria sesiune scurtă.
* BEST-EFFORT: nicio excepție nu urcă spre cerere; totul se loghează (tokenul e
  deja redactat de `telegram_bot`).

CUI NU SE TRIMITE
-----------------
Fără `telegram_user_id`; cu preferința tipului stinsă; cont banat / purjat GDPR;
block în ORICE direcție între autor și destinatar; autorul = destinatarul; autor
banat / purjat. La like-uri, și autorul cu profil ascuns (nu apare nici în lista
„cine te-a plăcut", deci notificarea ar duce într-un ecran gol).

ANTI-SPAM (Redis partajat; dacă pică → fail OPEN cu plafon în proces)
-------------------------------------------------------------------
* mesaj:      1 notificare / chat / destinatar / 3 min; textul spune câte alte
              mesaje necitite mai are de la același om („…și încă 2 mesaje");
* like:       1 / destinatar / 15 min; cele venite între timp se adună și apar în
              următoarea („Ai primit 3 like-uri noi");
* super like: mereu (e rar), dar max 1 / autor → destinatar / zi;
* poveste:    1 / autor / destinatar / 6 h;
* match:      mereu.
Peste toate (în afară de match și super like): max `RECIPIENT_HOURLY_CAP`
notificări / destinatar / oră — plasa de siguranță pentru cineva cu 20 de chaturi
active deodată.

Telegram 403 (userul a blocat botul / nu i-a scris niciodată) → nu reîncercăm și
ținem minte `FORBIDDEN_TTL` ca să nu-l bombardăm cu cereri sortite eșecului;
429 → mesajul se pierde (o notificare întârziată cu minute nu mai valorează nimic).
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import session as db_session
from app.models.account import Block, UserSettings
from app.models.chat import Message
from app.models.profile import Profile
from app.models.swipe import Match
from app.models.user import User
from app.services import bot_texts, telegram_bot

logger = logging.getLogger("app.tg_notify")

# --------------------------------------------------------------------------- #
# Contractul cu Mini App-ul: parametrii de deep link și preferințele
# --------------------------------------------------------------------------- #

# Ecranele deschise de butoane (Mini App-ul le mapează pe rute). Toate respectă
# regula Telegram `[A-Za-z0-9_-]{1,64}`: un UUID are 36 de caractere, deci
# `stories_<uuid>` (44) încape lejer.
START_LIKES = "likes"
START_FEED = "feed"


def start_chat(chat_id: uuid.UUID | str) -> str:
    return f"chat_{chat_id}"


def start_stories(author_id: uuid.UUID | str) -> str:
    return f"stories_{author_id}"


# Cheile publice ale preferințelor (API) → coloanele din `users`.
PREF_COLUMNS: dict[str, str] = {
    "messages": "tg_notify_messages",
    "likes": "tg_notify_likes",
    "stories": "tg_notify_stories",
    "matches": "tg_notify_matches",
}

# Like-ul și super like-ul împart comutatorul „likes".
EVENT_MESSAGE = "message"
EVENT_LIKE = "like"
EVENT_SUPER_LIKE = "super_like"
EVENT_MATCH = "match"
EVENT_STORY = "story"
_EVENT_PREF = {
    EVENT_MESSAGE: "messages",
    EVENT_LIKE: "likes",
    EVENT_SUPER_LIKE: "likes",
    EVENT_MATCH: "matches",
    EVENT_STORY: "stories",
}

# CONFIDENȚIALITATE: notificarea de like poate spune CINE a dat like?
# Da — în FLIRT, „cine te-a plăcut" NU e o funcție premium: `GET
# /social/likes/received` (`social_service.list_likes_received`) întoarce
# profilul complet al autorului oricărui user autentificat, fără nicio verificare
# de abonament (`billing.entitlements` nu are un flag pentru asta; premium-ul
# ridică doar limita zilnică de swipe-uri). Notificarea nu dezvăluie deci nimic în
# plus față de ecran. Dacă vreodată lista devine premium, se pune `False` și
# notificarea devine anonimă („Cineva te-a plăcut — intră să vezi cine").
LIKE_REVEALS_NAME = True


def get_preferences(user: User) -> dict[str, bool]:
    """Preferințele curente ale userului, în forma API-ului."""
    return {key: bool(getattr(user, column)) for key, column in PREF_COLUMNS.items()}


async def update_preferences(
    db: AsyncSession, user: User, changes: dict[str, bool]
) -> dict[str, bool]:
    """Update PARȚIAL (doar cheile trimise) + commit; întoarce obiectul complet."""
    for key, value in changes.items():
        setattr(user, PREF_COLUMNS[key], bool(value))
    if changes:
        await db.commit()
    return get_preferences(user)


# --------------------------------------------------------------------------- #
# Praguri anti-spam (secunde)
# --------------------------------------------------------------------------- #

MESSAGE_WINDOW_SECONDS = 3 * 60
LIKE_WINDOW_SECONDS = 15 * 60
SUPER_LIKE_WINDOW_SECONDS = 24 * 3600
STORY_WINDOW_SECONDS = 6 * 3600
# Cât ținem minte că Telegram a refuzat definitiv un chat (403).
FORBIDDEN_TTL_SECONDS = 12 * 3600
# Plafonul orar per destinatar (mesaje + like-uri + povești).
RECIPIENT_HOURLY_CAP = 30
_HOUR = 3600
# Contorul like-urilor adunate trăiește cel mult o zi.
_COUNTER_TTL_SECONDS = 24 * 3600
# Pauza dintre două trimiteri din același fan-out (poveste → toate match-urile),
# ca să rămânem sub limita Telegram de ~30 mesaje/s per bot.
FANOUT_PAUSE_SECONDS = 0.05
# Cel mult atâtea sarcini de notificare în zbor per proces; peste → aruncăm
# (un vârf de trafic nu are voie să umfle memoria fără limită).
MAX_PENDING_TASKS = 1000

_KEY_PREFIX = "tgn:"


# --------------------------------------------------------------------------- #
# Stocarea contoarelor: Redis partajat, cu rezervă în proces
# --------------------------------------------------------------------------- #


class _LocalStore:
    """Rezerva în proces când Redis lipsește/pică: aceleași chei, cu expirare.

    Fail OPEN (notificarea pleacă), dar cu aceleași ferestre aplicate local — un
    Redis căzut nu transformă botul într-un spammer. Mărimea e plafonată: la
    depășire se curăță întâi cheile expirate, apoi cele care expiră cel mai curând.
    """

    def __init__(self, max_keys: int = 50_000) -> None:
        self._data: dict[str, tuple[int, float]] = {}
        self._max_keys = max_keys

    def _get(self, key: str, now: float) -> int | None:
        item = self._data.get(key)
        if item is None:
            return None
        if item[1] <= now:
            del self._data[key]
            return None
        return item[0]

    def _put(self, key: str, value: int, expires_at: float) -> None:
        if key not in self._data and len(self._data) >= self._max_keys:
            now = time.monotonic()
            for k in [k for k, (_, exp) in self._data.items() if exp <= now]:
                del self._data[k]
            if len(self._data) >= self._max_keys:
                ordered = sorted(self._data.items(), key=lambda kv: kv[1][1])
                for k, _ in ordered[: max(1, len(ordered) // 10)]:
                    del self._data[k]
        self._data[key] = (value, expires_at)

    def claim(self, key: str, ttl: int) -> bool:
        now = time.monotonic()
        if self._get(key, now) is not None:
            return False
        self._put(key, 1, now + ttl)
        return True

    def incr(self, key: str, ttl: int) -> int:
        now = time.monotonic()
        current = self._get(key, now)
        if current is None:
            self._put(key, 1, now + ttl)
            return 1
        self._data[key] = (current + 1, self._data[key][1])
        return current + 1

    def pop(self, key: str) -> int:
        value = self._get(key, time.monotonic())
        self._data.pop(key, None)
        return value or 0

    def exists(self, key: str) -> bool:
        return self._get(key, time.monotonic()) is not None

    def reset(self) -> None:
        self._data.clear()


_local = _LocalStore()


def reset_state() -> None:
    """Golește rezerva în proces (pentru teste)."""
    _local.reset()


async def _redis():
    """Clientul Redis partajat (`telegram_bot._get_redis`) sau `None`."""
    return await telegram_bot._get_redis()


async def _with_fallback(redis_op: Callable[[Any], Awaitable[Any]], local_op: Callable[[], Any]):
    """Rulează operația pe Redis; dacă lipsește sau pică → pe rezerva locală."""
    try:
        client = await _redis()
        if client is not None:
            return await redis_op(client)
    except Exception as exc:  # noqa: BLE001 — Redis căzut nu oprește notificarea
        logger.info("tg_notify: Redis indisponibil (%s) → contor local", type(exc).__name__)
    return local_op()


async def _claim(key: str, ttl: int) -> bool:
    """True dacă fereastra era liberă (și acum e ocupată pentru `ttl` secunde)."""
    key = _KEY_PREFIX + key

    async def on_redis(client) -> bool:
        return bool(await client.set(key, "1", ex=ttl, nx=True))

    return await _with_fallback(on_redis, lambda: _local.claim(key, ttl))


async def _incr(key: str, ttl: int) -> int:
    """Incrementează un contor; expirarea se pune la PRIMA incrementare."""
    key = _KEY_PREFIX + key

    async def on_redis(client) -> int:
        value = int(await client.incr(key))
        if value == 1:
            await client.expire(key, ttl)
        return value

    return await _with_fallback(on_redis, lambda: _local.incr(key, ttl))


async def _pop(key: str) -> int:
    """Citește și șterge un contor (0 dacă lipsește)."""
    key = _KEY_PREFIX + key

    async def on_redis(client) -> int:
        async with client.pipeline(transaction=True) as pipe:
            pipe.get(key)
            pipe.delete(key)
            value, _ = await pipe.execute()
        return int(value or 0)

    return await _with_fallback(on_redis, lambda: _local.pop(key))


async def _exists(key: str) -> bool:
    key = _KEY_PREFIX + key

    async def on_redis(client) -> bool:
        return bool(await client.exists(key))

    return await _with_fallback(on_redis, lambda: _local.exists(key))


async def _under_hourly_cap(recipient_id: uuid.UUID) -> bool:
    return await _incr(f"cap:{recipient_id}", _HOUR) <= RECIPIENT_HOURLY_CAP


# --------------------------------------------------------------------------- #
# Programarea în fundal
# --------------------------------------------------------------------------- #

# Referințe TARI către sarcinile în zbor: bucla de evenimente ține doar referințe
# slabe, deci o sarcină nereferită poate fi colectată înainte să termine.
_pending: set[asyncio.Task] = set()


def _schedule(fn: Callable[..., Awaitable[None]], *args: Any) -> None:
    """Pornește `fn(*args)` în fundal; nu blochează și nu ridică niciodată."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # apel din cod sincron: nu avem unde rula
        logger.info("tg_notify: fără event loop activ → notificare ignorată")
        return
    if len(_pending) >= MAX_PENDING_TASKS:
        logger.warning("tg_notify: prea multe notificări în zbor → %s ignorată", fn.__name__)
        return
    task = loop.create_task(_guarded(fn, *args))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _guarded(fn: Callable[..., Awaitable[None]], *args: Any) -> None:
    try:
        await fn(*args)
    except Exception as exc:  # noqa: BLE001 — best-effort, nimic nu urcă
        logger.warning(
            "tg_notify: %s a eșuat (%s): %s",
            fn.__name__,
            type(exc).__name__,
            telegram_bot._redact(exc),
        )


async def drain() -> None:
    """Așteaptă toate notificările în zbor (teste / oprirea aplicației)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)


# --------------------------------------------------------------------------- #
# Cine primește
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _Actor:
    user_id: uuid.UUID
    name: str | None
    hidden: bool


@dataclass(frozen=True)
class _Recipient:
    user_id: uuid.UUID
    telegram_user_id: int
    lang: str


async def _load_actor(db: AsyncSession, actor_id: uuid.UUID) -> _Actor | None:
    """Autorul evenimentului; `None` dacă nu (mai) există ori e banat/purjat."""
    row = (
        await db.execute(
            select(User.id, Profile.name, UserSettings.profile_hidden)
            .outerjoin(Profile, Profile.user_id == User.id)
            .outerjoin(UserSettings, UserSettings.user_id == User.id)
            .where(
                User.id == actor_id,
                User.banned_at.is_(None),
                User.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        return None
    return _Actor(user_id=row[0], name=row[1], hidden=bool(row[2]))


async def _eligible(
    db: AsyncSession,
    actor_id: uuid.UUID,
    recipient_ids: list[uuid.UUID],
    event: str,
) -> list[_Recipient]:
    """Destinatarii care chiar pot primi notificarea (un singur query)."""
    ids = [rid for rid in recipient_ids if rid != actor_id]
    if not ids:
        return []
    pref_column = getattr(User, PREF_COLUMNS[_EVENT_PREF[event]])
    blocked = (
        select(Block.id)
        .where(
            or_(
                and_(Block.blocker_id == User.id, Block.blocked_id == actor_id),
                and_(Block.blocker_id == actor_id, Block.blocked_id == User.id),
            )
        )
        .exists()
    )
    rows = (
        await db.execute(
            select(User.id, User.telegram_user_id, User.telegram_language).where(
                User.id.in_(ids),
                User.telegram_user_id.is_not(None),
                User.banned_at.is_(None),
                User.deleted_at.is_(None),
                pref_column.is_(True),
                ~blocked,
            )
        )
    ).all()
    return [
        _Recipient(
            user_id=row[0],
            telegram_user_id=int(row[1]),
            lang=row[2] if row[2] in bot_texts.LANGS else bot_texts.DEFAULT_LANG,
        )
        for row in rows
    ]


async def _prepare(
    actor_id: uuid.UUID, recipient_ids: list[uuid.UUID], event: str
) -> tuple[_Actor | None, list[_Recipient]]:
    async with db_session.AsyncSessionLocal() as db:
        actor = await _load_actor(db, actor_id)
        if actor is None:
            return None, []
        return actor, await _eligible(db, actor_id, recipient_ids, event)


# --------------------------------------------------------------------------- #
# Trimiterea
# --------------------------------------------------------------------------- #


def _is_forbidden(result: dict) -> bool:
    """Telegram nu ne lasă să-i scriem omului (blocat / chat inexistent)."""
    code = result.get("error_code")
    if code == 403:
        return True
    return code == 400 and "chat not found" in str(result.get("description") or "").lower()


async def _send(
    recipient: _Recipient, event: str, text: str, button_key: str, start_param: str
) -> bool:
    """Trimite notificarea; True dacă Telegram a confirmat-o."""
    forbidden_key = f"forbidden:{recipient.telegram_user_id}"
    if await _exists(forbidden_key):
        return False
    markup = None
    if telegram_bot.miniapp_url():
        markup = telegram_bot.web_app_keyboard(
            bot_texts.button(recipient.lang, button_key), start_param
        )
    result = await telegram_bot.send_message(
        recipient.telegram_user_id,
        text,
        reply_markup=markup,
        parse_mode="HTML",
        disable_preview=True,
    )
    if telegram_bot.delivery(result) is telegram_bot.Delivery.SENT:
        return True
    if _is_forbidden(result):
        # Nu reîncercăm: până nu pornește din nou botul, orice cerere ar pica.
        await _claim(forbidden_key, FORBIDDEN_TTL_SECONDS)
    # 429 / rețea / altele: notificarea se pierde (fără reîncercare inline).
    logger.info(
        "tg_notify: %s nelivrată către user_id=%s (cod=%s)",
        event,
        recipient.user_id,
        result.get("error_code"),
    )
    return False


async def _deliver_message(
    chat_id: uuid.UUID, sender_id: uuid.UUID, recipient_id: uuid.UUID, kind: str, body: str
) -> None:
    actor, recipients = await _prepare(sender_id, [recipient_id], EVENT_MESSAGE)
    if actor is None or not recipients:
        return
    if not await _claim(f"msg:{recipient_id}:{chat_id}", MESSAGE_WINDOW_SECONDS):
        return
    # Câte mesaje NECITITE are de la același om în chat — dacă le-a citit deja
    # (era în aplicație), nu-l mai deranjăm.
    async with db_session.AsyncSessionLocal() as db:
        unread = await db.scalar(
            select(func.count(Message.id)).where(
                Message.chat_id == chat_id,
                Message.sender_id == sender_id,
                Message.is_read.is_(False),
            )
        )
    if not unread:
        return
    if not await _under_hourly_cap(recipient_id):
        return
    recipient = recipients[0]
    text = bot_texts.notify_message(recipient.lang, actor.name, kind, body, int(unread) - 1)
    await _send(recipient, EVENT_MESSAGE, text, "notify_reply", start_chat(chat_id))


async def _deliver_like(actor_id: uuid.UUID, recipient_id: uuid.UUID) -> None:
    actor, recipients = await _prepare(actor_id, [recipient_id], EVENT_LIKE)
    if actor is None or actor.hidden or not recipients:
        return
    if not await _claim(f"like:{recipient_id}", LIKE_WINDOW_SECONDS):
        # Fereastra e ocupată: îl adunăm pentru următoarea notificare.
        await _incr(f"likec:{recipient_id}", _COUNTER_TTL_SECONDS)
        return
    count = 1 + await _pop(f"likec:{recipient_id}")
    if not await _under_hourly_cap(recipient_id):
        return
    recipient = recipients[0]
    name = actor.name if (LIKE_REVEALS_NAME and count == 1) else None
    text = bot_texts.notify_like(recipient.lang, name, count)
    await _send(recipient, EVENT_LIKE, text, "notify_see_likes", START_LIKES)


async def _deliver_super_like(actor_id: uuid.UUID, recipient_id: uuid.UUID) -> None:
    actor, recipients = await _prepare(actor_id, [recipient_id], EVENT_SUPER_LIKE)
    if actor is None or actor.hidden or not recipients:
        return
    if not await _claim(f"super:{actor_id}:{recipient_id}", SUPER_LIKE_WINDOW_SECONDS):
        return
    recipient = recipients[0]
    text = bot_texts.notify_super_like(recipient.lang, actor.name)
    await _send(recipient, EVENT_SUPER_LIKE, text, "notify_see_profile", START_LIKES)


async def _deliver_match(
    actor_id: uuid.UUID,
    recipient_id: uuid.UUID,
    chat_id: uuid.UUID,
    first_message: str | None,
) -> None:
    actor, recipients = await _prepare(actor_id, [recipient_id], EVENT_MATCH)
    if actor is None or not recipients:
        return
    recipient = recipients[0]
    text = bot_texts.notify_match(recipient.lang, actor.name, "text", first_message)
    button_key = "notify_reply" if first_message else "notify_write_first"
    await _send(recipient, EVENT_MATCH, text, button_key, start_chat(chat_id))


async def _deliver_story(author_id: uuid.UUID) -> None:
    async with db_session.AsyncSessionLocal() as db:
        actor = await _load_actor(db, author_id)
        if actor is None:
            return
        pairs = (
            await db.execute(
                select(Match.user_a_id, Match.user_b_id).where(
                    or_(Match.user_a_id == author_id, Match.user_b_id == author_id)
                )
            )
        ).all()
        match_ids = [b if a == author_id else a for a, b in pairs]
        recipients = await _eligible(db, author_id, match_ids, EVENT_STORY)

    first = True
    for recipient in recipients:
        if not await _claim(f"story:{author_id}:{recipient.user_id}", STORY_WINDOW_SECONDS):
            continue
        if not await _under_hourly_cap(recipient.user_id):
            continue
        if not first:
            await asyncio.sleep(FANOUT_PAUSE_SECONDS)
        first = False
        text = bot_texts.notify_story(recipient.lang, actor.name)
        try:
            await _send(
                recipient, EVENT_STORY, text, "notify_see_story", start_stories(author_id)
            )
        except Exception as exc:  # noqa: BLE001 — un destinatar nu oprește fan-out-ul
            logger.warning("tg_notify: poveste nelivrată (%s)", type(exc).__name__)


# --------------------------------------------------------------------------- #
# API public — apelat de servicii DUPĂ commit; întoarce imediat
# --------------------------------------------------------------------------- #


def notify_message(
    *,
    chat_id: uuid.UUID,
    sender_id: uuid.UUID,
    recipient_id: uuid.UUID,
    kind: str,
    body: str,
) -> None:
    """Mesaj nou în chat (`body` = textul DEJA mascat de contacte)."""
    _schedule(_deliver_message, chat_id, sender_id, recipient_id, kind, body or "")


def notify_like(*, actor_id: uuid.UUID, recipient_id: uuid.UUID, is_super: bool) -> None:
    """Like / super like nou, fără match (match-ul are notificarea lui)."""
    if is_super:
        _schedule(_deliver_super_like, actor_id, recipient_id)
    else:
        _schedule(_deliver_like, actor_id, recipient_id)


def notify_match(
    *,
    actor_id: uuid.UUID,
    recipient_id: uuid.UUID,
    chat_id: uuid.UUID,
    first_message: str | None = None,
) -> None:
    """Match nou; `first_message` = mesajul (mascat) lăsat de autor la like."""
    _schedule(_deliver_match, actor_id, recipient_id, chat_id, first_message or None)


def notify_story(*, author_id: uuid.UUID) -> None:
    """Poveste nouă → match-urile autorului."""
    _schedule(_deliver_story, author_id)
