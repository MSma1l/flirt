"""Poza de profil preluată automat din Telegram — avatarul de REZERVĂ.

REGULA DE PRODUS
----------------
Cine nu și-a pus încă nicio poză în FLIRT apare la ceilalți (lista de chat,
antetul conversației, profilul partenerului) cu poza lui de Telegram, nu cu o
inițială. Pozele proprii au MEREU prioritate (`avatar_url_for`).

DE UNDE VINE POZA
-----------------
1. `initData.user.photo_url` (Mini App) — un URL https pe un domeniu Telegram.
   Îl acceptăm DOAR dacă trece `sanitize_photo_url` (https, fără credențiale /
   port exotic, host `t.me` / `telegram.org` / `telesco.pe` sau subdomenii).
   Telegram NU trimite mereu câmpul (depinde de cum e lansat Mini App-ul), de
   aceea există și:
2. Bot API `getUserProfilePhotos` + `getFile` — funcționează pentru orice user
   care a pornit botul; interogat cel mult o dată la `BOT_API_RECHECK`.

DE CE O COPIE ÎN STORAGE-UL NOSTRU
----------------------------------
URL-urile Telegram (t.me/i/userpic/..., fișierele Bot API) se schimbă/expiră,
iar URL-ul unui fișier Bot API conține TOKENUL botului — nu are voie să ajungă
la client. Descărcăm deci poza (în fundal, după login), o re-encodăm JPEG fără
metadate, o salvăm prin `storage` sub `photos/tg-{user_id}/…` și servim copia.
Până la descărcare (sau dacă ea eșuează) servim URL-ul https Telegram validat —
`img-src https:` din CSP-ul Mini App-ului îl permite.

REȚEA ȘI SECURITATE
-------------------
* În modul stub al botului (`telegram_bot.is_stub()`: dev, teste) NU se atinge
  rețeaua — rămâne doar URL-ul validat din initData.
* Anti-SSRF: fiecare redirect e re-validat pe allowlist-ul de domenii; corpul e
  plafonat (`MAX_DOWNLOAD_BYTES`); doar JPEG/PNG/WEBP reale (Pillow), plafon de
  pixeli anti decompression bomb.
* Tokenul nu ajunge niciodată în log (`telegram_bot._redact`).
* Totul e best-effort: nicio excepție nu urcă spre cererea de login.
"""
from __future__ import annotations

import asyncio
import io
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.db import session as db_session
from app.models.user import User
from app.services import telegram_bot
from app.services.storage import get_storage, key_within_namespace

logger = logging.getLogger("app.telegram.avatar")

# Domeniile Telegram acceptate (exact sau ca subdomeniu: cdn4.telesco.pe,
# api.telegram.org, t.me).
ALLOWED_PHOTO_DOMAINS: tuple[str, ...] = ("t.me", "telegram.org", "telesco.pe")
MAX_URL_LENGTH = 512
MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
DOWNLOAD_TIMEOUT = 8.0
# Plafon de pixeli la decodare (anti decompression bomb) și latura avatarului.
MAX_SOURCE_PIXELS = 40_000_000
AVATAR_MAX_SIDE = 640
# Cât de des întrebăm Bot API când initData nu are `photo_url`.
BOT_API_RECHECK = timedelta(hours=12)
MAX_PENDING_TASKS = 200

# Prefixul cheilor din storage pentru copiile avatarelor Telegram. Stă sub
# `photos/` (namespace permis la ștergere pe S3), dar NU sub prefixul unui
# profil (`photos/{profile_id}/`) — deci nu poate fi „adoptat" în lista de poze
# a cuiva prin `PUT /profiles/me`.
_KEY_PREFIX = "photos/tg-"
_BOT_FILE_SOURCE = "tgfile:"


# --------------------------------------------------------------------------- #
# Validare + alegerea avatarului
# --------------------------------------------------------------------------- #


def is_telegram_host(host: str | None) -> bool:
    """True dacă `host` e un domeniu Telegram din allowlist (sau subdomeniu)."""
    if not host:
        return False
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in ALLOWED_PHOTO_DOMAINS)


def sanitize_photo_url(raw: object) -> str | None:
    """URL-ul pozei din initData, dacă e sigur de stocat/servit; altfel None.

    Doar https, fără user:parolă, fără port non-standard, fără spații/caractere
    de control, pe un domeniu Telegram, maxim `MAX_URL_LENGTH`. Un `.svg` e
    respins: Telegram îl generează ca placeholder cu inițiale (UI-ul nostru
    face deja asta), iar un SVG nu e o poză.
    """
    if not isinstance(raw, str):
        return None
    url = raw.strip()
    if not url or len(url) > MAX_URL_LENGTH:
        return None
    if any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in url):
        return None
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme != "https" or parts.username or parts.password:
        return None
    if port not in (None, 443):
        return None
    if not is_telegram_host(parts.hostname):
        return None
    if parts.path.lower().endswith(".svg"):
        return None
    return url


def avatar_url_for(photos: list | None, telegram_photo_url: str | None) -> str | None:
    """Avatarul afișat altora: prima poză proprie, altfel poza din Telegram."""
    for photo in photos or []:
        if isinstance(photo, str) and photo:
            return photo
    return telegram_photo_url or None


def _is_stored_copy(url: str | None) -> bool:
    """True dacă `url` e o copie de avatar din storage-ul NOSTRU."""
    if not url:
        return False
    key = key_within_namespace(url)
    return bool(key and key.startswith(_KEY_PREFIX))


async def delete_stored(url: str | None) -> None:
    """Șterge copia din storage a unui avatar (no-op pentru URL-uri Telegram)."""
    if not _is_stored_copy(url):
        return
    try:
        await get_storage().delete(url)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001 — curățenia nu blochează nimic
        logger.warning("telegram avatar: copia veche nu a putut fi ștearsă", exc_info=True)


def apply_login_photo(user: User, raw_photo_url: object) -> str | None:
    """Pasul SINCRON de la login: notează poza din initData pe user.

    Dacă initData aduce o poză validă, diferită de cea știută, URL-ul Telegram
    devine imediat avatarul de rezervă (fundalul îl înlocuiește apoi cu copia
    din storage). NU face commit.

    Întoarce URL-ul copiei vechi din storage, care trebuie ștearsă după commit
    (sau None).
    """
    url = sanitize_photo_url(raw_photo_url)
    if url is None:
        return None
    if user.telegram_photo_source == url and user.telegram_photo_url:
        return None  # aceeași poză, deja preluată
    stale = user.telegram_photo_url if _is_stored_copy(user.telegram_photo_url) else None
    user.telegram_photo_source = url
    user.telegram_photo_url = url
    return stale


# --------------------------------------------------------------------------- #
# Descărcare + normalizare
# --------------------------------------------------------------------------- #


def _normalize_image(content: bytes) -> bytes | None:
    """JPEG curat (fără EXIF/metadate), latura ≤ AVATAR_MAX_SIDE; None dacă nu e poză."""
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(content)) as img:
            if img.format not in ("JPEG", "PNG", "WEBP"):
                return None
            width, height = img.size
            if width <= 0 or height <= 0 or width * height > MAX_SOURCE_PIXELS:
                return None
            img.load()
            clean = ImageOps.exif_transpose(img)
            if clean.mode != "RGB":
                clean = clean.convert("RGB")
            clean.thumbnail((AVATAR_MAX_SIDE, AVATAR_MAX_SIDE))
            out = io.BytesIO()
            clean.save(out, format="JPEG", quality=85, optimize=True)
            return out.getvalue()
    except Exception:  # noqa: BLE001 — orice fișier stricat = „nu e poză"
        return None


async def _download(url: str) -> bytes | None:
    """Descarcă `url` (doar domenii Telegram, inclusiv la redirect), plafonat."""
    current = url
    async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=False) as http:
        for _ in range(MAX_REDIRECTS + 1):
            parts = urlsplit(current)
            if parts.scheme != "https" or not is_telegram_host(parts.hostname):
                return None
            async with http.stream("GET", current) as resp:
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        return None
                    current = str(resp.url.join(location))
                    continue
                if resp.status_code != 200:
                    return None
                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > MAX_DOWNLOAD_BYTES:
                    return None
                chunks: list[bytes] = []
                size = 0
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > MAX_DOWNLOAD_BYTES:
                        return None
                    chunks.append(chunk)
                return b"".join(chunks)
    return None


async def fetch_avatar_bytes(url: str) -> bytes | None:
    """Descarcă și normalizează poza; None la orice eșec (logat redactat)."""
    try:
        raw = await _download(url)
    except httpx.HTTPError as exc:
        logger.info("telegram avatar: descărcare eșuată: %s", telegram_bot._redact(exc))
        return None
    if not raw:
        return None
    return _normalize_image(raw)


async def _store(user_id: uuid.UUID, content: bytes) -> str:
    key = f"{_KEY_PREFIX}{user_id}/{uuid.uuid4().hex}.jpg"
    return await get_storage().save(key, content, "image/jpeg")


# --------------------------------------------------------------------------- #
# Bot API
# --------------------------------------------------------------------------- #


async def _bot_api_photo(telegram_id: int) -> tuple[str, str] | None | bool:
    """Poza curentă din Bot API.

    Întoarce `(file_unique_id, url_descărcare)`, `False` dacă userul NU are
    (sau nu ne arată) nicio poză, sau `None` dacă nu știm (eroare/stub).
    """
    res = await telegram_bot._call(
        "getUserProfilePhotos", {"user_id": telegram_id, "limit": 1}
    )
    if not res.get("ok") or res.get("stub"):
        return None
    result = res.get("result") or {}
    photos = result.get("photos") or []
    if not photos or not photos[0]:
        return False
    sizes = [s for s in photos[0] if isinstance(s, dict) and s.get("file_id")]
    if not sizes:
        return False
    # Cea mai mare variantă care nu depășește ~800px (avatarul are 640).
    sizes.sort(key=lambda s: int(s.get("width") or 0))
    fitting = [s for s in sizes if int(s.get("width") or 0) <= 800]
    chosen = fitting[-1] if fitting else sizes[0]
    unique = str(chosen.get("file_unique_id") or chosen["file_id"])[:200]

    file_res = await telegram_bot._call("getFile", {"file_id": chosen["file_id"]})
    file_path = (file_res.get("result") or {}).get("file_path") if file_res.get("ok") else None
    if not isinstance(file_path, str) or not file_path or ".." in file_path:
        return None
    url = f"{telegram_bot.TELEGRAM_API_BASE}/file/bot{telegram_bot.bot_token()}/{file_path}"
    return unique, url


# --------------------------------------------------------------------------- #
# Sincronizarea în fundal
# --------------------------------------------------------------------------- #


async def refresh_avatar(user_id: uuid.UUID, telegram_id: int, had_photo_url: bool) -> None:
    """Aduce copia locală a pozei Telegram la zi (rulează DUPĂ commit-ul login-ului).

    * initData a avut `photo_url` → dacă încă servim URL-ul Telegram brut, îl
      descărcăm și îl înlocuim cu copia din storage.
    * initData NU a avut `photo_url` → întrebăm Bot API (cel mult o dată la
      `BOT_API_RECHECK`): poză nouă → o descărcăm; nicio poză → ștergem
      avatarul de rezervă (userul și-a scos poza / a ascuns-o).
    """
    async with db_session.AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None or user.is_deleted or user.is_banned:
            return
        stale: str | None = None

        if had_photo_url:
            source = user.telegram_photo_source
            if not source or user.telegram_photo_url != source:
                return  # deja avem copia (sau nimic de descărcat)
            content = await fetch_avatar_bytes(source)
            if content is None:
                return  # rămâne URL-ul Telegram validat ca rezervă
            new_url = await _store(user.id, content)
            await db.refresh(user)
            if user.telegram_photo_source != source:  # între timp, alt login
                await delete_stored(new_url)
                return
            user.telegram_photo_url = new_url
            await db.commit()
            return

        now = datetime.now(timezone.utc)
        checked = user.telegram_photo_checked_at
        if checked is not None and now - checked < BOT_API_RECHECK:
            return
        found = await _bot_api_photo(telegram_id)
        if found is None:
            return
        user.telegram_photo_checked_at = now
        if found is False:
            stale = user.telegram_photo_url
            user.telegram_photo_url = None
            user.telegram_photo_source = None
        else:
            unique, url = found
            marker = f"{_BOT_FILE_SOURCE}{unique}"
            if user.telegram_photo_source != marker or not user.telegram_photo_url:
                content = await fetch_avatar_bytes(url)
                if content is not None:
                    stale = user.telegram_photo_url
                    user.telegram_photo_url = await _store(user.id, content)
                    user.telegram_photo_source = marker
        await db.commit()
        await delete_stored(stale)


_pending: set[asyncio.Task] = set()


def schedule_refresh(user_id: uuid.UUID, telegram_id: int, had_photo_url: bool) -> None:
    """Programează `refresh_avatar` în fundal. Nu blochează, nu ridică.

    În modul stub al botului nu programează nimic: fără rețea nu avem ce aduce.
    """
    if telegram_bot.is_stub():
        return
    _schedule(refresh_avatar, user_id, telegram_id, had_photo_url)


def _schedule(fn: Callable[..., Awaitable[None]], *args: Any) -> None:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if len(_pending) >= MAX_PENDING_TASKS:
        logger.warning("telegram avatar: prea multe sincronizări în zbor → ignorată")
        return
    task = loop.create_task(_guarded(fn, *args))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _guarded(fn: Callable[..., Awaitable[None]], *args: Any) -> None:
    try:
        await fn(*args)
    except Exception as exc:  # noqa: BLE001 — best-effort, nimic nu urcă
        logger.warning(
            "telegram avatar: sincronizarea a eșuat (%s): %s",
            type(exc).__name__,
            telegram_bot._redact(exc),
        )


async def drain() -> None:
    """Așteaptă sincronizările în zbor (teste / oprirea aplicației)."""
    while _pending:
        await asyncio.gather(*list(_pending), return_exceptions=True)
