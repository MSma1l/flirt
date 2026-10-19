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
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import and_, func, nullslast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import CodedHTTPException, ErrorCode
from app.models.account import Block, UserSettings
from app.models.chat import Chat, Message
from app.models.interest import Interest, ProfileInterest
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import User
from app.schemas.feed import FeedCard, FeedPage, MatchOut, SwipeResult, UndoResult
from app.services import (
    account_service,
    activity_service,
    billing,
    chat_service,
    geo,
    humor_service,
    push,
    tg_notify,
)
from app.services.compatibility import behavior_score, compute_compatibility
from app.services.contact_masker import mask_contacts

logger = logging.getLogger("app.feed")

# --- Reguli de business (din config, nu hardcodate în mijlocul logicii) ------
MAX_TOP_INTERESTS = 3   # câte interese afișăm pe cartelă (TZ 4.1)


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


# Mesaj DISTINCT de „profil incomplet", ca mobilul să poată deosebi cazul și să
# redirecționeze exact spre ecranul `/humor` (testul de umor), nu spre anketă.
HUMOR_REQUIRED_DETAIL = "Completează testul de umor."

# Același principiu pentru poze. „Profilul tău nu este complet." acoperea DOUĂ
# situații diferite (anketă lipsă ȘI prea puține poze), iar mobilul nu le putea
# deosebi din răspuns — deși duc în locuri diferite: anketa lipsă înseamnă
# wizardul de înregistrare, pozele lipsă înseamnă editorul de profil. Trimis
# greșit în wizard, un user cu anketă bună o lua de la capăt cu un draft gol și
# își rescria profilul la final.
#
# Cazul e REAL, nu teoretic: `min_photos` a crescut de la 1 la 2, deci conturile
# vechi au `profile_completed=true` (oglinda de pe `users`) și, în același timp,
# prea puține poze pentru gate-ul de aici.
#
# FĂRĂ cifră în text, deliberat: clientul îl compară exact, iar textul trebuie să
# rămână același indiferent de `settings.min_photos`. Numărul concret îl afișează
# mobilul, din propria configurare și în limba userului.
PHOTOS_REQUIRED_DETAIL = "Profilul tău nu are destule poze."


def _has_humor(profile: Profile) -> bool:
    """True dacă profilul are un vector de umor NON-gol (testul de umor dat).

    Testul de umor (TZ 2.7) e obligatoriu, dar până acum era impus DOAR de client
    (onboarding-ul mobil), nu și server-side: un user cu anketă+poze dar cu
    `humor_vector` gol/None trecea de toate gate-urile și putea da swipe, iar
    umorul influența doar SCORUL. Aici verificăm exact ca mobilul (`hasHumorData`):
    `humor_vector` trebuie să fie un dict cu cel puțin o intrare.

    DECIZIE (deliberată): umorul NU intră în `users.profile_completed` (care rămâne
    anketă + poze) — e un gate SEPARAT, pe ACȚIUNE. Astfel nu rescriem semantica
    existentă a flag-ului și nici migrațiile/oglinda `_sync_profile_completed`.
    """
    vector = profile.humor_vector
    return isinstance(vector, dict) and len(vector) > 0


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
    `json_array_length` există și în Postgres, și în SQLite (JSON1). Un `photos`
    NULL (rând legacy) dă NULL ⇒ rândul e exclus, exact comportamentul dorit.

    `min_photos <= 0` (config) = poartă dezactivată → None (fără predicat).
    """
    if settings.min_photos <= 0:
        return None
    return func.json_array_length(Profile.photos) >= settings.min_photos


def _distance_between(a: Profile, b: Profile) -> float | None:
    """Distanța reală (km) între două profiluri, din coordonatele PERSISTATE.

    Funcție PURĂ, fără I/O: geocodarea s-a făcut o dată, la salvarea anketei.
    `None` = cel puțin unul dintre orașe nu a putut fi geocodat ⇒ distanță
    necunoscută (scor neutru, fără penalizare).
    """
    if a.lat is None or a.lng is None or b.lat is None or b.lng is None:
        return None
    return geo.haversine_km(float(a.lat), float(a.lng), float(b.lat), float(b.lng))


# --- Feed în TREPTE (fallback când feed-ul strict s-a epuizat) ----------------
# Context: cu puține profiluri reale, userii epuizau repede feed-ul strict și
# vedeau „Nu mai sunt ankete". Decizie de produs („Tot, în trepte"): arătăm
# profiluri ORICUM, dar în ordine — întâi cele mai apropiate de preferințe.
#   1. strict         — feed-ul normal (neschimbat);
#   2. relaxed        — fără interval de vârstă, rază și filtru de inactivitate,
#                       dar cu genul căutat;
#   3. second_chance  — profiluri cărora le-am dat DISLIKE acum ≥ 24h (genul
#                       căutat, vârstă/rază relaxate);
#   4. other_gender   — alte genuri decât cele căutate, ne-swipe-uite (sau
#                       dislike vechi de ≥ 24h).
# Gate-urile DURE (profil complet, 18+, poze, self, block, ban, ascuns, șters,
# like/match deja dat) NU se relaxează în nicio treaptă — vezi `_hard_gates`.
FallbackTier = Literal["relaxed", "second_chance", "other_gender"]
FALLBACK_TIERS: tuple[FallbackTier, ...] = ("relaxed", "second_chance", "other_gender")

# După cât timp un dislike devine „a doua șansă". Momentul de referință e
# `likes.updated_at` — re-swipe-ul îl reîmprospătează, deci un nou dislike
# repornește perioada (progres garantat: o cartelă refuzată acum nu revine
# la următoarea cerere).
SECOND_CHANCE_AFTER = timedelta(hours=24)


def _hard_gates(user_id: uuid.UUID, today: date) -> list:
    """Filtrele SQL care se aplică în ORICE treaptă a feed-ului (nu se relaxează).

    Profil complet, nu eu, 18+, minimul de poze, block în orice direcție, profil
    ascuns, cont banat sau purjat GDPR, match existent. Excluderea celor cărora
    le-am dat deja like/dislike e specifică fiecărei trepte (vezi `get_feed`).
    """
    conditions = [
        Profile.completed.is_(True),
        Profile.user_id != user_id,
        # 18+ (gate dur, NU derivat din preferințe) — un profil sub prag nu apare
        # niciodată în feed, oricât de permisive ar fi preferințele salvate.
        Profile.birth_date <= _shift_years(today, settings.adult_age),
    ]
    # POZE (gate dur, principiu al aplicației): un profil cu anketă completă dar
    # ZERO poze NU are ce căuta în feedul nimănui (vezi `_min_photos_clause`).
    photos_clause = _min_photos_clause()
    if photos_clause is not None:
        conditions.append(photos_clause)

    # Excluderi prin NOT EXISTS (semi-join pe index), nu `NOT IN (…10.000 uuid)`.
    conditions.append(
        ~select(Block.id)
        .where(
            or_(
                and_(
                    Block.blocker_id == user_id,
                    Block.blocked_id == Profile.user_id,
                ),
                and_(
                    Block.blocker_id == Profile.user_id,
                    Block.blocked_id == user_id,
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
    # Match deja existent (în orice ordine a perechii normalizate): cu el nu mai
    # e nimic de „descoperit" în feed — conversația e în chat.
    conditions.append(
        ~select(Match.id)
        .where(
            or_(
                and_(Match.user_a_id == user_id, Match.user_b_id == Profile.user_id),
                and_(Match.user_a_id == Profile.user_id, Match.user_b_id == user_id),
            )
        )
        .exists()
    )
    # Conturi BANATE de moderare sau PURJATE GDPR: nu apar în feed-ul nimănui.
    # Coloane indexate pe `users` (join-ul cu User există deja în `_retrieve`).
    conditions.append(User.banned_at.is_(None))
    conditions.append(User.deleted_at.is_(None))
    return conditions


def _not_swiped_clause(user_id: uuid.UUID):
    """Filtru SQL: n-am dat încă niciun swipe (like SAU dislike) profilului."""
    return ~(
        select(Like.id)
        .where(Like.from_user_id == user_id, Like.to_user_id == Profile.user_id)
        .exists()
    )


async def _retrieve(db: AsyncSession, conditions: list) -> list:
    """Un SINGUR query de retrieval: (Profile, User) eligibili, ordine deterministă.

    ORDER BY DETERMINIST + plafon de scanare (anti-DoS, `feed_scan_limit`).
    Fereastra nu e un eșantion arbitrar din heap: e „cei mai recent activi"
    candidați ELIGIBILI (candidate generation), peste care se aplică ranking-ul.
    Același plafon pentru fiecare treaptă.
    """
    stmt = (
        select(Profile, User)
        .join(User, User.id == Profile.user_id)
        .where(*conditions)
        .order_by(nullslast(User.last_active_at.desc()), Profile.user_id)
        .limit(max(0, settings.feed_scan_limit))
    )
    return list((await db.execute(stmt)).all())


async def _rank(
    db: AsyncSession,
    my_profile: Profile,
    rows: list,
    radius_km: int | None,
) -> list[tuple[int, Profile, set[str], float | None]]:
    """RANKING pur peste fereastra retrievată, cu distanța reală injectată.

    `radius_km` setat = filtru EXACT pe rază (bounding-box-ul din SQL e doar un
    superset al cercului); `None` = fără filtru de rază (treptele de fallback).
    Un singur query de interese pentru toată fereastra — fără N+1.
    """
    if not rows:
        return []
    candidates = [row[0] for row in rows]
    # User-ul e deja în ACELAȘI rând (join-ul exista deja pentru ORDER BY), deci
    # semnalul comportamental (recența activității) nu costă niciun query în plus
    # — fără N+1. Indexat pe `profile.id` pentru lookup în bucla de scoring.
    users_by_profile: dict[uuid.UUID, User] = {row[0].id: row[1] for row in rows}

    interests_map = await _interests_by_profile(
        db, [my_profile.id] + [p.id for p in candidates]
    )
    my_interests = interests_map.get(my_profile.id, set())
    # Testul de umor oprit din panou ⇒ umorul nu mai contează la scor.
    humor_enabled = await humor_service.is_enabled(db)

    scored: list[tuple[int, Profile, set[str], float | None]] = []
    for p in candidates:
        distance_km = _distance_between(my_profile, p)
        if radius_km is not None and distance_km is not None and distance_km > radius_km:
            continue
        p_interests = interests_map.get(p.id, set())
        # Semnal comportamental: recența activității țintei + profil verificat.
        # Datele vin din rândul deja retrievat (fără query în plus). Cazul fără
        # `last_active_at` (rând legacy) cade elegant pe neutru în `behavior_score`.
        cand_user = users_by_profile.get(p.id)
        behavior = behavior_score(
            cand_user.last_active_at if cand_user is not None else None,
            verified=bool(getattr(p, "verified", False)),
        )
        score = compute_compatibility(
            my_profile,
            p,
            my_interests,
            p_interests,
            distance_km,
            behavior,
            humor_enabled=humor_enabled,
        )
        scored.append((score, p, p_interests, distance_km))

    # Ordonare TOTALĂ, deterministă: scor desc, apoi user_id (tie-break).
    scored.sort(key=lambda item: _sort_key(item[0], item[1].user_id))
    return scored


def _make_card(
    score: int,
    p: Profile,
    p_interests: set[str],
    distance_km: float | None,
    *,
    outside_filters: bool = False,
    fallback_tier: FallbackTier | None = None,
) -> FeedCard:
    """Construiește cartela de feed dintr-un candidat clasat."""
    return FeedCard(
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
        outside_filters=outside_filters,
        fallback_tier=fallback_tier,
    )


async def get_feed(
    db: AsyncSession,
    user: User,
    limit: int | None = None,
    cursor: str | None = None,
) -> FeedPage:
    """O pagină din feed-ul lui `user`, sortată descrescător după compatibilitate.

    Filtre DURE (toate în SQL, pe index-uri), valabile în ORICE treaptă:
      - profil completat, nu userul curent;
      - **18+** (aplicația e 18+ only) — gate dur, independent de preferințe;
      - minimul de poze;
      - excluderi prin `NOT EXISTS` (nu prin `NOT IN` cu liste materializate):
        blocați în orice direcție (I1), profil ascuns (I2), match existent;
      - conturi banate / purjate GDPR.

    Feed-ul STRICT (treapta 1) mai aplică preferințele:
      - genurile căutate (`interested_in`) și intervalul de vârstă (`age_min`,
        `age_max`) — fără ele un bărbat heterosexual primea bărbați în feed;
      - raza de căutare (`search_radius_km`) — bounding-box pe `lat`/`lng`, apoi
        haversine EXACT în Python (setarea nu mai e decorativă);
      - deja swipe-uiți (like sau dislike);
      - conturi inactive de peste `feed_max_inactive_days`.

    Limba NU mai e un gate DUR (pool mai larg): profilurile fără limbă comună
    RĂMÂN în feed, dar factorul de limbă (10% din scor) le clasează mai jos.
    Vezi `compatibility._languages_score`.

    FALLBACK ÎN TREPTE: dacă feed-ul strict NU umple pagina, completăm, în
    ordine, din `relaxed` → `second_chance` → `other_gender` (vezi
    `FALLBACK_TIERS`). O treaptă rulează DOAR dacă precedentele n-au umplut
    pagina; fiecare e UN query de retrieval + UN query de interese. Cartelele
    din fallback poartă `fallback_tier` + `outside_filters` și NU au cursor
    (clientul recere prima pagină și deduplică după user_id); progresul e
    garantat de excluderi: like ⇒ exclus definitiv, dislike ⇒ exclus 24h.

    Ranking: `compute_compatibility` (pur), cu distanța reală + semnalul
    comportamental (recența activității + verificare) injectate.
    Paginare (strict): cursor pe (scor, user_id) — fără duplicate între pagini.
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
    wanted_genders = list(prefs.interested_in or [])

    # --- 1. RETRIEVAL STRICT: gate-uri dure + preferințe, în SQL --------------
    conditions = _hard_gates(user.id, today)

    # Intervalul de vârstă căutat (preferință) — tot pe coloana indexată.
    earliest, latest = _birth_date_bounds(prefs.age_min, prefs.age_max, today)
    conditions.append(Profile.birth_date >= earliest)
    conditions.append(Profile.birth_date <= latest)

    # Gen / orientare: genurile căutate. Listă goală = fără restricție.
    if wanted_genders:
        conditions.append(Profile.gender.in_(wanted_genders))

    # Deja swipe-uiți (like sau dislike) — nu reapar în feed-ul strict.
    conditions.append(_not_swiped_clause(user.id))

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

    # LIMBA — DELIBERAT FĂRĂ gate dur aici (decizie: pool mai larg). Înainte,
    # un pre-filtru SQL + un gate exact în Python EXCLUDEAU complet profilurile
    # fără nicio limbă comună, îngustând mult fereastra de candidați. Acum limba
    # e o PREFERINȚĂ soft: candidații fără limbă comună rămân în retrieval și
    # sunt clasați mai jos prin factorul de limbă (10%) din scor. Gate-urile care
    # au sens (18+, gen, vârstă, poze, rază, block/hidden/ban, self) rămân dure.

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

    # --- 2. RANKING: scor pur, cu distanța reală injectată --------------------
    rows = await _retrieve(db, conditions)
    scored = await _rank(
        db, my_profile, rows, prefs.radius_km if apply_radius else None
    )

    # --- 3. PAGINARE pe cursor -----------------------------------------------
    remaining = scored
    if cursor:
        after = _decode_cursor(cursor)
        remaining = [
            item
            for item in scored
            if _sort_key(item[0], item[1].user_id) > _sort_key(after[0], after[1])
        ]

    page = remaining[:limit]
    next_cursor = (
        _encode_cursor(page[-1][0], page[-1][1].user_id)
        if page and len(remaining) > len(page)
        else None
    )
    cards = [_make_card(*item) for item in page]
    if len(cards) >= limit:
        return FeedPage(items=cards, next_cursor=next_cursor)

    # --- 4. FALLBACK ÎN TREPTE (strict-ul nu a umplut pagina) ----------------
    # Dedupe: excludem TOT strict-ul (inclusiv paginile deja livrate prin
    # cursor), nu doar pagina curentă — altfel `relaxed` (un superset al
    # strict-ului) ar re-livra cartele strict deja văzute.
    seen: set[uuid.UUID] = {item[1].user_id for item in scored}
    second_chance_cutoff = datetime.now(timezone.utc) - SECOND_CHANCE_AFTER

    def _outside_prefs(p: Profile, distance_km: float | None) -> bool:
        """True dacă profilul e în afara preferințelor (vârstă, rază sau gen)."""
        if not (earliest <= p.birth_date <= latest):
            return True
        if wanted_genders and p.gender not in wanted_genders:
            return True
        return bool(
            apply_radius and distance_km is not None and distance_km > prefs.radius_km
        )

    for tier in FALLBACK_TIERS:
        tier_conditions = _hard_gates(user.id, today)
        if tier == "relaxed":
            # Fără vârstă / rază / inactivitate; genul căutat rămâne.
            if wanted_genders:
                tier_conditions.append(Profile.gender.in_(wanted_genders))
            tier_conditions.append(_not_swiped_clause(user.id))
        elif tier == "second_chance":
            # DOAR dislike-uri vechi de ≥ 24h. Rândul e unic pe pereche, deci un
            # dislike exclude implicit like-ul (și, prin el, match-ul).
            if wanted_genders:
                tier_conditions.append(Profile.gender.in_(wanted_genders))
            tier_conditions.append(
                select(Like.id)
                .where(
                    Like.from_user_id == user.id,
                    Like.to_user_id == Profile.user_id,
                    Like.is_like.is_(False),
                    Like.updated_at <= second_chance_cutoff,
                )
                .exists()
            )
        else:  # other_gender
            # Fără preferință de gen, „alte genuri" nu există — strict-ul și
            # relaxed le-au acoperit deja pe toate.
            if not wanted_genders:
                continue
            tier_conditions.append(Profile.gender.not_in(wanted_genders))
            # Ne-swipe-uiți SAU cu dislike vechi de ≥ 24h: excludem orice like
            # și orice dislike recent.
            tier_conditions.append(
                ~select(Like.id)
                .where(
                    Like.from_user_id == user.id,
                    Like.to_user_id == Profile.user_id,
                    or_(
                        Like.is_like.is_(True),
                        Like.updated_at > second_chance_cutoff,
                    ),
                )
                .exists()
            )
        # Dedupe în SQL, ca fereastra de scanare să nu fie consumată de cartele
        # deja alese. Lista e plafonată (≤ feed_scan_limit per treaptă).
        if seen:
            tier_conditions.append(Profile.user_id.not_in(list(seen)))

        tier_rows = await _retrieve(db, tier_conditions)
        for score, p, p_interests, distance_km in await _rank(
            db, my_profile, tier_rows, None
        ):
            if p.user_id in seen:
                continue
            seen.add(p.user_id)
            cards.append(
                _make_card(
                    score,
                    p,
                    p_interests,
                    distance_km,
                    outside_filters=_outside_prefs(p, distance_km),
                    fallback_tier=tier,
                )
            )
            if len(cards) >= limit:
                break
        if len(cards) >= limit:
            break

    # Pagina conține cartele de fallback ⇒ fără cursor (strict-ul s-a epuizat).
    return FeedPage(items=cards, next_cursor=None)


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
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Nu poți face swipe pe propriul profil.",
            code=ErrorCode.SELF_SWIPE,
        )

    # Profilul propriu — incomplet ⇒ interzis.
    my_result = await db.execute(select(Profile).where(Profile.user_id == user.id))
    my_profile = my_result.scalar_one_or_none()
    if my_profile is None or not my_profile.completed:
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Profilul tău nu este complet.",
            code=ErrorCode.PROFILE_INCOMPLETE,
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
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Aplicația este disponibilă doar de la {settings.adult_age} ani.",
            code=ErrorCode.UNDERAGE,
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
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=PHOTOS_REQUIRED_DETAIL,
            code=ErrorCode.PHOTOS_REQUIRED,
        )
    if not _has_min_photos(target_profile):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Utilizator indisponibil."
        )

    # UMOR (TZ 2.7) — gate SERVER-SIDE pe ACȚIUNE, DOAR pe userul care acționează.
    #
    # DE CE DOAR PE MINE, NU PE ȚINTĂ: verificarea umorului țintei ar ascunde din
    # feed / ar face „indisponibili" userii legacy fără vector de umor, deși ei pot
    # fi swipe-uiți fără probleme — umorul lor contează doar la SCOR. Blocăm strict
    # ACȚIUNEA celui fără umor, nu prezența altora. De asta NU e niciun predicat de
    # umor în retrieval-ul din `get_feed` și nici o verificare pe `target_profile`.
    #
    # DE CE 403 CU MESAJ DISTINCT: separat de „profil incomplet" (anketă/poze), ca
    # mobilul să redirecționeze la `/humor`, nu la anketă. Feed-ul (browsing) rămâne
    # permis — gate-ul e pe acțiune, exact unde umorul devine obligatoriu.
    #
    # COMUTAT DIN PANOU: cu testul de umor oprit (implicit), poarta nu se aplică.
    if not _has_humor(my_profile) and await humor_service.is_enabled(db):
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=HUMOR_REQUIRED_DETAIL,
            code=ErrorCode.HUMOR_REQUIRED,
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
        raise CodedHTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Interacțiune blocată.",
            code=ErrorCode.INTERACTION_BLOCKED,
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

    # Swipe-ul e dovada că ținta i-a fost AFIȘATĂ în feed: o vizualizare de
    # profil (centrul de activitate), deduplicată per zi de baza de date. Se
    # comite odată cu swipe-ul, fără cerere separată din client.
    await activity_service.record_profile_view(db, user.id, target_user_id)

    # Un super like ESTE un like (swipe sus), doar cu accent. De aici încolo
    # `is_like` e adevărat pentru ambele, deci match-ul, mesajul deferred și
    # feed-ul se comportă identic — `is_super` e strict un flag în plus.
    is_super = action == "super_like"
    is_like = action == "like" or is_super
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
    # Starea DINAINTEA swipe-ului: notificarea de like/super like pleacă doar la o
    # TRECERE (nou, dislike → like, like → super like), nu la fiecare re-swipe.
    was_like = bool(like is not None and like.is_like)
    was_super = bool(like is not None and like.is_super)
    if like is None:
        # Limită de swipe/zi pentru non-premium (TZ 4.5) — se aplică DOAR la un
        # swipe NOU (re-swipe pe același target nu consumă din cotă).
        await _enforce_daily_swipe_limit(db, user)
        like = Like(
            from_user_id=user.id,
            to_user_id=target_user_id,
            is_like=is_like,
            is_super=is_super,
            deferred_message=deferred,
        )
        db.add(like)
    else:
        now = datetime.now(timezone.utc)
        # „A doua șansă" (treapta `second_chance` din feed): re-swipe pe un
        # dislike mai vechi de `SECOND_CHANCE_AFTER`. E un swipe NOU în fapt —
        # consumă din cota zilnică și primește `created_at` proaspăt, ca `undo`
        # (ordonat pe `created_at`) să-l anuleze pe EL, nu un swipe mai vechi.
        last_swiped_at = like.updated_at or like.created_at
        if (
            not like.is_like
            and last_swiped_at is not None
            and last_swiped_at <= now - SECOND_CHANCE_AFTER
        ):
            await _enforce_daily_swipe_limit(db, user)
            like.created_at = now
        # Momentul swipe-ului, EXPLICIT: un dislike repetat nu schimbă nicio
        # coloană, deci `onupdate` n-ar rula. Fără asta, perioada de 24h a celei
        # de-a doua șanse nu ar reporni și cartela ar reveni imediat în feed.
        like.updated_at = now
        like.is_like = is_like
        # Re-swipe suprascrie flagul, în ambele sensuri: like → super like îl
        # ridică, iar super like → like/dislike îl coboară. Altfel un rând ar
        # rămâne marcat „super" după ce userul s-a răzgândit.
        like.is_super = is_super
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
        # Fără match → ținta află din botul Telegram că a primit (super) like.
        if (is_super and not was_super) or (not is_super and not was_like):
            tg_notify.notify_like(
                actor_id=user.id, recipient_id=target_user_id, is_super=is_super
            )
        return SwipeResult(matched=False, match_id=None)

    # Match! Stocăm perechea normalizată (idempotent).
    a_id, b_id = _normalized_pair(user.id, target_user_id)
    match_result = await db.execute(
        select(Match).where(Match.user_a_id == a_id, Match.user_b_id == b_id)
    )
    match = match_result.scalar_one_or_none()
    match_created = match is None
    if match is None:
        match = Match(user_a_id=a_id, user_b_id=b_id)
        db.add(match)
        await db.flush()

    # La producerea unui match asigurăm (idempotent) un chat pentru el, ca
    # dialogul să existe imediat (TZ 4.7/5.1). Refolosim logica din chat_service.
    chat = await chat_service.ensure_chat_for_match(db, match)

    # Mesajul lăsat de MINE la like ajunge la țintă odată cu match-ul: îl citez în
    # notificarea de match (mascat exact ca în chat), în loc de două notificări.
    # Citit ACUM — `_deliver_deferred_messages` îl consumă (golește câmpul).
    first_message = mask_contacts(like.deferred_message)[0] if like.deferred_message else None

    # Livrăm mesajele deferred: pentru fiecare like din pereche (A->B și B->A)
    # care are `deferred_message`, creăm un mesaj în chat de la autorul like-ului
    # și consumăm textul (îl golim ca să nu-l re-livrăm la un eventual re-swipe).
    await _deliver_deferred_messages(db, chat, like, reciprocal)

    await db.commit()

    # Notificarea de match pleacă DUPĂ commit — vezi `_notify_match` pentru de ce.
    # Doar către CELĂLALT user: cel care tocmai a dat swipe vede match-ul direct
    # în răspunsul HTTP (`matched: True`), deci n-are ce să-l anunțe.
    await _notify_match(db, target_user_id)
    if match_created:
        tg_notify.notify_match(
            actor_id=user.id,
            recipient_id=target_user_id,
            chat_id=chat.id,
            first_message=first_message,
        )

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
