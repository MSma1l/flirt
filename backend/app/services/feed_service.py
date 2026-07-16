"""Logica feed-ului de swipe + match-uri (TZ secț. 4).

Feed-ul are DOUĂ etape distincte (ca orice sistem de recomandare corect):

1. RETRIEVAL (SQL) — toate filtrele DURE se aplică în bază, pe index-uri:
   profil completat, 18+ (aplicația e 18+ only), genurile căutate
   (`interested_in`), intervalul de vârstă, raza de căutare (bounding-box pe
   `lat`/`lng`), excluderile (swipe-uit / blocat / ascuns) prin `NOT EXISTS`,
   inactivitatea. Ordinea e DETERMINISTĂ (recența activității + tie-break pe id),
   deci fereastra de candidați nu mai e un eșantion arbitrar din heap.

2. RANKING (Python, pur) — `compute_compatibility` peste fereastra retrievată,
   cu distanța reală injectată (calculată din coordonatele PERSISTATE, fără
   niciun apel de rețea per candidat). Rezultatul e paginat cu cursor pe
   (scor, user_id) — fără duplicate între pagini.
"""
from __future__ import annotations

import base64
import binascii
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import String, and_, cast, func, nullslast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.account import Block, UserSettings
from app.models.chat import Chat, Message
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.schemas.feed import FeedCard, FeedPage, MatchOut, SwipeResult, UndoResult
from app.services import account_service, billing, chat_service, geo, push
from app.services.compatibility import compute_compatibility
from app.services.contact_masker import mask_contacts

logger = logging.getLogger("app.feed")

# --- Reguli de business (din config, nu hardcodate în mijlocul logicii) ------
MAX_TOP_INTERESTS = 3   # câte interese afișăm pe cartelă (TZ 4.1)
# Caracterul de escape pentru LIKE (pre-filtrul pe limbi): neutralizează `%`/`_`
# dintr-o valoare venită de la user.
_LIKE_ESCAPE = "\\"


def _calc_age(birth_date: date, today: date | None = None) -> int:
    """Vârsta în ani împliniți la `today` (implicit azi)."""
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _shift_years(d: date, years: int) -> date:
    """`d` mutat cu `years` ani în trecut (29 feb → 28 feb în anii nebisecți)."""
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 februarie într-un an nebisect
        return d.replace(year=d.year - years, day=28)


def _birth_date_bounds(
    age_min: int, age_max: int, today: date | None = None
) -> tuple[date, date]:
    """Intervalul de `birth_date` care corespunde vârstelor [age_min, age_max].

    Convertim intervalul de VÂRSTĂ într-un interval de DATE ca filtrul să fie o
    comparație pe coloana indexată `birth_date` (SARGable, folosește indexul),
    nu un calcul de vârstă per rând în Python.

    Întoarce `(earliest, latest)` cu semantica: `earliest <= birth_date <= latest`
      - `latest`   = azi − age_min ani  ⇒ cine s-a născut mai târziu are < age_min;
      - `earliest` = azi − (age_max+1) ani + 1 zi ⇒ cine s-a născut mai devreme
        are deja > age_max.
    """
    today = today or date.today()
    latest = _shift_years(today, age_min)
    earliest = _shift_years(today, age_max + 1) + timedelta(days=1)
    return earliest, latest


def _normalized_pair(x: uuid.UUID, y: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Ordonează perechea (mai mic, mai mare) după reprezentarea string a UUID."""
    return (x, y) if str(x) <= str(y) else (y, x)


# --- Cursor de paginare ------------------------------------------------------
def _encode_cursor(score: int, user_id: uuid.UUID) -> str:
    """Cursor opac (base64url) peste cheia de sortare a ultimei cartele redate."""
    raw = f"{score}:{user_id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[int, str]:
    """Decodează cursorul → (scor, user_id ca string). 422 dacă e stricat."""
    try:
        padding = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + padding).decode()
        score_str, user_id_str = raw.split(":", 1)
        # Validăm forma UUID; un cursor fabricat nu poate injecta nimic.
        return int(score_str), str(uuid.UUID(user_id_str))
    except (ValueError, binascii.Error, UnicodeDecodeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cursor de paginare invalid.",
        )


def _sort_key(score: int, user_id: uuid.UUID | str) -> tuple[int, str]:
    """Cheia de ordonare a feed-ului: scor DESCRESCĂTOR, apoi user_id (tie-break).

    Ordonarea e TOTALĂ (user_id e unic), deci paginarea pe cursor nu poate
    întoarce duplicate și nici nu poate sări cartele la scoruri egale.
    """
    return (-score, str(user_id))


async def _interests_by_profile(
    db: AsyncSession, profile_ids: list[uuid.UUID]
) -> dict[uuid.UUID, set[str]]:
    """Mapează profile_id -> set de slug-uri de interese, pentru multe profiluri."""
    if not profile_ids:
        return {}
    result = await db.execute(
        select(ProfileInterest.profile_id, Interest.slug)
        .join(Interest, Interest.id == ProfileInterest.interest_id)
        .where(ProfileInterest.profile_id.in_(profile_ids))
    )
    mapping: dict[uuid.UUID, set[str]] = {}
    for profile_id, slug in result.all():
        mapping.setdefault(profile_id, set()).add(slug)
    return mapping


def _has_min_photos(profile: Profile) -> bool:
    """True dacă profilul are cel puțin `settings.min_photos` poze (gate de feed).

    Varianta Python a filtrului SQL `_min_photos_clause` — folosită acolo unde
    profilul e deja încărcat (gate-ul propriu din `get_feed`, `_authorize_swipe`).
    """
    return len(profile.photos or []) >= settings.min_photos


def _min_photos_clause():
    """Filtru SQL: profilul are cel puțin `settings.min_photos` poze (TZ / principiu).

    DE CE ÎN SQL: e un filtru DUR de retrieval, exact ca 18+ sau genul căutat.
    Aplicat în Python DUPĂ fetch ar strica și paginarea (fereastra de
    `feed_scan_limit` s-ar goli neuniform), și performanța.

    DE CE `json_array_length` ȘI NU `users.profile_completed`: flagul de pe `users`
    e o OGLINDĂ, sincronizată de `profile_service._sync_profile_completed` la
    scriere. Rândurile vechi (dinaintea acelui fix) pot avea `profile_completed=true`
    cu zero poze, deci oglinda ar lăsa exact profilurile-problemă în feed. Numărăm
    pozele la SURSĂ — filtrul e adevărat și fără niciun backfill.

    FĂRĂ N+1: `photos` e o coloană JSON pe `profiles` (nu o relație), deci numărarea
    se face în același scan ca restul predicatelor — zero query-uri suplimentare.
    `json_array_length` există și în Postgres, și în SQLite (JSON1), ca `LIKE`-ul din
    `_language_prefilter`. Un `photos` NULL (rând legacy) dă NULL ⇒ rândul e exclus,
    exact comportamentul dorit.

    `min_photos <= 0` (config) = poartă dezactivată → None (fără predicat).
    """
    if settings.min_photos <= 0:
        return None
    return func.json_array_length(Profile.photos) >= settings.min_photos


def _has_common_language(a: Profile, b: Profile) -> bool:
    """True dacă cele două profiluri au cel puțin o limbă comună (gate TZ 4.6)."""
    la = {str(x) for x in (a.languages or []) if x}
    lb = {str(x) for x in (b.languages or []) if x}
    return bool(la & lb)


def _distance_between(a: Profile, b: Profile) -> float | None:
    """Distanța reală (km) între două profiluri, din coordonatele PERSISTATE.

    Funcție PURĂ, fără I/O: geocodarea s-a făcut o dată, la salvarea anketei.
    `None` = cel puțin unul dintre orașe nu a putut fi geocodat ⇒ distanță
    necunoscută (scor neutru, fără penalizare).
    """
    if a.lat is None or a.lng is None or b.lat is None or b.lng is None:
        return None
    return geo.haversine_km(float(a.lat), float(a.lng), float(b.lat), float(b.lng))


def _language_prefilter(my_languages: list[str]):
    """PRE-filtru SQL pentru gate-ul pe limbă (I3 / TZ 4.6).

    `Profile.languages` e o listă JSON; intersecția de liste nu are un operator
    PORTABIL între SQLite și Postgres, așa că prefiltrăm cu un `LIKE` pe forma
    textuală a JSON-ului (`… "ro" …`) — suficient de selectiv ca fereastra de
    candidați să nu se irosească pe profiluri fără limbă comună. Gate-ul EXACT
    rămâne `_has_common_language`, aplicat după retrieval: un eventual fals
    pozitiv al LIKE-ului nu poate trece de el.

    `%` și `_` din valoarea userului sunt escape-uite (o limbă „custom" nu poate
    lărgi predicatul).
    """
    clauses = []
    for lang in my_languages:
        literal = str(lang).replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
        literal = literal.replace("%", f"{_LIKE_ESCAPE}%").replace(
            "_", f"{_LIKE_ESCAPE}_"
        )
        clauses.append(
            cast(Profile.languages, String).like(f'%"{literal}"%', escape=_LIKE_ESCAPE)
        )
    return or_(*clauses) if clauses else None


async def get_feed(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> FeedPage:
    """O pagină din feed-ul lui `user`, sortată descrescător după compatibilitate.

    Filtre DURE (toate în SQL, pe index-uri):
      - profil completat, nu userul curent;
      - **18+** (aplicația e 18+ only) — gate dur, independent de preferințe;
      - genurile căutate (`interested_in`) și intervalul de vârstă (`age_min`,
        `age_max`) — fără ele un bărbat heterosexual primea bărbați în feed;
      - raza de căutare (`search_radius_km`) — bounding-box pe `lat`/`lng`, apoi
        haversine EXACT în Python (setarea nu mai e decorativă);
      - excluderi prin `NOT EXISTS` (nu prin `NOT IN` cu liste materializate):
        deja swipe-uiți, blocați în orice direcție (I1), profil ascuns (I2);
      - conturi inactive de peste `feed_max_inactive_days`;
      - limbă comună (I3): pre-filtru în SQL + gate exact în Python.

    Ranking: `compute_compatibility` (pur), cu distanța reală injectată.
    Paginare: cursor pe (scor, user_id) — fără duplicate între pagini.
    """
    # Limita implicită + plafonul vin din config (fără hardcodare).
    limit = settings.feed_limit if limit is None else limit
    limit = max(0, min(limit, settings.feed_max_limit))

    # Profilul propriu — fără el nu putem calcula compatibilitate.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        return FeedPage(items=[], next_cursor=None)

    # 18+ ONLY, defense-in-depth: un cont vechi rămas cu vârstă sub prag NU
    # primește feed (chiar dacă anketa lui a trecut cândva de validare).
    if _calc_age(my_profile.birth_date) < settings.adult_age:
        return FeedPage(items=[], next_cursor=None)

    # Un profil FĂRĂ poze nu e complet (principiu al aplicației: într-un app de
    # dating, un profil gol e inutil). Cine nu apare în feedul altora nu primește
    # nici feed — poarta e simetrică, ca la 18+.
    if not _has_min_photos(my_profile):
        return FeedPage(items=[], next_cursor=None)

    # Cererea de feed e o dovadă de activitate (scriere rară, cu prag din config).
    await account_service.touch_last_active(db, user)

    prefs = await account_service.get_search_preferences(db, user.id)
    today = date.today()

    # --- 1. RETRIEVAL: filtre dure în SQL ------------------------------------
    conditions = [
        Profile.completed.is_(True),
        Profile.user_id != user.id,
    ]

    # 18+ (gate dur, NU derivat din preferințe) — un profil sub prag nu apare
    # niciodată în feed, oricât de permisive ar fi preferințele salvate.
    conditions.append(Profile.birth_date <= _shift_years(today, settings.adult_age))

    # POZE (gate dur, principiu al aplicației): un profil cu anketă completă dar
    # ZERO poze NU are ce căuta în feedul nimănui. Filtrul stă în SQL, în același
    # scan (vezi `_min_photos_clause`).
    photos_clause = _min_photos_clause()
    if photos_clause is not None:
        conditions.append(photos_clause)

    # Intervalul de vârstă căutat (preferință) — tot pe coloana indexată.
    earliest, latest = _birth_date_bounds(prefs.age_min, prefs.age_max, today)
    conditions.append(Profile.birth_date >= earliest)
    conditions.append(Profile.birth_date <= latest)

    # Gen / orientare: genurile căutate. Listă goală = fără restricție.
    if prefs.interested_in:
        conditions.append(Profile.gender.in_(list(prefs.interested_in)))

    # Excluderi prin NOT EXISTS (semi-join pe index), nu `NOT IN (…10.000 uuid)`.
    conditions.append(
        ~select(Like.id)
        .where(Like.from_user_id == user.id, Like.to_user_id == Profile.user_id)
        .exists()
    )
    conditions.append(
        ~select(Block.id)
        .where(
            or_(
                and_(
                    Block.blocker_id == user.id,
                    Block.blocked_id == Profile.user_id,
                ),
                and_(
                    Block.blocker_id == Profile.user_id,
                    Block.blocked_id == user.id,
                ),
            )
        )
        .exists()
    )
    conditions.append(
        ~select(UserSettings.id)
        .where(
            UserSettings.user_id == Profile.user_id,
            UserSettings.profile_hidden.is_(True),
        )
        .exists()
    )
    # Conturi BANATE de moderare: nu apar în feed-ul nimănui. Filtrul stă pe
    # coloana indexată `users.banned_at` (join-ul cu User există deja mai jos),
    # deci nu adaugă niciun cost de scanare.
    conditions.append(User.banned_at.is_(None))

    # Conturi abandonate: inactive de peste N zile (0 = filtru oprit).
    # `last_active_at IS NULL` = rând vechi, dinainte de coloană → tratat ca activ.
    if settings.feed_max_inactive_days > 0:
        inactive_cutoff = datetime.now(timezone.utc) - timedelta(
            days=settings.feed_max_inactive_days
        )
        conditions.append(
            or_(
                User.last_active_at.is_(None),
                User.last_active_at >= inactive_cutoff,
            )
        )

    # Limbă comună — pre-filtru SQL (gate-ul exact vine mai jos, în Python).
    lang_clause = _language_prefilter(
        [str(x) for x in (my_profile.languages or []) if x]
    )
    if lang_clause is not None:
        conditions.append(lang_clause)

    # Raza de căutare: bounding-box pe coordonatele persistate (index lat/lng).
    # Candidații FĂRĂ coordonate (oraș negeocodabil) NU sunt eliminați aici —
    # distanța lor e necunoscută, iar un filtru pe rază nu poate decide: ar fi
    # o excludere arbitrară. Ei rămân, cu scor de distanță neutru.
    apply_radius = (
        settings.feed_radius_filter_enabled
        and prefs.radius_km > 0
        and my_profile.lat is not None
        and my_profile.lng is not None
    )
    if apply_radius:
        min_lat, max_lat, min_lng, max_lng = geo.bounding_box(
            float(my_profile.lat), float(my_profile.lng), prefs.radius_km
        )
        box = [Profile.lat.between(min_lat, max_lat)]
        if min_lng is not None and max_lng is not None:
            box.append(Profile.lng.between(min_lng, max_lng))
        conditions.append(or_(Profile.lat.is_(None), and_(*box)))

    # ORDER BY DETERMINIST + plafon de scanare (anti-DoS, `feed_scan_limit`).
    # Fereastra nu mai e un eșantion arbitrar din heap: e „cei mai recent activi"
    # candidați ELIGIBILI (candidate generation), peste care se aplică ranking-ul.
    stmt = (
        select(Profile)
        .join(User, User.id == Profile.user_id)
        .where(*conditions)
        .order_by(nullslast(User.last_active_at.desc()), Profile.user_id)
        .limit(max(0, settings.feed_scan_limit))
    )
    candidates = list((await db.execute(stmt)).scalars().all())

    # Gate EXACT pe limbă (I3): pre-filtrul SQL e o aproximare, aici e adevărul.
    candidates = [p for p in candidates if _has_common_language(my_profile, p)]

    # --- 2. RANKING: scor pur, cu distanța reală injectată --------------------
    if not candidates:
        return FeedPage(items=[], next_cursor=None)

    interests_map = await _interests_by_profile(
        db, [my_profile.id] + [p.id for p in candidates]
    )
    my_interests = interests_map.get(my_profile.id, set())

    scored: list[tuple[int, Profile, set[str], float | None]] = []
    for p in candidates:
        distance_km = _distance_between(my_profile, p)
        # Filtru EXACT pe rază (bounding-box-ul e doar un superset al cercului).
        if apply_radius and distance_km is not None and distance_km > prefs.radius_km:
            continue
        p_interests = interests_map.get(p.id, set())
        score = compute_compatibility(
            my_profile, p, my_interests, p_interests, distance_km
        )
        scored.append((score, p, p_interests, distance_km))

    # Ordonare TOTALĂ, deterministă: scor desc, apoi user_id (tie-break).
    scored.sort(key=lambda item: _sort_key(item[0], item[1].user_id))

    # --- 3. PAGINARE pe cursor -----------------------------------------------
    if cursor:
        after = _decode_cursor(cursor)
        scored = [
            item
            for item in scored
            if _sort_key(item[0], item[1].user_id) > _sort_key(after[0], after[1])
        ]

    page = scored[:limit]
    next_cursor = (
        _encode_cursor(page[-1][0], page[-1][1].user_id)
        if page and len(scored) > len(page)
        else None
    )

    cards = [
        FeedCard(
            user_id=p.user_id,
            name=p.name,
            age=_calc_age(p.birth_date),
            gender=p.gender,
            city=p.city,
            # Distanța reală (TZ 7), din coordonatele persistate. Fără rețea.
            distance_km=None if distance_km is None else round(distance_km),
            about=p.about,
            top_interests=sorted(p_interests)[:MAX_TOP_INTERESTS],
            languages=list(p.languages or []),
            compatibility=score,
            photos=list(p.photos or []),
        )
        for score, p, p_interests, distance_km in page
    ]
    return FeedPage(items=cards, next_cursor=next_cursor)


async def _authorize_swipe(
    db: AsyncSession, user: User, target_user_id: uuid.UUID
) -> None:
    """Validează dreptul de a face swipe pe `target_user_id` (breșă critică).

    Reproduce controalele din `get_feed` la nivel de acțiune, ca ținta să nu
    poată fi lovită direct prin `POST /feed/swipe` ocolind feed-ul. Ridică
    HTTPException (403/404) la orice încălcare; 404 „neutru" acolo unde nu vrem
    să divulgăm existența/starea contului țintă.
    """
    # Self-match interzis (nu-ți poți da like ție însuți).
    if target_user_id == user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nu poți face swipe pe propriul profil.",
        )

    # Profilul propriu — incomplet ⇒ interzis.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profilul tău nu este complet.",
        )

    # Profilul țintei — inexistent SAU incomplet ⇒ 404 (nu divulgăm starea).
    target_result = await db.execute(
        select(Profile).where(Profile.user_id == target_user_id)
    )
    target_profile = target_result.scalar_one_or_none()
    if target_profile is None or not target_profile.completed:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # 18+ ONLY (defense-in-depth). Separarea pe grupe de vârstă a dispărut odată
    # cu segmentul 16–17, dar gate-ul DUR rămâne: dacă un cont vechi are sub
    # `adult_age`, NU poate da swipe și NU poate fi swipe-uit — nici prin API
    # direct, ocolind feed-ul.
    if _calc_age(my_profile.birth_date) < settings.adult_age:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Aplicația este disponibilă doar de la {settings.adult_age} ani.",
        )
    if _calc_age(target_profile.birth_date) < settings.adult_age:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # POZE — aceeași filozofie ca poarta 18+: bidirecțional și la nivel de ACȚIUNE,
    # nu doar de listare. Fără asta, un profil gol dispărea din feed dar rămânea
    # swipe-abil prin `POST /feed/swipe` de către oricine îi știa id-ul, iar un user
    # fără poze putea colecta match-uri fără să apară vreodată în feedul altcuiva.
    if not _has_min_photos(my_profile):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profilul tău nu este complet.",
        )
    if not _has_min_photos(target_profile):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # I1 — block în ORICE direcție (eu → el sau el → eu).
    block_result = await db.execute(
        select(Block.id).where(
            or_(
                and_(
                    Block.blocker_id == user.id,
                    Block.blocked_id == target_user_id,
                ),
                and_(
                    Block.blocker_id == target_user_id,
                    Block.blocked_id == user.id,
                ),
            )
        )
    )
    if block_result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Interacțiune blocată."
        )

    # I2 — profil ascuns ⇒ indisponibil pentru swipe (404 neutru).
    hidden_result = await db.execute(
        select(UserSettings.user_id).where(
            UserSettings.user_id == target_user_id,
            UserSettings.profile_hidden.is_(True),
        )
    )
    if hidden_result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # I4 — țintă BANATĂ de moderare ⇒ indisponibilă pentru swipe (404 neutru).
    # Fără asta, un cont banat rămânea „swipe-abil" direct prin `POST /feed/swipe`
    # de către oricine îi cunoștea id-ul, chiar dacă dispăruse din feed.
    banned_result = await db.execute(
        select(User.id).where(User.id == target_user_id, User.banned_at.is_not(None))
    )
    if banned_result.first() is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )


async def _enforce_daily_swipe_limit(db: AsyncSession, user: User) -> None:
    """Aplică limita de swipe/zi pentru useri non-premium (TZ 4.5).

    Premium (entitlement `premium`) = fără limită. Non-premium: numărăm Like-urile
    userului din ultimele 24h; la atingerea `settings.free_daily_swipe_limit`
    ridicăm 429 (Too Many Requests). Limita vine din config, nu hardcodată.
    """
    ent = await billing.entitlements(db, user)
    if ent.premium:
        return

    since = datetime.now(timezone.utc) - timedelta(hours=24)
    count_result = await db.execute(
        select(func.count())
        .select_from(Like)
        .where(Like.from_user_id == user.id, Like.created_at >= since)
    )
    used = int(count_result.scalar_one())
    if used >= settings.free_daily_swipe_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Ai atins limita zilnică de swipe-uri. "
                "Treci pe Premium pentru swipe nelimitat."
            ),
        )


async def swipe(
    db: AsyncSession,
    user: User,
    target_user_id: uuid.UUID,
    action: str,
    message: str | None = None,
) -> SwipeResult:
    """Înregistrează un swipe; creează Match dacă like-ul e reciproc (TZ 4.4/4.7).

    Un `message` opțional se atașează like-ului (`deferred_message`) și devine
    vizibil ca mesaj de chat abia când swipe-ul produce un match reciproc (TZ 4.7).

    Securitate (breșă critică): `swipe` aplică ACELEAȘI controale ca feed-ul —
    gate dur 18+, block în orice direcție, profil ascuns, profil
    incomplet/inexistent și interdicția de self-match — ca ținta să nu poată fi
    swipe-uită direct, ocolind filtrele din `get_feed`.
    """
    # --- Age-gate + authz pe țintă (înainte de ORICE scriere) -----------------
    await _authorize_swipe(db, user, target_user_id)

    # Swipe = activitate reală (scriere rară, cu prag din config).
    await account_service.touch_last_active(db, user)

    is_like = action == "like"
    # Mesajul deferred are sens doar pentru like (nu pentru dislike).
    deferred = message if (is_like and message) else None

    # Upsert Like direcțional (from user -> target).
    existing_result = await db.execute(
        select(Like).where(
            Like.from_user_id == user.id,
            Like.to_user_id == target_user_id,
        )
    )
    like = existing_result.scalar_one_or_none()
    if like is None:
        # Limită de swipe/zi pentru non-premium (TZ 4.5) — se aplică DOAR la un
        # swipe NOU (re-swipe pe același target nu consumă din cotă).
        await _enforce_daily_swipe_limit(db, user)
        like = Like(
            from_user_id=user.id,
            to_user_id=target_user_id,
            is_like=is_like,
            deferred_message=deferred,
        )
        db.add(like)
    else:
        like.is_like = is_like
        # Re-swipe cu mesaj nou îl actualizează; fără mesaj păstrăm ce era.
        if deferred is not None:
            like.deferred_message = deferred

    # Fără like nu poate exista match.
    if not is_like:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Verifică like-ul reciproc (target -> user).
    reciprocal_result = await db.execute(
        select(Like).where(
            Like.from_user_id == target_user_id,
            Like.to_user_id == user.id,
            Like.is_like.is_(True),
        )
    )
    reciprocal = reciprocal_result.scalar_one_or_none()
    if reciprocal is None:
        await db.commit()
        return SwipeResult(matched=False, match_id=None)

    # Match! Stocăm perechea normalizată (idempotent).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    if match is None:
        match = Match(user_a_id=a_id, user_b_id=b_id)
        db.add(match)
        await db.flush()

    # La producerea unui match asigurăm (idempotent) un chat pentru el, ca
    # dialogul să existe imediat (TZ 4.7/5.1). Refolosim logica din chat_service.
    chat = await chat_service.ensure_chat_for_match(db, match)

    # Livrăm mesajele deferred: pentru fiecare like din pereche (A->B și B->A)
    # care are `deferred_message`, creăm un mesaj în chat de la autorul like-ului
    # și consumăm textul (îl golim ca să nu-l re-livrăm la un eventual re-swipe).
    await _deliver_deferred_messages(db, chat, like, reciprocal)

    await db.commit()

    # Notificarea de match pleacă DUPĂ commit — vezi `_notify_match` pentru de ce.
    # Doar către CELĂLALT user: cel care tocmai a dat swipe vede match-ul direct
    # în răspunsul HTTP (`matched: True`), deci n-are ce să-l anunțe.
    await _notify_match(db, target_user_id)

    return SwipeResult(matched=True, match_id=match.id, chat_id=chat.id)


async def _notify_match(db: AsyncSession, other_user_id: uuid.UUID) -> None:
    """Anunță prin push userul care tocmai a primit like-ul reciproc (TZ 6.3).

    ORDINEA FAȚĂ DE COMMIT (deliberată): notificarea se trimite DUPĂ `db.commit()`.
    Dacă am trimite-o înainte și tranzacția ar pica, userul ar primi o notificare
    pentru un match care nu există — o minciună pe care nu o mai putem retrage și
    care îl trimite într-un chat inexistent. Invers, dacă push-ul pică după commit,
    match-ul și chat-ul rămân create, iar userul le vede la prima deschidere a
    aplicației: o notificare pierdută e mult mai ieftină decât un match pierdut.

    BEST-EFFORT: prindem ORICE excepție. `send_to_user` e deja robust la erori HTTP
    per token, dar mai poate arunca din alte motive (provider necunoscut în config →
    `NotImplementedError`, DB indisponibil la citirea token-urilor, timeout). Niciuna
    nu are voie să iasă spre apelant: match-ul e deja comis, iar un swipe care
    întoarce 500 după ce a creat match-ul ar fi un bug mult mai grav decât o
    notificare nelivrată. Cu `push_provider='stub'` (implicit) doar se loghează.
    """
    try:
        await push.send_to_user(
            db,
            other_user_id,
            "Aveți un match! 💜",
            "V-ați plăcut reciproc. Trimite-i primul mesaj!",
        )
    except Exception:  # noqa: BLE001 — un push căzut nu are voie să rupă match-ul
        logger.warning(
            "Push de match nelivrat către user_id=%s — match-ul și chat-ul rămân "
            "create, userul le vede la următoarea deschidere a aplicației.",
            other_user_id,
            exc_info=True,
        )


async def _deliver_deferred_messages(
    db: AsyncSession,
    chat: Chat,
    *like_pair: Like,
) -> None:
    """Creează câte un `Message` pentru fiecare like cu `deferred_message` (TZ 4.7).

    Inserează direct prin modelul `Message` (fără commit — apelantul comite), dar
    APLICĂ mascarea contactelor (breșă: mesajul deferred ajungea în chat nemascat,
    permițând schimb de telefon/telegram/email la primul match, ocolind TZ 5.5).
    `was_masked` reflectă dacă s-a ascuns ceva. Textul e consumat după livrare.
    """
    for like in like_pair:
        if like is None or not like.deferred_message:
            continue
        masked_body, was_masked = mask_contacts(like.deferred_message)
        db.add(
            Message(
                chat_id=chat.id,
                sender_id=like.from_user_id,
                body=masked_body,
                was_masked=was_masked,
                is_read=False,
            )
        )
        # Consumăm mesajul ca să nu fie re-livrat la un swipe ulterior.
        like.deferred_message = None


async def undo_last_swipe(db: AsyncSession, user: User) -> UndoResult:
    """Anulează ULTIMUL swipe al userului (cel mai recent după created_at, TZ 4.4).

    Șterge acel `Like`; dacă producea un `Match`, șterge și match-ul + chat-ul
    asociat (ca să nu rămână orfan). Userul astfel „re-swipe-abil" reapare în feed.
    Fără niciun swipe → {undone: false, target_user_id: null}.
    """
    last_result = await db.execute(
        select(Like)
        .where(Like.from_user_id == user.id)
        .order_by(Like.created_at.desc(), Like.id.desc())
        .limit(1)
    )
    like = last_result.scalar_one_or_none()
    if like is None:
        return UndoResult(undone=False, target_user_id=None)

    target_user_id = like.to_user_id

    # Dacă exista un match cu perechea, îl demontăm (chat mai întâi, apoi match).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    if match is not None:
        # Chat-ul asociat (dacă există) — îl ștergem ca să nu rămână orfan.
        chat_result = await db.execute(
            select(Chat).where(Chat.match_id == match.id)
        )
        chat = chat_result.scalar_one_or_none()
        if chat is not None:
            # Ștergem explicit mesajele (SQLite nu forțează implicit CASCADE).
            msgs_result = await db.execute(
                select(Message).where(Message.chat_id == chat.id)
            )
            for msg in msgs_result.scalars().all():
                await db.delete(msg)
            await db.delete(chat)
        await db.delete(match)

    await db.delete(like)
    await db.commit()
    return UndoResult(undone=True, target_user_id=target_user_id)


async def get_matches(db: AsyncSession, user: User) -> list[MatchOut]:
    """Toate match-urile userului, cu datele celuilalt profil (TZ 4.7)."""
    result = await db.execute(
        select(Match).where(
            or_(Match.user_a_id == user.id, Match.user_b_id == user.id)
        )
    )
    matches = list(result.scalars().all())
    if not matches:
        return []

    # Profilul meu (pentru scorul de compatibilitate afișat).
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()

    # Id-urile "celuilalt" din fiecare match.
    other_ids: list[uuid.UUID] = []
    for m in matches:
        other = m.user_b_id if m.user_a_id == user.id else m.user_a_id
        other_ids.append(other)

    # Profilurile celorlalți, indexate după user_id.
    others_result = await db.execute(
        select(Profile).where(Profile.user_id.in_(other_ids))
    )
    profiles_by_user = {p.user_id: p for p in others_result.scalars().all()}

    # Interesele mele + ale celorlalți pentru scor.
    profile_ids = [p.id for p in profiles_by_user.values()]
    if my_profile is not None:
        profile_ids.append(my_profile.id)
    interests_map = await _interests_by_profile(db, profile_ids)
    my_interests = (
        interests_map.get(my_profile.id, set()) if my_profile is not None else set()
    )

    out: list[MatchOut] = []
    for m, other_id in zip(matches, other_ids):
        p = profiles_by_user.get(other_id)
        if p is None:
            continue  # profil șters/incomplet — sărim
        if my_profile is not None:
            # Distanța reală, din coordonatele persistate (fără I/O de rețea):
            # scorul afișat la match e acum consistent cu cel din feed.
            score = compute_compatibility(
                my_profile,
                p,
                my_interests,
                interests_map.get(p.id, set()),
                _distance_between(my_profile, p),
            )
        else:
            score = 0
        out.append(
            MatchOut(
                match_id=m.id,
                user_id=p.user_id,
                name=p.name,
                age=_calc_age(p.birth_date),
                city=p.city,
                compatibility=score,
            )
        )
    return out
