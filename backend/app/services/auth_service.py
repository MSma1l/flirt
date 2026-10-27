"""Logica de business a autentificării: register, login, rotație refresh
(cu reuse detection) și logout.

Erorile de flux sunt semnalate prin `HTTPException`, ca rutele să rămână subțiri.
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.session import RefreshSession
from app.models.user import ROLE_ADMIN, User
from app.schemas.auth import TokenPair, is_reserved_email
from app.services import bot_texts, telegram_avatar
from app.services.telegram_auth import TelegramUser

log = logging.getLogger("app.auth")

# RO: Hash Argon2 „dummy", constant, pentru a rula MEREU o verificare de parolă
# la login — chiar și când userul nu există — ca timpul de răspuns să nu dezvăluie
# existența contului (anti user-enumeration prin timing).
# EN: constant dummy hash so login timing is uniform whether the user exists or not.
_DUMMY_PASSWORD_HASH = hash_password("timing-uniform-dummy-password")

# RO: Cont banat de moderare — refuzat la login și la rotația refresh-ului.
# Verificarea se face DUPĂ validarea parolei, ca să nu devină un oracol de
# enumerare („acest email există și e banat" spus unui atacator fără parolă).
_BANNED_EXC = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Account is banned",
)


# Refresh invalid / expirat / al unui cont inexistent — un singur răspuns.
_INVALID_REFRESH_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid refresh token",
)

_INVALID_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid email or password",
)

_LOCKED_EXC = HTTPException(
    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
    detail="Too many failed login attempts, please retry later",
)


def _audience_for(user: User) -> str:
    """Audiența token-urilor: admin vs client obișnuit (după rolul din DB)."""
    if user.role == ROLE_ADMIN:
        return settings.jwt_audience_admin
    return settings.jwt_audience_app


async def _issue_token_pair(
    db: AsyncSession,
    user: User,
    family_id: str,
    *,
    auth_time: int | None = None,
) -> TokenPair:
    """Emite o pereche access+refresh și persistă o nouă `RefreshSession`.

    `auth_time` = momentul login-ului inițial al familiei (epoch); None = acum
    (login nou). Pentru conturile de admin, refresh-ul expiră la
    `auth_time + admin_refresh_token_expire_hours` — plafon ABSOLUT, pe care
    rotația nu îl prelungește.

    NU face commit — apelantul decide granulele de tranzacție.
    """
    sub = str(user.id)
    jti = uuid.uuid4().hex
    now = datetime.now(timezone.utc)
    if auth_time is None:
        auth_time = int(now.timestamp())
    audience = _audience_for(user)

    if user.role == ROLE_ADMIN:
        expires_at = datetime.fromtimestamp(auth_time, tz=timezone.utc) + timedelta(
            hours=settings.admin_refresh_token_expire_hours
        )
    else:
        expires_at = now + timedelta(days=settings.refresh_token_expire_days)
    if expires_at <= now:
        # Sesiunea de admin și-a atins plafonul: se cere un login nou.
        raise _INVALID_REFRESH_EXC

    access = create_access_token(sub, audience=audience)
    refresh = create_refresh_token(
        sub=sub,
        family_id=family_id,
        jti=jti,
        audience=audience,
        expires_at=expires_at,
        auth_time=auth_time,
    )

    session = RefreshSession(
        user_id=user.id,
        jti=jti,
        family_id=family_id,
        token_hash=hash_token(refresh),  # stocăm doar hash-ul, nu tokenul brut
        expires_at=expires_at,
        revoked=False,
    )
    db.add(session)

    return TokenPair(access_token=access, refresh_token=refresh)


# ---------------------------------------------------------------------------
# Blocare PER CONT după eșecuri de parolă (anti brute-force distribuit)
# ---------------------------------------------------------------------------
#
# Rate limit-ul per IP (`/auth/login` 5/min, `/admin/login` 3/min) nu oprește un
# atacator care ghicește parola UNUI cont de pe sute de IP-uri. Contorul de aici
# e cheiat pe emailul normalizat (hash-uit — fără emailuri în clar în Redis) și e
# comun ambelor rute de login. După `account_lockout_max_failures` eșecuri,
# contul e blocat `account_lockout_minutes` (orice încercare, chiar cu parola
# corectă, primește 429). Contorul se aplică ȘI emailurilor inexistente, deci
# blocarea nu e un oracol de existență.
#
# Store: Redis (comun workerilor) cu degradare la memorie per proces — același
# tipar ca `ratelimit` / anti-replay-ul Telegram. Dezactivat odată cu rate
# limiting-ul (setare sau pytest fără `enable_for_tests`).

_LOCKOUT_PREFIX = "lockout:"


class _InMemoryLockout:
    def __init__(self) -> None:
        self._fails: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()

    def count(self, key: str) -> int:
        now = time.monotonic()
        with self._lock:
            entry = self._fails.get(key)
            if entry is None:
                return 0
            if entry[1] <= now:
                del self._fails[key]
                return 0
            return entry[0]

    def fail(self, key: str, ttl: float) -> None:
        now = time.monotonic()
        with self._lock:
            # Curățare oportunistă: store-ul rămâne mărginit fără cron.
            expired = [k for k, (_, exp) in self._fails.items() if exp <= now]
            for k in expired:
                del self._fails[k]
            count = self._fails.get(key, (0, 0.0))[0]
            self._fails[key] = (count + 1, now + ttl)

    def clear(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._fails.clear()


_lockout_store = _InMemoryLockout()


def reset_lockouts() -> None:
    """Golește store-ul in-memory al blocărilor (teste)."""
    _lockout_store.reset()


def _lockout_key(normalized_email: str) -> str:
    digest = hashlib.sha256(normalized_email.encode("utf-8")).hexdigest()
    return _LOCKOUT_PREFIX + digest


def _lockout_redis():
    limiter = ratelimit._get_redis_limiter()
    if limiter is None:
        return None
    try:
        return limiter._get_client()
    except Exception as exc:  # redis lipsă / URL greșit → degradăm la memorie
        log.warning(
            "lockout: clientul Redis nu poate fi creat, cad pe memorie",
            extra={"error_type": type(exc).__name__},
        )
        ratelimit.reset_backend()
        return None


async def _lockout_failures(key: str) -> int:
    client = _lockout_redis()
    if client is not None:
        try:
            raw = await client.get(key)
            return int(raw or 0)
        except Exception as exc:
            log.warning(
                "lockout: Redis indisponibil, cad pe memorie",
                extra={"error_type": type(exc).__name__},
            )
            ratelimit.reset_backend()
    return _lockout_store.count(key)


async def _lockout_register_failure(key: str) -> None:
    ttl = max(1, int(settings.account_lockout_minutes * 60))
    client = _lockout_redis()
    if client is not None:
        try:
            # INCR + EXPIRE atomic (MULTI/EXEC): o cheie fără TTL ar bloca
            # contul pentru totdeauna.
            async with client.pipeline(transaction=True) as pipe:
                pipe.incr(key)
                pipe.expire(key, ttl)
                await pipe.execute()
            return
        except Exception as exc:
            log.warning(
                "lockout: Redis indisponibil, cad pe memorie",
                extra={"error_type": type(exc).__name__},
            )
            ratelimit.reset_backend()
    _lockout_store.fail(key, ttl)


async def _lockout_clear(key: str) -> None:
    client = _lockout_redis()
    if client is not None:
        try:
            await client.delete(key)
        except Exception:
            ratelimit.reset_backend()
    _lockout_store.clear(key)


async def register(db: AsyncSession, email: str, password: str) -> TokenPair:
    """Înregistrează un user nou și emite prima pereche de token-uri.

    Răspunsul 409 la email existent e păstrat (contract cu clienții); e un
    oracol de existență acceptat și documentat (`docs/backend/security.md`),
    limitat de rate limit-ul per IP pe `/auth/register`.
    """
    normalized = email.strip().lower()
    if is_reserved_email(normalized):
        # Apărare în adâncime (schema `RegisterIn` refuză deja): domeniile
        # sintetice ale serverului nu se înregistrează niciodată cu parolă.
        raise HTTPException(
            status_code=422,
            detail="Invalid email address",
        )

    exists = await db.scalar(select(User).where(User.email == normalized))
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(email=normalized, password_hash=hash_password(password))
    db.add(user)
    await db.flush()  # obținem user.id înainte de a crea sesiunea

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


async def authenticate(
    db: AsyncSession,
    email: str,
    password: str,
    *,
    require_role: str | None = None,
    forbid_role: str | None = None,
) -> TokenPair:
    """Autentifică userul (login) și emite o pereche de token-uri.

    `require_role` (opțional) cere ca userul să aibă EXACT rolul dat, altfel 403.
    Îl folosește login-ul panoului de admin (`POST /admin/login`), care are un
    rate limit mai strict decât login-ul obișnuit.

    Verificarea rolului se face DUPĂ parolă (ca banul): un 403 înaintea validării
    parolei ar fi un oracol — un atacator ar putea inventaria conturile de admin
    fără să știe nicio parolă. Și se face ÎNAINTE de emiterea token-urilor: un
    login de admin respins nu are voie să lase în urmă o sesiune de refresh
    valabilă 30 de zile.

    `forbid_role` (opțional) refuză (403) un cont cu rolul dat — `/auth/login`
    refuză conturile de admin: panoul se loghează DOAR prin `/admin/login`
    (rate limit strict + audit), deci un login de admin pe ruta publică nu are
    niciun motiv legitim și ar ocoli ambele.

    Blocare per cont: după prea multe eșecuri, 429 (vezi `_lockout_*`).
    """
    normalized = email.strip().lower()
    lockout_on = ratelimit._active()
    lockout_key = _lockout_key(normalized)
    if lockout_on and (
        await _lockout_failures(lockout_key) >= settings.account_lockout_max_failures
    ):
        raise _LOCKED_EXC

    user = await db.scalar(select(User).where(User.email == normalized))
    if user is not None and user.is_deleted:
        user = None  # cont purjat GDPR: nu mai există ca subiect autentificabil
    # Rulăm verify_password MEREU (pe hash-ul real sau pe cel dummy) pentru timing
    # uniform, apoi întoarcem un 401 generic, identic pentru „user inexistent" și
    # „parolă greșită" — fără oracol de enumerare.
    password_hash = user.password_hash if user is not None else _DUMMY_PASSWORD_HASH
    try:
        password_ok = verify_password(password, password_hash)
    except ValueError:
        password_ok = False  # hash neidentificabil (ex. "") = nicio parolă validă
    if user is None or not password_ok:
        if lockout_on:
            await _lockout_register_failure(lockout_key)
        raise _INVALID_CREDENTIALS_EXC
    if lockout_on:
        await _lockout_clear(lockout_key)
    if user.is_banned:
        raise _BANNED_EXC
    if require_role is not None and user.role != require_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator privileges required",
        )
    if forbid_role is not None and user.role == forbid_role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Use the administration panel to sign in",
        )

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


async def login_with_identity(db: AsyncSession, email: str) -> TokenPair:
    """Get-or-create pentru o identitate externă (Apple/Google/telefon).

    `email` este un email derivat determinist (ex. `google_{sub}@ext.flirt` sau
    `phone_{msisdn}@ext.flirt`), ca să refolosim modelul `User` existent fără a-l
    modifica. Nu există parolă utilizabilă: userul se autentifică doar prin
    provider, așa că stocăm un hash aleator, imposibil de reprodus.
    """
    normalized = email.strip().lower()

    user = await db.scalar(select(User).where(User.email == normalized))
    if user is None:
        user = User(
            email=normalized,
            password_hash=hash_password(uuid.uuid4().hex),  # parolă inutilizabilă
            profile_completed=False,
        )
        db.add(user)
        await db.flush()  # obținem user.id înainte de a crea sesiunea
    elif user.is_deleted:
        # Defensiv: purjarea GDPR schimbă emailul, deci un rând șters nu ar trebui
        # găsit aici. Dacă totuși e (date vechi), NU îl reînviem.
        raise _INVALID_CREDENTIALS_EXC
    elif user.is_banned:
        # Login social/OTP nu are voie să ocolească banul (altfel „ștergi appul,
        # intri cu Google" și contul banat revine la viață).
        raise _BANNED_EXC

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    return pair


def telegram_identity_email(telegram_id: int) -> str:
    """Emailul sintetic determinist al unei identități Telegram.

    `User.email` e NOT NULL și UNIQUE, iar schimbarea asta ar atinge tot modelul —
    deci facem ca la Apple/Google/telefon: un email derivat, care nu aparține
    niciunui domeniu real (`.flirt` nu e un TLD valid, deci nu poate fi
    revendicat de nimeni și nu primește niciodată mail).
    """
    return f"telegram_{telegram_id}@ext.flirt"


async def login_with_telegram(
    db: AsyncSession, telegram_user: TelegramUser
) -> TokenPair:
    """Get-or-create pentru o identitate Telegram VERIFICATĂ (Mini App).

    Sursa de adevăr e coloana `users.telegram_user_id`, nu emailul sintetic:
    emailul e doar compatibilitate cu modelul existent. Căutarea pe email rămâne
    ca punte pentru conturile create înainte de coloană — dacă emailul sintetic
    există, e prin definiție ACELAȘI user (e derivat determinist din id-ul de
    Telegram), deci îl re-legăm, nu creăm un duplicat care ar sparge UNIQUE.

    NU legăm automat un cont găsit după emailul REAL sau după telefon: „am același
    email pe Telegram" nu dovedește că e aceeași persoană, iar o legare automată
    ar fi o preluare de cont (cineva își pune pe Telegram emailul victimei).
    Legarea unui cont existent la Telegram e un flux separat, pornit din contul
    deja autentificat.

    Întoarce perechea de token-uri (același drum ca `login_with_identity`), nu
    obiectul `User`: ruta are nevoie de token-uri, iar emiterea lor trebuie să
    rămână în aceeași tranzacție cu crearea contului.
    """
    telegram_id = int(telegram_user.id)
    now = datetime.now(timezone.utc)

    user = await db.scalar(
        select(User).where(User.telegram_user_id == telegram_id)
    )
    if user is not None and user.is_deleted:
        # Cont purjat GDPR care încă poartă identitatea Telegram (purjări de
        # dinainte ca `purge_user_data` să golească aceste câmpuri). NU îl
        # refolosim — ar însemna să rescriem date personale pe un rând
        # anonimizat și ca persoana să nu-și mai poată face niciodată cont nou.
        # Desprindem identitatea și creăm mai jos un cont proaspăt.
        user.telegram_user_id = None
        user.telegram_linked_at = None
        user.telegram_language = None
        await db.flush()  # eliberăm indexul UNIQUE înainte de noul rând
        user = None
    if user is None:
        email = telegram_identity_email(telegram_id)
        user = await db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(uuid.uuid4().hex),  # parolă inutilizabilă
                profile_completed=False,
            )
            db.add(user)
        else:
            # Rând găsit după emailul sintetic, fără identitate Telegram legată:
            # fie un cont Telegram creat înainte de coloana `telegram_user_id`,
            # fie un cont PRE-ÎNREGISTRAT de un atacator prin `/auth/register`
            # cu parola lui (posibil înainte ca domeniul `ext.flirt` să fie
            # rezervat). Nu le putem deosebi, deci neutralizăm orice acces
            # străin înainte de legare: parolă nouă, imposibil de reprodus, și
            # toate sesiunile de refresh existente revocate. Proprietarul real
            # al identității Telegram e singurul care mai intră.
            if user.telegram_user_id is not None or user.is_deleted:
                # Emailul `telegram_{id}` e legat de ALTĂ identitate Telegram
                # (sau aparține unui rând purjat) — anomalie; nu legăm nimic.
                log.warning("Login Telegram: conflict de email sintetic")
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Account conflict",
                )
            user.password_hash = hash_password(uuid.uuid4().hex)
            await db.execute(
                update(RefreshSession)
                .where(RefreshSession.user_id == user.id)
                .values(revoked=True)
            )
        if user.is_banned:
            raise _BANNED_EXC
        # Legarea identității: se scrie DOAR aici, o singură dată.
        user.telegram_user_id = telegram_id
        user.telegram_linked_at = now
        await db.flush()  # obținem user.id înainte de a crea sesiunea
    elif user.is_banned:
        # Login-ul prin Telegram nu are voie să ocolească banul (altfel „șterg
        # appul, intru din bot" și contul banat revine la viață).
        raise _BANNED_EXC

    # Intrarea în Mini App e activitate reală a contului — vezi
    # `account_service.touch_last_active` pentru semnificația câmpului.
    user.last_active_at = now
    # Limba în care îi va scrie botul (notificări `tg_notify`): reîmprospătată la
    # fiecare login, ca o schimbare de limbă în Telegram să ajungă și la noi.
    # `lang_for` mapează orice cod pe ro/ru/en (necunoscut → ro).
    user.telegram_language = bot_texts.lang_for(telegram_user.language_code)
    # Poza din Telegram = avatarul de rezervă (cât timp userul n-are poze
    # proprii). Reîmprospătată la fiecare login; copia din storage o aduce un
    # task în fundal, după commit — login-ul nu așteaptă rețeaua.
    stale_avatar = telegram_avatar.apply_login_photo(user, telegram_user.photo_url)

    pair = await _issue_token_pair(db, user, family_id=uuid.uuid4().hex)
    await db.commit()
    await telegram_avatar.delete_stored(stale_avatar)
    telegram_avatar.schedule_refresh(
        user.id,
        telegram_id,
        had_photo_url=telegram_avatar.sanitize_photo_url(telegram_user.photo_url) is not None,
    )
    return pair


async def _revoke_family(db: AsyncSession, family_id: str) -> None:
    """Revocă toate sesiunile dintr-o familie (folosit la reuse detection)."""
    await db.execute(
        update(RefreshSession)
        .where(RefreshSession.family_id == family_id)
        .values(revoked=True)
    )


async def rotate_refresh(db: AsyncSession, refresh_token: str) -> TokenPair:
    """Rotește un refresh token cu detectarea reutilizării.

    - token invalid/expirat → 401
    - sesiune inexistentă → 401
    - sesiune deja revocată → REUSE: revocă întreaga familie → 401
    - cont purjat (GDPR) / inexistent → 401
    - altfel → revocă vechiul jti, emite pereche nouă în aceeași familie

    Rândul sesiunii e citit cu `SELECT ... FOR UPDATE`: două cereri concurente
    cu ACELAȘI refresh token se serializează, iar a doua vede `revoked=True` și
    declanșează reuse detection — în loc să emită amândouă câte o pereche validă.
    """
    invalid = _INVALID_REFRESH_EXC

    try:
        payload = decode_token(refresh_token)
    except JWTError:
        raise invalid

    if payload.get("type") != "refresh":
        raise invalid

    jti = payload.get("jti")
    family_id = payload.get("family_id")
    sub = payload.get("sub")
    if not jti or not family_id or not sub:
        raise invalid

    session = await db.scalar(
        select(RefreshSession)
        .where(RefreshSession.jti == jti)
        .with_for_update()
    )
    if session is None:
        raise invalid

    # Reuse detection: un token deja revocat este reutilizat → compromitem
    # întreaga familie și refuzăm.
    if session.revoked:
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise invalid

    # Verificare defensivă: hash-ul trebuie să corespundă tokenului prezentat.
    if session.token_hash != hash_token(refresh_token):
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise invalid

    # Expirare (dublă verificare pe lângă `exp` din JWT). Pe SQLite datetime-ul
    # revine „naive"; îl tratăm ca UTC pentru o comparație corectă.
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise invalid

    user = await db.get(User, session.user_id)
    if user is None or str(user.id) != str(sub):
        raise invalid
    if user.is_deleted:
        # Purjarea șterge sesiunile, deci aici ajunge doar o sesiune rămasă din
        # date vechi — o revocăm și refuzăm: contul nu mai există.
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise invalid
    if user.is_banned:
        # Fără asta, un cont banat își putea prelungi la nesfârșit accesul
        # rotind refresh token-ul emis înainte de ban.
        session.revoked = True
        await _revoke_family(db, session.family_id)
        await db.commit()
        raise _BANNED_EXC

    # Rotație: revocăm sesiunea curentă și emitem una nouă în aceeași familie.
    # `auth_time` (login-ul inițial) trece neschimbat prin rotații: pe el se
    # calculează plafonul absolut al sesiunii de admin. Token vechi fără claim →
    # tratat ca login acum (tranziție; se aplică doar o dată per familie).
    auth_time = payload.get("auth_time")
    if not isinstance(auth_time, int) or isinstance(auth_time, bool):
        auth_time = None

    session.revoked = True
    pair = await _issue_token_pair(
        db, user, family_id=session.family_id, auth_time=auth_time
    )
    await db.commit()
    return pair


async def logout(db: AsyncSession, refresh_token: str) -> None:
    """Revocă sesiunea corespunzătoare refresh token-ului (idempotent)."""
    try:
        payload = decode_token(refresh_token)
    except JWTError:
        # Logout e best-effort; un token invalid nu trebuie să eșueze zgomotos.
        return

    jti = payload.get("jti")
    if not jti:
        return

    session = await db.scalar(
        select(RefreshSession).where(RefreshSession.jti == jti)
    )
    if session is not None and not session.revoked:
        session.revoked = True
        await db.commit()
