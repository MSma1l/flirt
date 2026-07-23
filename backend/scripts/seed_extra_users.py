#!/usr/bin/env python
"""Creează 80 de conturi de test SUPLIMENTARE (peste cele 20 din `create_test_users.py`).

DE CE un al doilea script: `create_test_users.py` are exact 20 de conturi CU NUME
CUNOSCUTE (inclusiv contul tău, `turcan.play@gmail.com`) folosite la demonstrații
pe viu. Aici vrem VOLUM — încă 80 de profiluri complete, feed-ready, generate
PROGRAMATIC (nu scrise câte 80 de mână), ca feed-ul lui Ivan (♂, caută ♀) să fie
plin și profilurile să se vadă reciproc. Split de gen 30% bărbați / 70% femei.

TOATE garanțiile din seed-ul de bază sunt REFOLOSITE prin import, nu rescrise:
  - `_humor_vector(i)` — vector de umor NON-GOL (fără el userul e prins pe `/humor`);
  - `_ensure_photo(profile, gender, seed, http)` — descarcă portrete REALE de pe
    randomuser.me și le salvează LOCAL prin storage (URL-uri `.../media/...`
    edit-proof), EXACT ca endpointul de upload;
  - `_link_interests`, `seed_interests`, `_sync_profile_completed` și constantele
    `CITY`, `CITY_LAT`, `CITY_LNG`, `TEST_PASSWORD`.
Astfel, dacă regula „profil complet" sau formatul pozelor se schimbă în seed-ul de
bază, cele 80 se aliniază automat — nu rămân în urmă.

ADITIV și IDEMPOTENT: NU atinge cele 20 existente. Emailuri deterministe
`extra{NN}@test.flrt.md` (NN=01..80), distincte de cele 20. La re-rulare caută
userul după email și îl ACTUALIZEAZĂ, nu dublează. `--reset` șterge DOAR conturile
`extra*` înainte (nu și cele 20).

Rulare:
    python scripts/seed_extra_users.py
    python scripts/seed_extra_users.py --count 80
    python scripts/seed_extra_users.py --reset
    docker compose exec api python scripts/seed_extra_users.py
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import date, datetime, timezone

# Rădăcina backend-ului pe sys.path (pentru `app.*`) ȘI folderul `scripts` (pentru
# a importa helperele din `create_test_users`). `create_test_users` face și el
# același insert la import, dar îl punem explicit ca importul să nu depindă de ordine.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))  # backend/
sys.path.insert(0, _HERE)                   # backend/scripts/

import httpx  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.models.account import UserSettings  # noqa: E402
from app.models.interest import ProfileInterest  # noqa: E402
from app.models.profile import Profile  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services.profile_service import (  # noqa: E402
    _sync_profile_completed,
    seed_interests,
)

# REFOLOSIRE prin import a tuturor garanțiilor din seed-ul de bază. Helperele sunt
# la nivel de modul (importabile), iar `main()` e sub `if __name__ == '__main__'`,
# deci importul NU deschide nicio conexiune și NU rulează nimic.
from create_test_users import (  # noqa: E402
    CITY,
    CITY_LAT,
    CITY_LNG,
    TEST_PASSWORD,
    _ensure_photo,
    _humor_vector,
    _link_interests,
)

# Prefix de email pentru conturile suplimentare. Distinct de `*@test.flrt.md`
# folosite de cele 20 (ana@, mihai@, control1@ ...), deci nu există coliziune.
EMAIL_PREFIX = "extra"
EMAIL_DOMAIN = "test.flrt.md"


# --- Pool-uri de nume moldovenești / românești ------------------------------
# Suficient de mari cât să acopere 24 M + 56 F fără repetare. Dacă `--count` cere
# mai mult decât pool-ul, adăugăm un sufix numeric (vezi `_name`).
MALE_NAMES = [
    "Andrei", "Ion", "Vasile", "Mihai", "Alexandru", "Dumitru", "Petru", "Vlad",
    "Cristian", "Adrian", "Marius", "Sorin", "Bogdan", "Daniel", "Florin",
    "Lucian", "Emil", "Octavian", "Valeriu", "Grigore", "Sergiu", "Igor",
    "Denis", "Maxim", "Roman", "Eugen", "Nicolae", "Constantin", "Anatol",
    "Gheorghe",
]
FEMALE_NAMES = [
    "Maria", "Ana", "Elena", "Ecaterina", "Natalia", "Cristina", "Daniela",
    "Mihaela", "Aliona", "Tatiana", "Oxana", "Diana", "Corina", "Iuliana",
    "Liliana", "Rodica", "Svetlana", "Veronica", "Doina", "Lucia", "Angela",
    "Nadejda", "Galina", "Larisa", "Viorica", "Stela", "Marina", "Olga",
    "Valentina", "Ludmila", "Alexandra", "Carolina", "Simona", "Raluca",
    "Andreea", "Gabriela", "Ioana", "Bianca", "Roxana", "Denisa", "Nicoleta",
    "Camelia", "Georgiana", "Adriana", "Monica", "Otilia", "Silvia", "Teodora",
    "Anastasia", "Victoria", "Iryna", "Sofia", "Emilia", "Florentina",
    "Loredana", "Alexandrina", "Cătălina", "Mădălina", "Ramona", "Aurelia",
]

# Slug-uri de interese din catalogul REAL (`INTERESTS_CATALOG` din
# `profile_service`). NU inventăm slug-uri — unul inexistent ar lăsa profilul cu
# zero interese și scor de compatibilitate artificial de mic.
INTEREST_SLUGS = [
    "sport", "travel", "cars", "music", "dancing", "business", "movies",
    "books", "games", "animals", "cooking", "photography", "yoga", "fashion",
    "nature", "board_games", "volunteering", "technology", "art",
]

# Statusuri de dating din setul valid (`DATING_STATUSES`): serious, acquaintance,
# friendship, events, casual. Combinații variate, alese determinist per index.
STATUS_COMBOS = [
    ["serious", "friendship"],
    ["serious"],
    ["friendship", "casual"],
    ["casual", "acquaintance"],
    ["serious", "events"],
    ["friendship"],
    ["events", "casual"],
    ["serious", "acquaintance"],
]

# Șabloane de „despre mine", completate cu numele unui interes ales. Variație ca
# profilurile să nu arate clonate.
ABOUT_TEMPLATES = [
    "Îmi place {a} și serile lungi cu discuții bune.",
    "Pasionat(ă) de {a}. Caut pe cineva cu simțul umorului.",
    "{a} în weekend, cafea bună dimineața. Simplu și direct.",
    "Între {a} și prieteni buni — așa arată o zi reușită.",
    "Iubesc {a} și oamenii calzi. Deschis(ă) la lucruri noi.",
    "{a} mă încarcă. Caut conversații care merită.",
]

# Etichete lizibile pentru interese (doar pentru textul „despre mine").
_INTEREST_LABEL = {
    "sport": "sportul", "travel": "călătoriile", "cars": "mașinile",
    "music": "muzica", "dancing": "dansul", "business": "business-ul",
    "movies": "filmele", "books": "cărțile", "games": "jocurile",
    "animals": "animalele", "cooking": "gătitul", "photography": "fotografia",
    "yoga": "yoga", "fashion": "moda", "nature": "natura",
    "board_games": "jocurile de societate", "volunteering": "voluntariatul",
    "technology": "tehnologia", "art": "arta",
}


def _genders(count: int) -> list[str]:
    """Listă de genuri de lungime `count`, exact 30% `male` / 70% `female`.

    Bărbații sunt DISTRIBUIȚI uniform printre femei (algoritm tip Bresenham),
    determinist — nu grupați la început. Pentru `count=80` ies exact 24 M + 56 F.
    """
    n_male = round(count * 0.30)
    genders: list[str] = []
    acc = 0
    for _ in range(count):
        acc += n_male
        if acc >= count:
            acc -= count
            genders.append("male")
        else:
            genders.append("female")
    # Garanție exactă a numărului de bărbați (rotunjirea Bresenham poate devia ±0).
    have_male = genders.count("male")
    idx = 0
    while have_male < n_male and idx < count:
        if genders[idx] == "female":
            genders[idx] = "male"
            have_male += 1
        idx += 1
    idx = 0
    while have_male > n_male and idx < count:
        if genders[idx] == "male":
            genders[idx] = "female"
            have_male -= 1
        idx += 1
    return genders


def _name(gender: str, gender_index: int) -> str:
    """Nume determinist din pool-ul de gen; sufix numeric dacă pool-ul se termină."""
    pool = MALE_NAMES if gender == "male" else FEMALE_NAMES
    base = pool[gender_index % len(pool)]
    lap = gender_index // len(pool)
    return base if lap == 0 else f"{base} {lap + 1}"


def _birth_date(i: int, today: date) -> date:
    """Data nașterii deterministă din index, vârstă 18–45 (aplicația e 18+ only).

    Vârsta baleiază 18..45 pe măsură ce crește indexul; luna/ziua variază și ele
    ca profilurile să nu aibă toate aceeași aniversare. Ziua ≤ 28 (evită 29–31).
    """
    age = 18 + (i * 5 + 3) % 28          # 18..45
    month = (i % 12) + 1
    day = (i % 28) + 1
    # Dacă aniversarea de anul ăsta n-a trecut încă, vârsta ÎMPLINITĂ ar fi age-1
    # → scad un an ca vârsta reală să fie exact `age` (aplicația e 18+ only, nu
    # putem scăpa nimeni la 17).
    not_yet = (month, day) > (today.month, today.day)
    return date(today.year - age - (1 if not_yet else 0), month, day)


def _height(gender: str, i: int) -> int:
    """Înălțime deterministă, variată, plauzibilă pe gen."""
    if gender == "male":
        return 172 + (i * 3) % 21        # 172..192
    return 158 + (i * 3) % 21            # 158..178


def _interests(i: int) -> list[str]:
    """3 slug-uri VALIDE, distincte, variate per index (din catalogul real)."""
    n = len(INTEREST_SLUGS)
    idxs = [i % n, (i * 2 + 5) % n, (i * 3 + 11) % n]
    out: list[str] = []
    for k in idxs:
        while INTEREST_SLUGS[k] in out:   # asigură 3 slug-uri DISTINCTE
            k = (k + 1) % n
        out.append(INTEREST_SLUGS[k])
    return out


def _interested_in(gender: str, i: int) -> list[str]:
    """Preferințe care garantează feed reciproc plin.

    Bărbații → `["female"]`. Femeile → `["male"]` majoritar, cu ~1 din 5
    `["male", "female"]`. Scop: Ivan (♂, caută ♀) are feed plin, iar femeile
    bi-curioase îmbogățesc și feed-urile feminine.
    """
    if gender == "male":
        return ["female"]
    return ["male", "female"] if i % 5 == 0 else ["male"]


def _spec(i: int, gender: str, gender_index: int, today: date) -> dict:
    """Construiește DETERMINIST specificația unui cont suplimentar."""
    nn = f"{i + 1:02d}"
    interests = _interests(i)
    label = _INTEREST_LABEL[interests[0]]
    return {
        "email": f"{EMAIL_PREFIX}{nn}@{EMAIL_DOMAIN}",
        "name": _name(gender, gender_index),
        "gender": gender,
        "birth_date": _birth_date(i, today),
        "height_cm": _height(gender, i),
        "about": ABOUT_TEMPLATES[i % len(ABOUT_TEMPLATES)].format(a=label),
        "interests": interests,
        "statuses": STATUS_COMBOS[i % len(STATUS_COMBOS)],
        "interested_in": _interested_in(gender, i),
        # Seed foto UNIC per user în cadrul genului → portrete distincte pe gen.
        # (randomuser are 0..99 per gen; peste 100 într-un gen, repetările sunt ok.)
        "photo_seed": gender_index,
    }


def build_specs(count: int) -> list[dict]:
    """Lista completă de specificații, generată PROGRAMATIC (nu hardcodată)."""
    today = date.today()
    genders = _genders(count)
    male_seen = female_seen = 0
    specs: list[dict] = []
    for i, gender in enumerate(genders):
        if gender == "male":
            gender_index = male_seen
            male_seen += 1
        else:
            gender_index = female_seen
            female_seen += 1
        specs.append(_spec(i, gender, gender_index, today))
    return specs


async def _reset(db, emails: list[str]) -> None:
    """Șterge DOAR conturile `extra*` (respectă FK: interese → profil → settings → user)."""
    ids = (await db.execute(select(User.id).where(User.email.in_(emails)))).scalars().all()
    if not ids:
        return
    pids = (
        await db.execute(select(Profile.id).where(Profile.user_id.in_(ids)))
    ).scalars().all()
    if pids:
        await db.execute(delete(ProfileInterest).where(ProfileInterest.profile_id.in_(pids)))
    await db.execute(delete(Profile).where(Profile.user_id.in_(ids)))
    await db.execute(delete(UserSettings).where(UserSettings.user_id.in_(ids)))
    await db.execute(delete(User).where(User.id.in_(ids)))
    await db.commit()
    print(f"  --reset: {len(ids)} conturi suplimentare șterse")


async def run(count: int, reset: bool) -> None:
    specs = build_specs(count)
    emails = [s["email"] for s in specs]
    password_hash = hash_password(TEST_PASSWORD)  # o singură dată (Argon2 e lent)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        await seed_interests(db)  # catalogul trebuie să existe înainte de a lega interese

        if reset:
            await _reset(db, emails)

        created = updated = 0
        # Un singur client HTTP pentru toate descărcările de portret (follow
        # redirects: randomuser.me poate redirecta către CDN).
        http = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
        for i, spec in enumerate(specs):
            user = (
                await db.execute(select(User).where(User.email == spec["email"]))
            ).scalar_one_or_none()

            if user is None:
                user = User(email=spec["email"], password_hash=password_hash)
                db.add(user)
                await db.flush()
                created += 1
            else:
                user.password_hash = password_hash
                updated += 1

            user.last_active_at = now  # altfel filtrul de conturi abandonate îl ascunde

            profile = (
                await db.execute(select(Profile).where(Profile.user_id == user.id))
            ).scalar_one_or_none()
            if profile is None:
                profile = Profile(user_id=user.id)
                db.add(profile)

            profile.name = spec["name"]
            profile.birth_date = spec["birth_date"]
            profile.gender = spec["gender"]
            profile.height_cm = spec["height_cm"]
            profile.city = CITY
            profile.nationality = "Moldovean"
            profile.languages = ["ro", "ru"]          # limbă comună: gate DUR în feed
            profile.about = spec["about"]
            profile.dating_statuses = spec["statuses"]
            profile.completed = True                  # fără asta NU apare în feed
            profile.humor_vector = _humor_vector(i)   # vector NON-GOL: scoate userul de pe /humor
            # Cluster strâns în jurul Chișinăului (±~3 km) — toți se văd reciproc,
            # bine sub raza implicită de 50 km, indiferent de câți sunt.
            profile.lat = CITY_LAT + ((i % 21) - 10) * 0.003
            profile.lng = CITY_LNG + (((i * 3) % 21) - 10) * 0.003
            await db.flush()  # profile.id e necesar pentru interese ȘI pentru cheia foto
            # Poze REALE locale: descarcă + salvează prin storage-ul propriu (idempotent).
            await _ensure_photo(profile, spec["gender"], spec["photo_seed"], http)
            # Sincronizează `users.profile_completed` (altfel AuthGuard trimite în onboarding).
            _sync_profile_completed(user, profile)
            await _link_interests(db, profile, spec["interests"])

            settings_row = (
                await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
            ).scalar_one_or_none()
            if settings_row is None:
                settings_row = UserSettings(user_id=user.id)
                db.add(settings_row)
            settings_row.interested_in = spec["interested_in"]
            settings_row.age_min = 18
            settings_row.age_max = 60
            settings_row.search_radius_km = 100

        await http.aclose()
        await db.commit()

    await engine.dispose()

    males = sum(1 for s in specs if s["gender"] == "male")
    females = len(specs) - males
    print()
    print("  ✔ CONTURI SUPLIMENTARE GATA")
    print(f"    create: {created}   actualizate: {updated}")
    print(f"    split gen: {males} bărbați / {females} femei (din {len(specs)})")
    print(f"    parola pentru TOATE: {TEST_PASSWORD}")
    print(f"    emailuri: {EMAIL_PREFIX}01..{EMAIL_PREFIX}{len(specs):02d}@{EMAIL_DOMAIN}")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Creează conturi de test SUPLIMENTARE (aditiv la cele 20)."
    )
    p.add_argument("--count", type=int, default=80,
                   help="Câte conturi suplimentare (default 80). Split 30%% M / 70%% F.")
    p.add_argument("--reset", action="store_true",
                   help="Șterge întâi DOAR conturile extra* (nu și cele 20).")
    args = p.parse_args()
    if args.count < 1:
        p.error("--count trebuie să fie ≥ 1")
    asyncio.run(run(args.count, args.reset))


if __name__ == "__main__":
    main()
