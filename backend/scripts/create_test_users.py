#!/usr/bin/env python
"""Creează 7 conturi de TEST cu profil complet, ca să poți încerca aplicația pe viu.

Ultimele două (`control1@`, `control2@`) sunt conturi de CONTROL, pentru demonstrații.

De ce un script separat de `seed_load_data.py`: acela generează SUTE DE MII de rânduri
pentru testarea la scară, cu emailuri aleatoare. Aici vrem exact 5 conturi cu credențiale
CUNOSCUTE, pe care le poți da cuiva să se autentifice și să vadă aplicația funcționând.

Ce garantează:
  - toate profilurile sunt COMPLETE (altfel nu apar în feed și nu pot da swipe);
  - fiecare are o POZĂ (un profil fără poze nu apare în feed — vezi
    `feed_service._min_photos_clause`; fără ea feed-ul ar ieși gol);
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
from app.services.storage import build_photo_key, get_storage  # noqa: E402

# Parola comună. E un cont de TEST, nu de producție — de aceea e vizibilă aici.
TEST_PASSWORD = "TestFlirt2026!"


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """PNG de o singură culoare, scris cu biblioteca standard (fără Pillow).

    DE CE existăm: un profil FĂRĂ poze nu mai apare în feed (principiu: profilul
    trebuie să aibă poze — vezi `feed_service._min_photos_clause`). Conturile de
    test fără poze ar da un feed gol și ai crede că aplicația e stricată.

    Fără Pillow în dependențe, encodăm PNG-ul manual: semnătură + IHDR + IDAT +
    IEND. Culoare plină, ca fiecare cont să se distingă vizual în feed.
    """
    import binascii
    import struct
    import zlib

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(
            ">I", binascii.crc32(body) & 0xFFFFFFFF
        )

    # color_type=2 (RGB), bit_depth=8, fără interlace.
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    # Fiecare scanline e prefixată de octetul de filtru (0 = None).
    row = b"\x00" + bytes(rgb) * width
    idat = zlib.compress(row * height, 9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


async def _ensure_photo(profile: Profile, rgb: tuple[int, int, int]) -> None:
    """Pune o poză pe profil dacă nu are niciuna (idempotent).

    Trece prin `get_storage()`, deci respectă providerul configurat (`local` pe
    server, `stub` în dev) și cheia sigură `photos/{profile_id}/{uuid}.png` —
    aceeași pe care o generează endpointul real de upload.
    """
    if profile.photos:
        return  # rulare repetată: nu dubla pozele
    key = build_photo_key(profile.id, "image/png")
    url = await get_storage().save(key, _solid_png(600, 800, rgb), "image/png")
    profile.photos = [url]

# Toți în Chișinău, cu jitter mic: se văd reciproc în feed (raza implicită = 50 km).
CITY = "Chișinău"
CITY_LAT, CITY_LNG = 47.0105, 28.8638

TEST_USERS = [
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
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (255, 45, 120),
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
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (45, 120, 255),
    },
    {
        "email": "elena@test.flrt.md",
        "name": "Elena",
        "gender": "female",
        "birth_date": date(2001, 11, 30),  # ~24 ani
        "height_cm": 172,
        "about": "Fotografiez orașul noaptea. Iubesc filmele vechi.",
        "interests": ["travel", "music"],
        "statuses": ["friendship", "casual"],
        "interested_in": ["male", "female"],
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (160, 90, 255),
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
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (255, 140, 60),
    },
    {
        "email": "daria@test.flrt.md",
        "name": "Daria",
        "gender": "female",
        "birth_date": date(1999, 5, 9),    # ~27 ani
        "height_cm": 165,
        "about": "Călătoresc des, citesc mult. Prefer munții mării.",
        "interests": ["travel", "sport"],
        "statuses": ["serious", "friendship"],
        "interested_in": ["male"],
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (60, 190, 150),
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
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (250, 200, 60),
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
        # Culoare distinctă a pozei, ca să deosebești conturile în feed.
        "photo_rgb": (90, 200, 255),
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
            # Coordonate reale + jitter mic: se văd reciproc (raza implicită 50 km).
            profile.lat = CITY_LAT + (i - 2) * 0.004
            profile.lng = CITY_LNG + (i - 2) * 0.004
            await db.flush()  # profile.id e necesar pentru cheia pozei și pentru interese
            # Poza vine DUPĂ flush: cheia sigură e `photos/{profile_id}/...`.
            await _ensure_photo(profile, spec["photo_rgb"])
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
    print("    Toate profilurile sunt COMPLETE și în același oraș, deci se văd reciproc")
    print("    în feed. Autentifică-te cu oricare și vei vedea ceilalți 4.")


def main() -> None:
    p = argparse.ArgumentParser(description="Creează 5 conturi de test cu profil complet.")
    p.add_argument("--reset", action="store_true", help="Șterge întâi conturile de test.")
    args = p.parse_args()
    asyncio.run(run(args.reset))


if __name__ == "__main__":
    main()
