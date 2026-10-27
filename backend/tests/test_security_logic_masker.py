"""Securitate (logică de business): mascarea contactelor — ReDoS + ocoliri.

1. Regex-urile vechi erau pătratice: 8 000 de caractere „aaaa…" = ~1 s de CPU,
   sincron, pe event loop, la fiecare mesaj. Acum: tipare liniare + plafon.
2. Ocoliri: cifre despărțite de litere (`069a123b45`); „despre" din profil
   salvat nemascat.
"""
from __future__ import annotations

import time
from datetime import date

import pytest

from app.services.contact_masker import MASK, MAX_MASK_INPUT_CHARS, mask_contacts

API = "/api/v1"

ADVERSARIAL = {
    "letters": "a" * 10_000,
    "dotted": "a." * 5_000,
    "dashed": "a-" * 5_000,
    "spaced-dots": "a . " * 2_500,
    "alnum": "1a" * 5_000,
    "a.a": "a.a" * 3_334,
    "spaces": "a " * 5_000,
    "obf-at": "x at a " * 1_430,
    "obf-dot": "a(dot)" * 1_667,
    "digits-spaces": "1 " * 5_000,
    "handles": "@" * 10_000,
    "tg": "telegram " * 1_112,
    "digit-letter": "1a1 " * 2_500,
}


def _best_of(fn, runs: int = 3) -> float:
    best = float("inf")
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        best = min(best, time.perf_counter() - t)
    return best


@pytest.mark.parametrize("name", sorted(ADVERSARIAL))
def test_masker_is_linear_on_adversarial_input(name):
    text = ADVERSARIAL[name]
    assert len(text) >= 10_000
    elapsed = _best_of(lambda: mask_contacts(text))
    assert elapsed < 0.05, f"{name}: {elapsed * 1000:.1f} ms (ReDoS?)"


def test_masker_caps_input_length():
    huge = "salut " * 50_000
    masked, _ = mask_contacts(huge)
    assert len(masked) <= MAX_MASK_INPUT_CHARS


@pytest.mark.parametrize(
    "text",
    [
        "scrie-mi 069a123b45",
        "069x123x456",
        "nr meu 0691b2c3d4e5",
        "+373a69b123c456",
    ],
)
def test_digits_separated_by_single_letters_are_masked(text):
    masked, was = mask_contacts(text)
    assert was is True
    assert MASK in masked
    assert sum(ch.isdigit() for ch in masked) < 7, masked


@pytest.mark.parametrize(
    "text",
    [
        "am 25 de ani si 3 copii",
        "COVID19 a trecut",
        "iPhone15 Pro Max e super",
        "hash 3a5f9b2c1d7e",
        "model A1B2C3",
        "pret 1500 lei, camera 2x3 m",
        "ne vedem la 8 sau la 9",
        "etajul 4b, ap 12",
    ],
)
def test_normal_text_with_digits_is_not_masked(text):
    assert mask_contacts(text) == (text, False)


@pytest.mark.parametrize(
    "text",
    [
        "ion.popescu@gmail.com",
        "scrie ion at gmail dot com",
        "ion(at)mail(dot)ru",
        "vezi gmail . com",
        "site: flirt.md/profil",
        "+373 69 123 456",
    ],
)
def test_classic_contacts_still_masked(text):
    masked, was = mask_contacts(text)
    assert was is True and MASK in masked


# --- „Despre" mascat la salvare --------------------------------------------------
def _anketa(about: str) -> dict:
    return {
        "name": "Ana",
        "birth_date": date(date.today().year - 25, 1, 1).isoformat(),
        "gender": "female",
        "height_cm": 165,
        "city": "Chișinău",
        "nationality": "Moldoveancă",
        "languages": ["ro"],
        "about": about,
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": [],
    }


@pytest.mark.asyncio
async def test_profile_about_is_masked_at_save(client):
    resp = await client.post(
        f"{API}/auth/register",
        json={"email": "about@example.com", "password": "Str0ng-Passw0rd!"},
    )
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    resp = await client.put(
        f"{API}/profiles/me",
        json=_anketa("Scrie-mi pe 069a123b45 sau ana@gmail.com"),
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    about = resp.json()["about"]
    assert "ana@gmail.com" not in about
    assert "069a123b45" not in about
    assert MASK in about

    # Textul organic rămâne neatins.
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa("Îmi plac munții și cafeaua."), headers=headers
    )
    assert resp.json()["about"] == "Îmi plac munții și cafeaua."
