#!/usr/bin/env python
"""Creează 20 de conturi de TEST cu profil complet, ca să poți încerca aplicația pe viu.

Printre ele e și contul UTILIZATORULUI (`turcan.play@gmail.com`, „Ivan") — bărbat
interesat de femei, cu destule profiluri feminine potrivite ca feed-ul lui să fie plin.
Două conturi (`control1@`, `control2@`) sunt de CONTROL, pentru demonstrații.

De ce un script separat de `seed_load_data.py`: acela generează SUTE DE MII de rânduri
pentru testarea la scară, cu emailuri aleatoare. Aici vrem exact 20 de conturi cu
credențiale CUNOSCUTE, pe care le poți da cuiva să se autentifice și să vadă aplicația
funcționând.

Ce garantează:
  - toate profilurile sunt COMPLETE (altfel nu apar în feed și nu pot da swipe);
  - fiecare are POZE REALE (portrete de la randomuser.me — un profil fără poze nu
    apare în feed, vezi `feed_service._min_photos_clause`; fără ele feed-ul ar ieși gol);
  - toți au 18+ (aplicația e 18+ only — un profil sub prag e respins de validare);
  - sunt în ACELAȘI oraș, cu coordonate reale, ca să se vadă reciproc în feed
    (raza implicită e 50 km — dacă i-am împrăștia, feed-ul ar ieși gol și ai crede
    că aplicația e stricată);
  - preferințele de căutare se acoperă reciproc (gen + interval de vârstă), altfel
    filtrele dure i-ar exclude unul pe altul;
  - au interese și limbi comune (feed-ul are un gate DUR pe limbă comună);
  - `last_active_at` = acum (conturile inactive de peste 30 de zile sunt filtrate).

IDEMPOTENT: rulat de două ori, actualizează în loc să dubleze. `--reset` le șterge întâi.

Rulare:
    python scripts/create_test_users.py
    docker compose exec api python scripts/create_test_users.py
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402

from app.core.security import hash_password  # noqa: E402
from app.db.session import AsyncSessionLocal, engine  # noqa: E402
from app.models.account import UserSettings  # noqa: E402
from app.models.interest import Interest, ProfileInterest  # noqa: E402
from app.models.profile import Profile  # noqa: E402
from app.models.user import User  # noqa: E402
# `_sync_profile_completed` e „privat", dar îl refolosim INTENȚIONAT: regula
# „profil complet = anketă completă ȘI destule poze" trebuie să existe într-un
# singur loc. Dacă am duplica-o aici, scriptul ar rămâne în urmă când se schimbă
# `settings.min_photos` — și conturile de test ar ajunge iar în onboarding.
from app.services.profile_service import (  # noqa: E402
    _sync_profile_completed,
    seed_interests,
)
# Salvăm pozele EXACT ca endpointul real de upload: cheie sigură server-side
# (`build_photo_key`) + `get_storage().save(...)`. Astfel URL-urile ies sub
# storage-ul propriu (host din STORAGE_PUBLIC_BASE_URL) și trec validarea
# `PUT /profiles/me` — nu mai sunt URL-uri externe randomuser.me care pică la 422.
from app.services.storage import build_photo_key, get_storage  # noqa: E402

# Parola comună. E un cont de TEST, nu de producție — de aceea e vizibilă aici.
TEST_PASSWORD = "TestFlirt2026!"


# Bază de portrete REALE. randomuser.me servește portrete gata decupate, pe genuri:
#   bărbați  -> https://randomuser.me/api/portraits/men/{n}.jpg
#   femei    -> https://randomuser.me/api/portraits/women/{n}.jpg
# cu {n} în 0..99. Descărcăm octeții de aici (Mac-ul are internet) și îi SALVĂM
# prin storage-ul propriu — vezi `_ensure_photo`.
PORTRAIT_BASE = "https://randomuser.me/api/portraits"


def _real_photos(gender: str, seed: int) -> list[str]:
    """3 URL-uri-sursă de portrete REALE potrivite genului, DETERMINIST din `seed`.

    Determinist = idempotent: la re-rulare ies exact aceleași URL-uri-sursă (nu
    folosim `random`, care ar schimba pozele la fiecare rulare). `seed` e unic per
    user, iar cele 3 numere sunt distanțate ca pozele aceluiași profil să nu se
    repete. Genul „other" cade pe pool-ul de bărbați (randomuser nu are un al
    treilea set). Octeții acestor URL-uri se descarcă și se re-salvează local.
    """
    folder = "women" if gender == "female" else "men"
    nums = [seed % 100, (seed + 34) % 100, (seed + 67) % 100]
    return [f"{PORTRAIT_BASE}/{folder}/{n}.jpg" for n in nums]


async def _ensure_photo(
    profile: Profile, gender: str, seed: int, http: httpx.AsyncClient
) -> None:
    """Descarcă 3 portrete reale și le SALVEAZĂ prin storage-ul propriu (idempotent).

    DE CE: un profil FĂRĂ poze nu mai apare în feed (vezi
    `feed_service._min_photos_clause`). Descărcăm octeții portretelor de la
    randomuser.me (reachable de pe Mac) și îi salvăm cu
    `get_storage().save(build_photo_key(...), bytes, "image/jpeg")` — EXACT ca
    endpointul real de upload. Rezultă URL-uri sub storage-ul propriu (host din
    STORAGE_PUBLIC_BASE_URL, namespace `photos/{profile_id}/...`) care:
      (a) se încarcă pe telefon de pe LAN;
      (b) trec `PUT /profiles/me` fără 422.

    Idempotent: dacă profilul are deja poze, nu redescarcă nimic. Degradare
    elegantă: dacă o descărcare eșuează (rețea), sărim peste acea poză; dacă TOATE
    eșuează, cădem pe URL-urile externe ca ultimă plasă, ca profilul să nu rămână
    fără nicio poză (altfel dispare din feed).
    """
    if profile.photos:
        return  # rulare repetată: nu redescărca / nu dubla pozele

    storage = get_storage()
    sources = _real_photos(gender, seed)
    saved: list[str] = []
    for src in sources:
        try:
            resp = await http.get(src)
            resp.raise_for_status()
            content = resp.content
        except Exception as exc:  # rețea indisponibilă → sări peste această poză
            print(f"    ! descărcare eșuată {src}: {exc!r} (sar peste)")
            continue
        key = build_photo_key(profile.id, "image/jpeg")
        saved.append(await storage.save(key, content, "image/jpeg"))

    if saved:
        profile.photos = saved
    else:
        # Ultimă plasă: nicio descărcare n-a reușit (fără rețea). Lăsăm URL-urile
        # externe ca profilul să aibă totuși poze (feed-ul cere ≥1). Nu vor trece
        # editarea prin PUT, dar seed-ul scrie direct în DB, nu prin validare.
        print("    ! toate descărcările au eșuat — folosesc URL-uri externe (fallback)")
        profile.photos = sources

# Cele 7 tipuri de umor (sincron cu `humor_service.HUMOR_TYPES`). Un vector care
# le acoperă pe toate, cu sumă 1, e semnalul „quiz dat" pentru `humorGate`.
HUMOR_TYPES = ["sarcasm", "dark", "memes", "intellectual", "absurd", "wholesome", "physical"]


def _humor_vector(i: int) -> dict[str, float]:
    """Distribuție de umor deterministă, non-goală, variată per user.

    Pornim de la uniform (1/7) și înclinăm două tipuri în funcție de index, ca
    profilurile să nu aibă toate exact același umor (factorul de umor e 20% din
    scorul de compatibilitate). Normalizăm la sumă 1 — forma pe care o produce și
    quiz-ul real (`humor_service._score`)."""
    weights = [1.0] * len(HUMOR_TYPES)
    weights[i % len(HUMOR_TYPES)] += 2.0
    weights[(i + 3) % len(HUMOR_TYPES)] += 1.0
    total = sum(weights)
    return {t: round(w / total, 4) for t, w in zip(HUMOR_TYPES, weights)}


# Toți în Chișinău, cu jitter mic: se văd reciproc în feed (raza implicită = 50 km).
CITY = "Chișinău"
CITY_LAT, CITY_LNG = 47.0105, 28.8638

# `photo_seed` e UNIC per user (per pool de gen) și DETERMINIST — din el ies mereu
# aceleași 3 URL-uri de portret real (vezi `_real_photos`). Nu se repetă între useri.
TEST_USERS = [
    # --- CONTUL UTILIZATORULUI ------------------------------------------------
    # Bărbat interesat de femei. Printre celelalte 19 sunt 10 femei 22–40 din
    # același oraș, cu limbă comună și preferințe care îl includ — deci feed-ul
    # lui e plin când se loghează cu acest cont.
    {
        "email": "turcan.play@gmail.com",
        "name": "Ivan",
        "gender": "male",
        "birth_date": date(1994, 6, 12),   # ~32 ani
        "height_cm": 184,
        "about": "Îmi place să călătoresc, muzica bună și serile lungi cu discuții.",
        "interests": ["travel", "music", "technology"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["female"],
        "photo_seed": 33,
    },
    {
        "email": "ana@test.flrt.md",
        "name": "Ana",
        "gender": "female",
        "birth_date": date(1998, 3, 14),   # ~28 ani
        "height_cm": 168,
        "about": "Îmi place drumeția, cafeaua bună și serile cu prieteni.",
        "interests": ["travel", "music"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["male"],
        "photo_seed": 10,
    },
    {
        "email": "mihai@test.flrt.md",
        "name": "Mihai",
        "gender": "male",
        "birth_date": date(1995, 7, 2),    # ~30 ani
        "height_cm": 182,
        "about": "Alerg dimineața, gătesc seara. Caut pe cineva cu simțul umorului.",
        "interests": ["sport", "music"],
        "statuses": ["serious"],
        "interested_in": ["female"],
        "photo_seed": 15,
    },
    {
        "email": "elena@test.flrt.md",
        "name": "Elena",
        "gender": "female",
        "birth_date": date(2001, 11, 30),  # ~24 ani
        "height_cm": 172,
        "about": "Fotografiez orașul noaptea. Iubesc filmele vechi.",
        "interests": ["photography", "movies"],
        "statuses": ["friendship", "casual"],
        "interested_in": ["male", "female"],
        "photo_seed": 22,
    },
    {
        "email": "victor@test.flrt.md",
        "name": "Victor",
        "gender": "male",
        "birth_date": date(1992, 1, 21),   # ~34 ani
        "height_cm": 178,
        "about": "Inginer, chitarist amator. Caut conversații care merită.",
        "interests": ["music", "sport"],
        "statuses": ["serious"],
        "interested_in": ["female"],
        "photo_seed": 27,
    },
    {
        "email": "daria@test.flrt.md",
        "name": "Daria",
        "gender": "female",
        "birth_date": date(1999, 5, 9),    # ~27 ani
        "height_cm": 165,
        "about": "Călătoresc des, citesc mult. Prefer munții mării.",
        "interests": ["travel", "books"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["male"],
        "photo_seed": 31,
    },
    {
        "email": "sofia@test.flrt.md",
        "name": "Sofia",
        "gender": "female",
        "birth_date": date(1996, 8, 20),   # ~30 ani
        "height_cm": 174,
        "about": "Fotografie de călătorie și cafea la răsărit. Mereu cu rucsacul pregătit.",
        "interests": ["travel", "photography"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["male"],
        "photo_seed": 51,
    },
    {
        "email": "natalia@test.flrt.md",
        "name": "Natalia",
        "gender": "female",
        "birth_date": date(2002, 2, 5),    # ~24 ani
        "height_cm": 160,
        "about": "Dansez salsa de 5 ani. Muzica live îmi face weekendul.",
        "interests": ["dancing", "music"],
        "statuses": ["casual", "acquaintance"],
        "interested_in": ["male", "female"],
        "photo_seed": 63,
    },
    {
        "email": "irina@test.flrt.md",
        "name": "Irina",
        "gender": "female",
        "birth_date": date(1994, 10, 11),  # ~32 ani
        "height_cm": 169,
        "about": "Gătesc pentru prieteni și citesc până noaptea târziu.",
        "interests": ["cooking", "books"],
        "statuses": ["serious"],
        "interested_in": ["male"],
        "photo_seed": 72,
    },
    {
        "email": "carolina@test.flrt.md",
        "name": "Carolina",
        "gender": "female",
        "birth_date": date(2000, 4, 27),   # ~26 ani
        "height_cm": 171,
        "about": "Yoga dimineața, drumeții în weekend. Caut liniște și oameni calzi.",
        "interests": ["yoga", "nature"],
        "statuses": ["friendship", "serious"],
        "interested_in": ["male"],
        "photo_seed": 8,
    },
    {
        "email": "viorica@test.flrt.md",
        "name": "Viorica",
        "gender": "female",
        "birth_date": date(1990, 12, 3),   # ~36 ani
        "height_cm": 166,
        "about": "Expoziții, filme de autor și plimbări lungi prin parc.",
        "interests": ["art", "movies"],
        "statuses": ["serious"],
        "interested_in": ["male"],
        "photo_seed": 19,
    },
    {
        "email": "alina@test.flrt.md",
        "name": "Alina",
        "gender": "female",
        "birth_date": date(2004, 1, 15),   # ~22 ani
        "height_cm": 163,
        "about": "Studentă la IT, jocuri video și meme-uri bune. Simplu și direct.",
        "interests": ["games", "technology"],
        "statuses": ["acquaintance", "casual"],
        "interested_in": ["male"],
        "photo_seed": 88,
    },
    {
        "email": "dan@test.flrt.md",
        "name": "Dan",
        "gender": "male",
        "birth_date": date(1988, 6, 8),    # ~38 ani
        "height_cm": 180,
        "about": "Antreprenor, pasionat de mașini clasice. Weekendul e pentru drumuri.",
        "interests": ["cars", "business"],
        "statuses": ["serious"],
        "interested_in": ["female"],
        "photo_seed": 5,
    },
    {
        "email": "sergiu@test.flrt.md",
        "name": "Sergiu",
        "gender": "male",
        "birth_date": date(1993, 9, 14),   # ~33 ani
        "height_cm": 183,
        "about": "Munte, alergare și un cort mereu în portbagaj. Caut o parteneră de aventuri.",
        "interests": ["sport", "nature"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["female"],
        "photo_seed": 41,
    },
    {
        "email": "radu@test.flrt.md",
        "name": "Radu",
        "gender": "male",
        "birth_date": date(1997, 3, 22),   # ~29 ani
        "height_cm": 177,
        "about": "Dezvoltator, gamer și fan de gadgeturi. Umor sec inclus.",
        "interests": ["technology", "games"],
        "statuses": ["casual", "acquaintance"],
        "interested_in": ["female"],
        "photo_seed": 55,
    },
    {
        "email": "george@test.flrt.md",
        "name": "George",
        "gender": "male",
        "birth_date": date(1986, 11, 2),   # ~40 ani
        "height_cm": 188,
        "about": "Gătesc ca hobby și călătoresc ori de câte ori pot. Caut ceva serios.",
        "interests": ["cooking", "travel"],
        "statuses": ["serious"],
        "interested_in": ["female"],
        "photo_seed": 66,
    },
    {
        "email": "tudor@test.flrt.md",
        "name": "Tudor",
        "gender": "male",
        "birth_date": date(2001, 7, 19),   # ~25 ani
        "height_cm": 175,
        "about": "Cânt la pian și fotografiez concerte. Deschis la oameni noi.",
        "interests": ["music", "photography"],
        "statuses": ["friendship", "casual"],
        "interested_in": ["female", "male"],
        "photo_seed": 77,
    },
    {
        "email": "pavel@test.flrt.md",
        "name": "Pavel",
        "gender": "male",
        "birth_date": date(1999, 5, 30),   # ~27 ani
        "height_cm": 181,
        "about": "Fotbal duminica, filme seara. Caut pe cineva cu care să râd des.",
        "interests": ["sport", "movies"],
        "statuses": ["serious"],
        "interested_in": ["female"],
        "photo_seed": 90,
    },
    # --- Conturi de CONTROL (cerute pentru demonstrații) ---------------------
    # Aceleași garanții ca restul: 18+, același oraș, preferințe care se acoperă
    # reciproc cu celelalte conturi — altfel ar avea feed gol și ar părea stricat.
    {
        "email": "control1@test.flrt.md",
        "name": "Cristina",
        "gender": "female",
        "birth_date": date(1997, 9, 18),   # ~28 ani
        "height_cm": 170,
        "about": "Cont de control. Îmi place teatrul, muzica live și diminețile lente.",
        "interests": ["music", "travel"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["male"],
        "photo_seed": 44,
    },
    {
        "email": "control2@test.flrt.md",
        "name": "Andrei",
        "gender": "male",
        "birth_date": date(1994, 4, 3),    # ~32 ani
        "height_cm": 185,
        "about": "Cont de control. Fac drumeții, joc șah, gătesc când am timp.",
        "interests": ["sport", "travel"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["female"],
        "photo_seed": 38,
    },
]


async def _link_interests(db, profile: Profile, slugs: list[str]) -> None:
    """Leagă interesele prin tabela `profile_interests` (nu există relație ORM).

    Slug-urile vin din catalogul REAL (`seed_interests`) — nu inventăm slug-uri care
    n-ar avea corespondent, altfel profilul ar avea zero interese și scorul de
    compatibilitate ar fi artificial de mic.
    """
    rows = (await db.execute(select(Interest).where(Interest.slug.in_(slugs)))).scalars().all()
    await db.execute(delete(ProfileInterest).where(ProfileInterest.profile_id == profile.id))
    for interest in rows:
        db.add(ProfileInterest(profile_id=profile.id, interest_id=interest.id))


async def run(reset: bool) -> None:
    emails = [u["email"] for u in TEST_USERS]
    password_hash = hash_password(TEST_PASSWORD)  # o singură dată (Argon2 e lent intenționat)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        await seed_interests(db)  # catalogul trebuie să existe înainte să legăm interese

        if reset:
            ids = (await db.execute(select(User.id).where(User.email.in_(emails)))).scalars().all()
            if ids:
                pids = (
                    await db.execute(select(Profile.id).where(Profile.user_id.in_(ids)))
                ).scalars().all()
                if pids:
                    await db.execute(
                        delete(ProfileInterest).where(ProfileInterest.profile_id.in_(pids))
                    )
                await db.execute(delete(Profile).where(Profile.user_id.in_(ids)))
                await db.execute(delete(UserSettings).where(UserSettings.user_id.in_(ids)))
                await db.execute(delete(User).where(User.id.in_(ids)))
                await db.commit()
                print(f"  --reset: {len(ids)} conturi de test șterse")

        created = updated = 0
        # Un singur client HTTP pentru toate descărcările de portret (follow
        # redirects: randomuser.me poate redirecta către CDN).
        http = httpx.AsyncClient(timeout=15.0, follow_redirects=True)
        for i, spec in enumerate(TEST_USERS):
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

            user.last_active_at = now  # altfel filtrul de conturi abandonate îi ascunde

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
            # Vector de umor NON-GOL: testul de umor e obligatoriu, iar
            # `humorGate` (mobil) aruncă în `/humor` orice user cu vector gol —
            # inclusiv din feed, la fiecare intrare. Conturile de test trebuie să
            # aibă deja un vector, altfel rămân prinse pe ecranul de quiz și nu
            # ajung niciodată în aplicație. Distribuție deterministă, variată per
            # user (indexul înclină 2 tipuri), normalizată la sumă 1.
            profile.humor_vector = _humor_vector(i)
            # Coordonate reale + jitter mic: se văd reciproc (raza implicită 50 km).
            profile.lat = CITY_LAT + (i - 2) * 0.004
            profile.lng = CITY_LNG + (i - 2) * 0.004
            await db.flush()  # profile.id e necesar pentru interese ȘI pentru cheia foto
            # Poze REALE: descarcă + salvează prin storage-ul propriu (idempotent).
            await _ensure_photo(profile, spec["gender"], spec["photo_seed"], http)
            # Scriem profilul direct prin ORM, deci ocolim `upsert_anketa` — care e
            # singurul loc ce sincronizează `users.profile_completed`. Fără linia
            # asta, conturile de test rămâneau cu flagul pe `false` și AuthGuard-ul
            # le trimitea în onboarding la login, deși aveau profil complet + poză.
            _sync_profile_completed(user, profile)
            await _link_interests(db, profile, spec["interests"])

            settings_row = (
                await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
            ).scalar_one_or_none()
            if settings_row is None:
                settings_row = UserSettings(user_id=user.id)
                db.add(settings_row)
            # Preferințe care se acoperă reciproc — altfel filtrele dure i-ar exclude.
            settings_row.interested_in = spec["interested_in"]
            settings_row.age_min = 18
            settings_row.age_max = 60
            settings_row.search_radius_km = 100

        await http.aclose()
        await db.commit()

    await engine.dispose()

    print()
    print("  ✔ CONTURI DE TEST GATA")
    print(f"    create: {created}   actualizate: {updated}")
    print()
    print(f"    Parola pentru TOATE: {TEST_PASSWORD}")
    print()
    for spec in TEST_USERS:
        age = date.today().year - spec["birth_date"].year
        print(f"      {spec['email']:26} {spec['name']:8} {spec['gender']:7} ~{age} ani")
    print()
    print("    Toate cele 20 de profiluri sunt COMPLETE și în același oraș, deci se văd")
    print("    reciproc în feed. Autentifică-te cu oricare și vei vedea ceilalți 19.")
    print("    Contul tău: turcan.play@gmail.com (Ivan) — feed plin de profiluri feminine.")


def main() -> None:
    p = argparse.ArgumentParser(
        description="Creează 20 de conturi de test cu profil complet."
    )
    p.add_argument("--reset", action="store_true", help="Șterge întâi conturile de test.")
    args = p.parse_args()
    asyncio.run(run(args.reset))


if __name__ == "__main__":
    main()
