#!/usr/bin/env python
"""Seeder de DATE REALISTE pentru testarea la scară (load test).

DE CE EXISTĂ
------------
Un test de performanță pe date DEGENERATE nu spune nimic: dacă toți userii stau
în același punct geografic, feed-ul nu atinge niciodată bounding-box-ul; dacă
toți au 3 swipe-uri, `NOT EXISTS`-ul care a înlocuit `NOT IN (10.000 uuid)` nu e
pus la încercare; dacă niciun chat nu are 5000 de mesaje, paginarea pe cursor
rulează pe o singură pagină. Scriptul ăsta construiește o bază care seamănă cu
producția: distribuții cu COADĂ LUNGĂ, coordonate reale, limbi care se
suprapun parțial, conturi abandonate lângă conturi active.

UTILIZARE
---------
    # Postgres (docker) — ia DATABASE_URL din mediu / .env:
    python scripts/seed_load_data.py --users 2000 --reset

    # SQLite (fără docker):
    DATABASE_URL=sqlite+aiosqlite:///./loadtest.db \
        python scripts/seed_load_data.py --users 2000 --reset

Toți userii de test au ACEEAȘI parolă (`loadtest123`) și emailuri de forma
`lt000123@loadtest.flirt.local`, ca scenariul de load test să se poată autentifica.

DECIZII IMPORTANTE
------------------
1. INSERT-uri în BULK (`insert(Model).values([...])`, batch-uri de 500). Un
   `session.add()` per rând ar face 2000 de useri să dureze minute (fiecare rând
   = un round-trip + overhead de unit-of-work).

2. Parola se hash-uiește O SINGURĂ DATĂ. Argon2 e lent INTENȚIONAT (~100 ms);
   2000 de hash-uri ar însemna ~3 minute din care 100% e CPU irosit pe o parolă
   identică. Hash-ul comun se refolosește pe toți userii — parola rămâne
   verificabilă prin `verify_password`, deci login-ul din load test funcționează.

3. `lat`/`lng` se PERSISTĂ pe profil (fără geocoding de rețea: coordonatele
   orașelor sunt în tabelul de mai jos, cu jitter mic per user). Fără ele,
   feed-ul n-ar atinge deloc calea reală (bounding-box + haversine).

4. Densitatea swipe-urilor e plafonată la `SWIPE_POOL_FRACTION` din populație:
   într-o bază mică (200 useri) 125 de swipe-uri/user ar însemna că fiecare a
   văzut 60% din aplicație — nerealist, și feed-ul ar întoarce mereu gol.

IDEMPOTENT: `--reset` șterge DOAR datele de test (userii cu emailul din domeniul
`loadtest.flirt.local` + evenimentele cu prefixul `[LOADTEST]`), nu atinge alte
date din bază.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone

# Permite rularea directă (`python scripts/seed_load_data.py`) din rădăcina backend.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete, func, insert, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.models.account import Block, Favorite, UserSettings  # noqa: E402
from app.models.billing import Subscription  # noqa: E402
from app.models.chat import Chat, Message  # noqa: E402
from app.models.device import PushDevice  # noqa: E402
from app.models.event import Event, EventAttendance, FlirtPassportStamp  # noqa: E402
from app.models.interest import Interest, ProfileInterest  # noqa: E402
from app.models.moderation import Report  # noqa: E402
from app.models.profile import Profile  # noqa: E402
from app.models.story import Story  # noqa: E402
from app.models.swipe import Like, Match  # noqa: E402
from app.models.user import ROLE_USER, User  # noqa: E402
from app.services.profile_service import (  # noqa: E402
    DATING_STATUSES,
    GENDERS,
    INTERESTS_CATALOG,
)

# --- Marcaje ale datelor de test (folosite și la `--reset`) -------------------
EMAIL_DOMAIN = "loadtest.flirt.local"
COMMON_PASSWORD = "loadtest123"
EVENT_TITLE_PREFIX = "[LOADTEST]"
PHOTO_HOST = "https://cdn.loadtest.flirt.local"

# Batch-ul de INSERT. 500 × ~18 coloane = ~9000 de parametri legați — sub limita
# SQLite (32766) și sub cea Postgres (65535).
BATCH = 500

# --- Orașe cu coordonate REALE + pondere de populare -------------------------
# ~60% din useri stau în 2 orașe mari (Chișinău 40% + București 20%), restul sunt
# împrăștiați. Contează enorm: feed-ul filtrează pe rază (bounding-box pe
# lat/lng), iar dacă toți ar fi în același punct — sau toți la 1000 km — testul
# ar rula pe o cale degenerată.
CITIES: list[tuple[str, float, float, int]] = [
    ("Chișinău", 47.0105, 28.8638, 40),
    ("București", 44.4268, 26.1025, 20),
    ("Bălți", 47.7615, 27.9291, 6),
    ("Iași", 47.1585, 27.6014, 5),
    ("Tiraspol", 46.8403, 29.6433, 5),
    ("Cluj-Napoca", 46.7712, 23.6236, 4),
    ("Cahul", 45.9081, 28.1944, 3),
    ("Orhei", 47.3831, 28.8236, 3),
    ("Timișoara", 45.7489, 21.2087, 3),
    ("Ungheni", 47.2119, 27.8003, 2),
    ("Comrat", 46.2947, 28.6564, 2),
    ("Constanța", 44.1598, 28.6348, 2),
    ("Brașov", 45.6580, 25.6012, 2),
    ("Odesa", 46.4825, 30.7233, 2),
    ("Kyiv", 50.4501, 30.5234, 1),
]
CITY_WEIGHTS = [c[3] for c in CITIES]

# Jitter per user în jurul centrului orașului: ~±5 km pe lat, ~±5 km pe lng.
JITTER_LAT = 0.045
JITTER_LNG = 0.065

STREETS = [
    "str. Ștefan cel Mare", "bd. Dacia", "str. Alba Iulia", "str. Ismail",
    "bd. Grigore Vieru", "str. Mihai Eminescu", "str. Columna", "str. Bănulescu-Bodoni",
    "Calea Victoriei", "str. Lipscani", "bd. Unirii", "str. Aviatorilor",
]

FIRST_NAMES_M = [
    "Andrei", "Ion", "Mihai", "Vlad", "Sergiu", "Dumitru", "Alexandru", "Nicolae",
    "Cristian", "Radu", "Denis", "Maxim", "Artur", "Victor", "Pavel", "Igor",
    "Daniel", "George", "Ștefan", "Tudor",
]
FIRST_NAMES_F = [
    "Maria", "Ana", "Elena", "Cristina", "Ioana", "Daniela", "Irina", "Natalia",
    "Alina", "Victoria", "Olga", "Diana", "Livia", "Corina", "Mihaela", "Tatiana",
    "Ecaterina", "Sanda", "Veronica", "Doina",
]
FIRST_NAMES_X = ["Sasha", "Robin", "Ale", "Nico", "Vali", "Sam"]
LAST_INITIALS = list("ABCDEFGHIJKLMNOPRSTVZ")

NATIONALITIES = [
    "Moldovean", "Român", "Rus", "Ucrainean", "Găgăuz", "Bulgar", None, None,
]

ABOUT_SNIPPETS = [
    "Îmi place drumeția la sfârșit de săptămână și cafeaua de dimineață.",
    "Люблю музыку, кино и долгие прогулки по городу.",
    "Caut pe cineva cu care să râd la aceleași glume proaste.",
    "Sport de 4 ori pe săptămână, gătit prost, dar cu entuziasm.",
    "Работаю в IT, отдыхаю в горах. Ищу компанию для путешествий.",
    "Fotografiez orașul noaptea. Întreabă-mă despre filme vechi.",
    "Iubesc animalele, cărțile și diminețile fără alarmă.",
    "Простой человек, сложный характер. Пишите — разберёмся.",
]

# Distribuția de limbi — SUPRAPUNERE REALISTĂ. Feed-ul are un GATE DUR pe limbă
# comună (`_has_common_language`): dacă distribuția ar fi disjunctă (jumătate
# doar „ro", jumătate doar „ru"), jumătate din feed-uri ar ieși goale și n-am
# testa nimic. Aici majoritatea vorbesc ro sau ru (deseori ambele).
LANGUAGE_SETS: list[tuple[list[str], int]] = [
    (["ro", "ru"], 28),
    (["ro"], 20),
    (["ru"], 18),
    (["ro", "ru", "en"], 14),
    (["ro", "en"], 9),
    (["ru", "en"], 7),
    (["en"], 4),
]
LANG_WEIGHTS = [w for _, w in LANGUAGE_SETS]

GENDER_VALUES = [g.value for g in GENDERS]          # male / female / other
GENDER_WEIGHTS = [48, 48, 4]
STATUS_VALUES = [s.value for s in DATING_STATUSES]  # serious/acquaintance/...

HUMOR_DIMS = ["irony", "sarcasm", "absurd", "dark", "wholesome", "pun"]

SUB_PLANS = ["premium", "no_ads", "ai_bot", "all_inclusive"]
REPORT_CATEGORIES = ["spam", "fake", "offensive", "obscene"]
EVENT_KINDS = ["flirt_party", "concert", "other"]

MESSAGE_SNIPPETS = [
    "Salut! Cum a fost ziua?", "Ha, exact la asta mă gândeam și eu.",
    "Привет! Как дела?", "Mergem la o cafea sâmbătă?",
    "Ce muzică asculți în ultima vreme?", "Ты видел(а) тот новый фильм?",
    "Îmi place mult poza a doua :)", "Lucrez până târziu azi, scriu diseară.",
    "Согласен(а), полностью.", "Спокойной ночи!", "Weekendul ăsta ești liber(ă)?",
    "Nu-mi vine să cred că și tu faci asta!",
]

# --- Parametrii distribuțiilor cu coadă lungă --------------------------------
# Câți useri „obișnuiți" au 50–200 de swipe-uri, plafonat la o fracție din
# populație (un user real nu a văzut 60% din aplicație).
SWIPE_POOL_FRACTION = 0.30
SWIPE_TYPICAL = (50, 200)
SWIPE_LIGHT = (5, 40)
# Swiperi EXTREMI: ținta e 10.000+ exclusi — exact cazul pentru care `NOT IN`
# a fost înlocuit cu `NOT EXISTS`. Plafonat de populație (nu poți da swipe pe
# mai mulți oameni decât există): la `--users 12000` se atinge efectiv 10k+.
SWIPE_HEAVY = (10_000, 15_000)
LIKE_RATIO = 0.40           # 40% like, 60% dislike (realist)

# Match-uri: majoritatea userilor au puține (ies natural din like-urile
# reciproce), dar câțiva au 200+ — cazul care genera 604 query-uri pe GET /chats.
HEAVY_MATCH_TARGET = (200, 320)

# Mesaje: majoritatea chat-urilor 10–100, unele 100–600, iar câteva 5000+
# (paginarea pe cursor abia acolo contează).
MSG_TYPICAL = (10, 100)
MSG_MEDIUM = (100, 600)
MSG_HEAVY = (5_000, 6_500)
MSG_MEDIUM_SHARE = 0.10


# ---------------------------------------------------------------------------
# Utilitare de generare
# ---------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _pick_city(rng: random.Random) -> tuple[str, float, float]:
    name, lat, lng, _ = rng.choices(CITIES, weights=CITY_WEIGHTS, k=1)[0]
    return (
        name,
        round(lat + rng.uniform(-JITTER_LAT, JITTER_LAT), 6),
        round(lng + rng.uniform(-JITTER_LNG, JITTER_LNG), 6),
    )


def _pick_age(rng: random.Random) -> int:
    """Vârste 18–60, cu masa în 22–35 (piramida reală a unei aplicații de dating)."""
    bucket = rng.random()
    if bucket < 0.55:
        return rng.randint(22, 35)
    if bucket < 0.75:
        return rng.randint(18, 21)
    if bucket < 0.92:
        return rng.randint(36, 47)
    return rng.randint(48, 60)


def _birth_date_for_age(rng: random.Random, age: int, today: date) -> date:
    """O dată de naștere care dă EXACT `age` ani împliniți azi."""
    days = rng.randint(1, 364)
    return today.replace(year=today.year - age - 1) + timedelta(days=days)


def _last_active(rng: random.Random, now: datetime) -> datetime | None:
    """Activitate variată: activi azi ↔ abandonați de luni (filtrul de feed)."""
    r = rng.random()
    if r < 0.35:                       # activi azi / ieri
        return now - timedelta(hours=rng.randint(0, 36))
    if r < 0.60:                       # activi în ultima săptămână
        return now - timedelta(days=rng.randint(2, 7))
    if r < 0.78:                       # activi în ultima lună (încă în feed)
        return now - timedelta(days=rng.randint(8, 29))
    if r < 0.95:                       # ABANDONAȚI (peste feed_max_inactive_days)
        return now - timedelta(days=rng.randint(31, 400))
    return None                        # cont vechi, fără semnal → tratat ca activ


def _humor_vector(rng: random.Random) -> dict | None:
    if rng.random() < 0.15:            # 15% n-au făcut testul de umor
        return None
    return {dim: round(rng.uniform(0.0, 1.0), 3) for dim in HUMOR_DIMS}


def _interested_in(rng: random.Random, gender: str) -> list[str]:
    """Preferință de gen realistă (majoritar heterosexual, cu minorități)."""
    r = rng.random()
    if gender == "male":
        if r < 0.85:
            return ["female"]
        if r < 0.93:
            return ["male"]
        if r < 0.97:
            return ["male", "female"]
        return []                      # listă goală = fără restricție
    if gender == "female":
        if r < 0.85:
            return ["male"]
        if r < 0.93:
            return ["female"]
        if r < 0.97:
            return ["male", "female"]
        return []
    return rng.choice([["male"], ["female"], ["male", "female", "other"], []])


def _radius_km(rng: random.Random) -> int:
    r = rng.random()
    if r < 0.30:
        return rng.choice([10, 25])
    if r < 0.75:
        return rng.choice([50, 75, 100])
    if r < 0.93:
        return rng.choice([150, 200, 300])
    return rng.choice([500, 1000])     # „oriunde"


# ---------------------------------------------------------------------------
# Insert în BULK
# ---------------------------------------------------------------------------
class Bulk:
    """Acumulator de rânduri care se golește în DB în batch-uri de `BATCH`.

    Un `insert(Model).values([...500 dicts...])` per batch: un singur round-trip
    și un singur INSERT compilat, în loc de 500 de round-trip-uri ORM.
    """

    def __init__(self, session: AsyncSession, model, batch: int = BATCH) -> None:
        self._session = session
        self._model = model
        self._batch = batch
        self._rows: list[dict] = []
        self.count = 0

    async def add(self, row: dict) -> None:
        self._rows.append(row)
        if len(self._rows) >= self._batch:
            await self.flush()

    async def add_many(self, rows: list[dict]) -> None:
        for row in rows:
            await self.add(row)

    async def flush(self) -> None:
        if not self._rows:
            return
        await self._session.execute(insert(self._model).values(self._rows))
        self.count += len(self._rows)
        self._rows.clear()


def _stamps(rng: random.Random, now: datetime, max_days: int = 730) -> dict:
    """`created_at`/`updated_at` variate (nu toate rândurile în aceeași secundă)."""
    created = now - timedelta(
        days=rng.randint(0, max_days), seconds=rng.randint(0, 86_399)
    )
    return {"created_at": created, "updated_at": created}


# ---------------------------------------------------------------------------
# RESET — șterge DOAR datele de test
# ---------------------------------------------------------------------------
async def reset_test_data(session: AsyncSession) -> None:
    """Șterge datele generate de acest seeder, fără să atingă alte date.

    Ținta e identificată STRICT prin marcaje proprii: emailul din domeniul
    `loadtest.flirt.local` și prefixul `[LOADTEST]` la evenimente. Ștergem
    explicit copiii înainte de părinți (SQLite nu forțează implicit CASCADE).
    """
    users_q = select(User.id).where(User.email.like(f"%@{EMAIL_DOMAIN}"))
    chats_q = select(Chat.id).where(
        Chat.user_a_id.in_(users_q) | Chat.user_b_id.in_(users_q)
    )
    profiles_q = select(Profile.id).where(Profile.user_id.in_(users_q))
    events_q = select(Event.id).where(Event.title.like(f"{EVENT_TITLE_PREFIX}%"))

    statements = [
        delete(Message).where(Message.chat_id.in_(chats_q)),
        delete(Chat).where(Chat.id.in_(chats_q)),
        delete(Match).where(
            Match.user_a_id.in_(users_q) | Match.user_b_id.in_(users_q)
        ),
        delete(Like).where(
            Like.from_user_id.in_(users_q) | Like.to_user_id.in_(users_q)
        ),
        delete(Block).where(
            Block.blocker_id.in_(users_q) | Block.blocked_id.in_(users_q)
        ),
        delete(Favorite).where(
            Favorite.user_id.in_(users_q) | Favorite.target_user_id.in_(users_q)
        ),
        delete(Report).where(
            Report.reporter_id.in_(users_q) | Report.reported_id.in_(users_q)
        ),
        delete(Subscription).where(Subscription.user_id.in_(users_q)),
        delete(Story).where(Story.user_id.in_(users_q)),
        delete(PushDevice).where(PushDevice.user_id.in_(users_q)),
        delete(FlirtPassportStamp).where(
            FlirtPassportStamp.user_id.in_(users_q)
            | FlirtPassportStamp.event_id.in_(events_q)
        ),
        delete(EventAttendance).where(
            EventAttendance.user_id.in_(users_q)
            | EventAttendance.event_id.in_(events_q)
        ),
        delete(Event).where(Event.id.in_(events_q)),
        delete(ProfileInterest).where(ProfileInterest.profile_id.in_(profiles_q)),
        delete(Profile).where(Profile.user_id.in_(users_q)),
        delete(UserSettings).where(UserSettings.user_id.in_(users_q)),
        delete(User).where(User.id.in_(users_q)),
    ]
    for stmt in statements:
        await session.execute(stmt)
    await session.commit()


# ---------------------------------------------------------------------------
# Catalogul de interese (idempotent)
# ---------------------------------------------------------------------------
async def ensure_interests(session: AsyncSession, now: datetime) -> list[uuid.UUID]:
    """Asigură catalogul real de interese și întoarce id-urile lui."""
    existing = {
        row[0]: row[1]
        for row in (await session.execute(select(Interest.slug, Interest.id))).all()
    }
    missing = [
        {
            "id": uuid.uuid4(),
            "slug": slug,
            "label_ru": label_ru,
            "label_ro": label_ro,
            "created_at": now,
            "updated_at": now,
        }
        for slug, label_ru, label_ro in INTERESTS_CATALOG
        if slug not in existing
    ]
    if missing:
        await session.execute(insert(Interest).values(missing))
        await session.commit()
        for row in missing:
            existing[row["slug"]] = row["id"]
    return [existing[slug] for slug, _, _ in INTERESTS_CATALOG]


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
async def seed(args: argparse.Namespace) -> dict[str, int]:
    rng = random.Random(args.seed)
    now = _now()
    today = date.today()
    n = args.users

    stats: dict[str, int] = {}

    async with engine.begin() as conn:
        # Bază proaspătă (SQLite nou / Postgres fără migrări rulate) → creăm
        # tabelele. `checkfirst` implicit: pe o bază migrată nu face nimic.
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        if args.reset:
            print("→ reset: șterg datele de test existente…", flush=True)
            await reset_test_data(session)
        else:
            existing = await session.scalar(
                select(func.count())
                .select_from(User)
                .where(User.email.like(f"%@{EMAIL_DOMAIN}"))
            )
            if existing:
                raise SystemExit(
                    f"Există deja {existing} useri de test în bază. "
                    f"Rulează cu --reset ca să-i înlocuiești."
                )

        interest_ids = await ensure_interests(session, now)

        # --- 1. Parola: UN SINGUR hash Argon2, refolosit -----------------------
        t_hash = time.perf_counter()
        password_hash = hash_password(COMMON_PASSWORD)
        hash_ms = (time.perf_counter() - t_hash) * 1000
        print(
            f"→ hash Argon2 calculat O SINGURĂ DATĂ ({hash_ms:.0f} ms); "
            f"{n} de hash-uri ar fi durat ~{hash_ms * n / 1000:.0f} s",
            flush=True,
        )

        # --- 2. Useri + profiluri + setări + interese --------------------------
        print(f"→ generez {n} useri (profil complet, coordonate, preferințe)…",
              flush=True)
        user_ids: list[uuid.UUID] = []
        profile_ids: list[uuid.UUID] = []
        ages: list[int] = []

        u_bulk = Bulk(session, User)
        p_bulk = Bulk(session, Profile)
        s_bulk = Bulk(session, UserSettings)
        pi_bulk = Bulk(session, ProfileInterest)

        for i in range(n):
            uid = uuid.uuid4()
            pid = uuid.uuid4()
            user_ids.append(uid)
            profile_ids.append(pid)

            gender = rng.choices(GENDER_VALUES, weights=GENDER_WEIGHTS, k=1)[0]
            age = _pick_age(rng)
            ages.append(age)
            city, lat, lng = _pick_city(rng)
            first = rng.choice(
                FIRST_NAMES_M if gender == "male"
                else FIRST_NAMES_F if gender == "female"
                else FIRST_NAMES_X
            )
            created = now - timedelta(
                days=rng.randint(0, 720), seconds=rng.randint(0, 86_399)
            )
            banned = rng.random() < 0.01     # 1% conturi banate de moderare

            await u_bulk.add(
                {
                    "id": uid,
                    "email": f"lt{i:06d}@{EMAIL_DOMAIN}",
                    "password_hash": password_hash,
                    "profile_completed": True,
                    "role": ROLE_USER,
                    "banned_at": (now - timedelta(days=rng.randint(1, 90)))
                    if banned else None,
                    "ban_reason": "conținut raportat (date de test)" if banned else None,
                    "last_active_at": _last_active(rng, now),
                    "created_at": created,
                    "updated_at": created,
                }
            )

            n_photos = rng.randint(0, 4)
            await p_bulk.add(
                {
                    "id": pid,
                    "user_id": uid,
                    "name": f"{first} {rng.choice(LAST_INITIALS)}.",
                    "birth_date": _birth_date_for_age(rng, age, today),
                    "gender": gender,
                    "height_cm": rng.randint(152, 198),
                    "city": city,
                    "street": rng.choice(STREETS) if rng.random() < 0.6 else None,
                    "nationality": rng.choice(NATIONALITIES),
                    "lat": lat,
                    "lng": lng,
                    "languages": rng.choices(
                        [ls for ls, _ in LANGUAGE_SETS], weights=LANG_WEIGHTS, k=1
                    )[0],
                    "about": rng.choice(ABOUT_SNIPPETS) if rng.random() < 0.8 else None,
                    "dating_statuses": rng.sample(
                        STATUS_VALUES, k=rng.randint(1, 3)
                    ),
                    "humor_vector": _humor_vector(rng),
                    "photos": [
                        f"{PHOTO_HOST}/photos/{pid}/{k}.jpg" for k in range(n_photos)
                    ],
                    "completed": True,
                    "verified": rng.random() < 0.3,
                    "created_at": created,
                    "updated_at": created,
                }
            )

            age_min = max(18, age - rng.randint(2, 10))
            await s_bulk.add(
                {
                    "id": uuid.uuid4(),
                    "user_id": uid,
                    "theme": rng.choice(["system", "light", "dark"]),
                    "search_radius_km": _radius_km(rng),
                    "notifications": {
                        "match": True,
                        "messages": True,
                        "ai_hints": rng.random() < 0.5,
                        "events": rng.random() < 0.6,
                        "promos": rng.random() < 0.3,
                    },
                    "profile_hidden": rng.random() < 0.03,
                    "region": None,
                    "interested_in": _interested_in(rng, gender),
                    "age_min": age_min,
                    "age_max": min(99, age + rng.randint(3, 15)),
                    "created_at": created,
                    "updated_at": created,
                }
            )

            # 5–15 interese din catalogul REAL (legate prin `profile_interests`).
            k = min(rng.randint(5, 15), len(interest_ids))
            for interest_id in rng.sample(interest_ids, k=k):
                await pi_bulk.add(
                    {
                        "id": uuid.uuid4(),
                        "profile_id": pid,
                        "interest_id": interest_id,
                        "created_at": created,
                        "updated_at": created,
                    }
                )

        for bulk in (u_bulk, p_bulk, s_bulk, pi_bulk):
            await bulk.flush()
        await session.commit()
        stats["users"] = u_bulk.count
        stats["profiles"] = p_bulk.count
        stats["user_settings"] = s_bulk.count
        stats["profile_interests"] = pi_bulk.count

        # --- 3. Swipe-uri: distribuție cu COADĂ LUNGĂ --------------------------
        # `likes[a][b] = is_like`. Ținem harta în memorie pentru a deriva
        # match-urile din like-uri RECIPROCE (un match fără like-urile lui ar fi
        # o inconsistență pe care testul n-ar prinde-o niciodată).
        pool_cap = max(1, int(SWIPE_POOL_FRACTION * (n - 1))) if n > 1 else 0
        heavy_swipers = min(args.heavy_swipers, n)
        heavy_idx = set(rng.sample(range(n), k=heavy_swipers)) if heavy_swipers else set()
        heavy_cap = n - 1

        print(
            f"→ generez swipe-uri (tipic {SWIPE_TYPICAL[0]}–{SWIPE_TYPICAL[1]}, "
            f"plafonat la {pool_cap}/user; {heavy_swipers} swiperi extremi "
            f"→ până la {heavy_cap})…",
            flush=True,
        )

        likes: dict[int, dict[int, bool]] = {}
        for a in range(n):
            if a in heavy_idx:
                want = rng.randint(*SWIPE_HEAVY)
                k = min(want, heavy_cap)
            elif rng.random() < 0.20:
                k = min(rng.randint(*SWIPE_LIGHT), pool_cap)
            else:
                k = min(rng.randint(*SWIPE_TYPICAL), pool_cap)
            if k <= 0:
                likes[a] = {}
                continue
            # Eșantion FĂRĂ repetiție (respectă `uq_like_pair`), fără self-swipe.
            targets = rng.sample(range(n), k=min(k + 1, n))
            targets = [t for t in targets if t != a][:k]
            likes[a] = {t: (rng.random() < LIKE_RATIO) for t in targets}

        # --- 4. Match-uri: coadă lungă (câțiva useri cu 200+) ------------------
        heavy_matchers = min(args.heavy_matchers, n)
        forced = rng.sample(range(n), k=heavy_matchers) if heavy_matchers else []
        for a in forced:
            want = min(rng.randint(*HEAVY_MATCH_TARGET), n - 1)
            partners = [t for t in rng.sample(range(n), k=min(want + 1, n)) if t != a]
            for b in partners[:want]:
                # Match = like RECIPROC. Îl materializăm în ambele direcții.
                likes[a][b] = True
                likes[b][a] = True

        # Persistăm like-urile.
        l_bulk = Bulk(session, Like)
        for a, targets in likes.items():
            for b, is_like in targets.items():
                created = now - timedelta(
                    days=rng.randint(0, 120), seconds=rng.randint(0, 86_399)
                )
                await l_bulk.add(
                    {
                        "id": uuid.uuid4(),
                        "from_user_id": user_ids[a],
                        "to_user_id": user_ids[b],
                        "is_like": is_like,
                        "deferred_message": (
                            rng.choice(MESSAGE_SNIPPETS)
                            if (is_like and rng.random() < 0.05) else None
                        ),
                        "created_at": created,
                        "updated_at": created,
                    }
                )
        await l_bulk.flush()
        await session.commit()
        stats["likes"] = l_bulk.count

        # Match-urile = perechile cu like reciproc (o singură linie per pereche).
        pairs: list[tuple[int, int]] = []
        for a, targets in likes.items():
            for b, is_like in targets.items():
                if is_like and a < b and likes.get(b, {}).get(a) is True:
                    pairs.append((a, b))

        print(f"→ generez {len(pairs)} match-uri + chat-uri…", flush=True)
        m_bulk = Bulk(session, Match)
        c_bulk = Bulk(session, Chat)
        chat_ids: list[tuple[uuid.UUID, uuid.UUID, uuid.UUID, datetime]] = []
        for a, b in pairs:
            # Normalizare identică cu `feed_service._normalized_pair`
            # (comparație pe reprezentarea STRING a UUID-ului).
            ua, ub = user_ids[a], user_ids[b]
            if str(ua) > str(ub):
                ua, ub = ub, ua
            match_id = uuid.uuid4()
            chat_id = uuid.uuid4()
            created = now - timedelta(
                days=rng.randint(0, 100), seconds=rng.randint(0, 86_399)
            )
            await m_bulk.add(
                {
                    "id": match_id,
                    "user_a_id": ua,
                    "user_b_id": ub,
                    "created_at": created,
                    "updated_at": created,
                }
            )
            await c_bulk.add(
                {
                    "id": chat_id,
                    "match_id": match_id,
                    "user_a_id": ua,
                    "user_b_id": ub,
                    "created_at": created,
                    "updated_at": created,
                }
            )
            chat_ids.append((chat_id, ua, ub, created))
        await m_bulk.flush()
        await c_bulk.flush()
        await session.commit()
        stats["matches"] = m_bulk.count
        stats["chats"] = c_bulk.count

        # --- 5. Mesaje: majoritatea 10–100, câteva 5000+ -----------------------
        heavy_chats = min(args.heavy_chats, len(chat_ids))
        heavy_chat_idx = set(
            rng.sample(range(len(chat_ids)), k=heavy_chats)
        ) if heavy_chats else set()

        print(
            f"→ generez mesaje ({MSG_TYPICAL[0]}–{MSG_TYPICAL[1]} tipic; "
            f"{heavy_chats} chat-uri cu {MSG_HEAVY[0]}+ mesaje)…",
            flush=True,
        )
        msg_bulk = Bulk(session, Message)
        for idx, (chat_id, ua, ub, chat_created) in enumerate(chat_ids):
            if idx in heavy_chat_idx:
                count = rng.randint(*MSG_HEAVY)
            elif rng.random() < MSG_MEDIUM_SHARE:
                count = rng.randint(*MSG_MEDIUM)
            else:
                count = rng.randint(*MSG_TYPICAL)

            # Timestamp-uri STRICT crescătoare de la crearea chat-ului: paginarea
            # pe cursor (created_at DESC, id DESC) are astfel o ordine reală.
            ts = chat_created
            step = max(
                1, int((now - chat_created).total_seconds() // max(count, 1))
            )
            for j in range(count):
                ts = ts + timedelta(seconds=rng.randint(1, step))
                if ts > now:
                    ts = now
                sender = ua if rng.random() < 0.5 else ub
                await msg_bulk.add(
                    {
                        "id": uuid.uuid4(),
                        "chat_id": chat_id,
                        "sender_id": sender,
                        "body": rng.choice(MESSAGE_SNIPPETS),
                        "was_masked": rng.random() < 0.03,
                        # Ultimele mesaje rămân necitite (badge-ul din GET /chats).
                        "is_read": j < count - rng.randint(0, 5),
                        "reaction": rng.choice(["❤️", "😂", "👍"])
                        if rng.random() < 0.05 else None,
                        "created_at": ts,
                        "updated_at": ts,
                    }
                )
        await msg_bulk.flush()
        await session.commit()
        stats["messages"] = msg_bulk.count

        # --- 6. Blocuri / favorite --------------------------------------------
        b_bulk = Bulk(session, Block)
        f_bulk = Bulk(session, Favorite)
        seen_blocks: set[tuple[int, int]] = set()
        seen_favs: set[tuple[int, int]] = set()
        for a in range(n):
            if n > 1 and rng.random() < 0.02:
                for b in rng.sample(range(n), k=min(rng.randint(1, 3) + 1, n)):
                    if b == a or (a, b) in seen_blocks:
                        continue
                    seen_blocks.add((a, b))
                    await b_bulk.add(
                        {
                            "id": uuid.uuid4(),
                            "blocker_id": user_ids[a],
                            "blocked_id": user_ids[b],
                            **_stamps(rng, now, 200),
                        }
                    )
            if n > 1 and rng.random() < 0.15:
                for b in rng.sample(range(n), k=min(rng.randint(1, 10) + 1, n)):
                    if b == a or (a, b) in seen_favs:
                        continue
                    seen_favs.add((a, b))
                    await f_bulk.add(
                        {
                            "id": uuid.uuid4(),
                            "user_id": user_ids[a],
                            "target_user_id": user_ids[b],
                            **_stamps(rng, now, 200),
                        }
                    )
        await b_bulk.flush()
        await f_bulk.flush()
        stats["blocks"] = b_bulk.count
        stats["favorites"] = f_bulk.count

        # --- 7. Rapoarte de moderare ------------------------------------------
        r_bulk = Bulk(session, Report)
        seen_reports: set[tuple[int, int, str]] = set()
        for _ in range(max(1, n // 20)):
            a, b = rng.randrange(n), rng.randrange(n)
            category = rng.choice(REPORT_CATEGORIES)
            if a == b or (a, b, category) in seen_reports:
                continue
            seen_reports.add((a, b, category))
            await r_bulk.add(
                {
                    "id": uuid.uuid4(),
                    "reporter_id": user_ids[a],
                    "reported_id": user_ids[b],
                    "category": category,
                    "chat_id": None,
                    "note": "raport generat de seeder" if rng.random() < 0.4 else None,
                    "status": rng.choices(
                        ["open", "reviewed", "auto_banned"], weights=[6, 3, 1], k=1
                    )[0],
                    **_stamps(rng, now, 120),
                }
            )
        await r_bulk.flush()
        stats["reports"] = r_bulk.count

        # --- 8. Abonamente -----------------------------------------------------
        sub_bulk = Bulk(session, Subscription)
        for a in range(n):
            if rng.random() >= 0.10:
                continue
            status_value = rng.choices(
                ["active", "canceled", "expired"], weights=[7, 2, 1], k=1
            )[0]
            await sub_bulk.add(
                {
                    "id": uuid.uuid4(),
                    "user_id": user_ids[a],
                    "plan": rng.choice(SUB_PLANS),
                    "status": status_value,
                    "provider": rng.choice(["stub", "app_store", "play"]),
                    "expires_at": now
                    + timedelta(days=rng.randint(1, 60) if status_value == "active"
                                else -rng.randint(1, 60)),
                    **_stamps(rng, now, 300),
                }
            )
        await sub_bulk.flush()
        stats["subscriptions"] = sub_bulk.count

        # --- 9. Evenimente + prezențe + ștampile -------------------------------
        e_bulk = Bulk(session, Event)
        event_ids: list[uuid.UUID] = []
        for i in range(args.events):
            city, lat, lng = _pick_city(rng)
            eid = uuid.uuid4()
            event_ids.append(eid)
            # Jumătate în viitor (listarea implicită), jumătate în trecut.
            delta = timedelta(days=rng.randint(1, 90)) if i % 2 == 0 \
                else -timedelta(days=rng.randint(1, 90))
            await e_bulk.add(
                {
                    "id": eid,
                    "title": f"{EVENT_TITLE_PREFIX} Flirt Night #{i + 1} — {city}",
                    "description": "Eveniment generat pentru testarea la scară.",
                    "starts_at": now + delta,
                    "city": city,
                    "venue": rng.choice(["Club Cadran", "Loft Bar", "Arena", "Roof 21"]),
                    "lat": lat,
                    "lng": lng,
                    "kind": rng.choice(EVENT_KINDS),
                    "cover_url": None,
                    **_stamps(rng, now, 60),
                }
            )
        await e_bulk.flush()
        stats["events"] = e_bulk.count

        att_bulk = Bulk(session, EventAttendance)
        stamp_bulk = Bulk(session, FlirtPassportStamp)
        seen_att: set[tuple[uuid.UUID, uuid.UUID]] = set()
        seen_stamp: set[tuple[uuid.UUID, uuid.UUID]] = set()
        if event_ids:
            for a in range(n):
                if rng.random() >= 0.12:
                    continue
                for eid in rng.sample(
                    event_ids, k=min(rng.randint(1, 3), len(event_ids))
                ):
                    if (eid, user_ids[a]) in seen_att:
                        continue
                    seen_att.add((eid, user_ids[a]))
                    await att_bulk.add(
                        {
                            "id": uuid.uuid4(),
                            "event_id": eid,
                            "user_id": user_ids[a],
                            "going": rng.random() < 0.85,
                            **_stamps(rng, now, 60),
                        }
                    )
                    if rng.random() < 0.4 and (eid, user_ids[a]) not in seen_stamp:
                        seen_stamp.add((eid, user_ids[a]))
                        await stamp_bulk.add(
                            {
                                "id": uuid.uuid4(),
                                "event_id": eid,
                                "user_id": user_ids[a],
                                "stamped_at": now - timedelta(
                                    days=rng.randint(1, 60)
                                ),
                                **_stamps(rng, now, 60),
                            }
                        )
        await att_bulk.flush()
        await stamp_bulk.flush()
        stats["event_attendances"] = att_bulk.count
        stats["passport_stamps"] = stamp_bulk.count

        # --- 10. Stories + dispozitive de push ---------------------------------
        st_bulk = Bulk(session, Story)
        for a in range(n):
            if rng.random() >= 0.10:
                continue
            for _ in range(rng.randint(1, 2)):
                created = now - timedelta(hours=rng.randint(0, 72))
                # ~jumătate încă active (expires_at în viitor), restul expirate.
                await st_bulk.add(
                    {
                        "id": uuid.uuid4(),
                        "user_id": user_ids[a],
                        "media_url": f"{PHOTO_HOST}/stories/{uuid.uuid4()}.jpg",
                        "caption": rng.choice(ABOUT_SNIPPETS)
                        if rng.random() < 0.5 else None,
                        "expires_at": created + timedelta(hours=24),
                        "created_at": created,
                        "updated_at": created,
                    }
                )
        await st_bulk.flush()
        stats["stories"] = st_bulk.count

        d_bulk = Bulk(session, PushDevice)
        for a in range(n):
            if rng.random() >= 0.40:
                continue
            await d_bulk.add(
                {
                    "id": uuid.uuid4(),
                    "user_id": user_ids[a],
                    "token": f"ExponentPushToken[{uuid.uuid4().hex[:22]}]",
                    "platform": rng.choice(["ios", "android"]),
                    **_stamps(rng, now, 200),
                }
            )
        await d_bulk.flush()
        stats["push_devices"] = d_bulk.count

        await session.commit()

        # --- 11. Statistici de coadă lungă (ce anume s-a testat, de fapt) ------
        top_swipes = max((len(t) for t in likes.values()), default=0)
        match_counts: dict[int, int] = {}
        for a, b in pairs:
            match_counts[a] = match_counts.get(a, 0) + 1
            match_counts[b] = match_counts.get(b, 0) + 1
        stats["_max_swipes_per_user"] = top_swipes
        stats["_max_matches_per_user"] = max(match_counts.values(), default=0)
        stats["_users_over_200_matches"] = sum(
            1 for v in match_counts.values() if v >= 200
        )

    return stats


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Seeder de date realiste pentru testarea la scară.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--users", type=int, default=2000, help="câți useri de test")
    parser.add_argument(
        "--reset",
        action="store_true",
        help="șterge întâi datele de test existente (nu atinge alte date)",
    )
    parser.add_argument(
        "--heavy-swipers",
        type=int,
        default=5,
        help="câți useri cu zeci de mii de swipe-uri (plafonat de populație)",
    )
    parser.add_argument(
        "--heavy-matchers",
        type=int,
        default=8,
        help="câți useri cu 200+ match-uri (cazul GET /chats)",
    )
    parser.add_argument(
        "--heavy-chats",
        type=int,
        default=3,
        help="câte chat-uri cu 5000+ mesaje (cazul paginării pe cursor)",
    )
    parser.add_argument("--events", type=int, default=20, help="câte evenimente")
    parser.add_argument("--seed", type=int, default=1337, help="seed RNG (reproductibil)")
    return parser.parse_args(argv)


async def main_async(args: argparse.Namespace) -> None:
    started = time.perf_counter()
    print(f"Bază de date: {os.environ.get('DATABASE_URL') or 'din config (.env)'}")
    stats = await seed(args)
    elapsed = time.perf_counter() - started
    await engine.dispose()

    total = sum(v for k, v in stats.items() if not k.startswith("_"))
    print("\n" + "=" * 62)
    print("REZUMAT SEEDER")
    print("=" * 62)
    rows = [
        ("useri", "users"),
        ("profiluri", "profiles"),
        ("setări (preferințe căutare)", "user_settings"),
        ("legături profil↔interese", "profile_interests"),
        ("swipe-uri (likes)", "likes"),
        ("match-uri", "matches"),
        ("chat-uri", "chats"),
        ("mesaje", "messages"),
        ("blocuri", "blocks"),
        ("favorite", "favorites"),
        ("rapoarte moderare", "reports"),
        ("abonamente", "subscriptions"),
        ("evenimente", "events"),
        ("prezențe la evenimente", "event_attendances"),
        ("ștampile Flirt Passport", "passport_stamps"),
        ("stories", "stories"),
        ("dispozitive push", "push_devices"),
    ]
    for label, key in rows:
        print(f"  {label:<30} {stats.get(key, 0):>10,}")
    print("-" * 62)
    print(f"  {'TOTAL rânduri':<30} {total:>10,}")
    print(f"  {'max swipe-uri / user':<30} {stats['_max_swipes_per_user']:>10,}")
    print(f"  {'max match-uri / user':<30} {stats['_max_matches_per_user']:>10,}")
    print(f"  {'useri cu 200+ match-uri':<30} {stats['_users_over_200_matches']:>10,}")
    print("-" * 62)
    print(f"  {'DURATĂ':<30} {elapsed:>9.2f} s")
    print("=" * 62)
    print(f"\nLogin pentru load test: lt000000@{EMAIL_DOMAIN} … "
          f"lt{args.users - 1:06d}@{EMAIL_DOMAIN}")
    print(f"Parola (identică pentru toți): {COMMON_PASSWORD}")


def main() -> None:
    args = parse_args()
    if args.users < 1:
        raise SystemExit("--users trebuie să fie ≥ 1")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
