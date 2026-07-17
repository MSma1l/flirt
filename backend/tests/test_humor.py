"""Teste pentru Testul de umor (SQLite in-memory, TZ 2.7)."""
from datetime import date

import pytest

from app.services.humor_service import HUMOR_TYPES

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> dict:
    """Înregistrare + anketă completă → întoarce headerele de auth."""
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    return headers


# Cele 4 limbi ale aplicației — sufixele câmpurilor de text de pe card.
_LOCALES = ("ro", "ru", "uk", "en")


@pytest.mark.asyncio
async def test_quiz_returns_valid_cards(client):
    """GET /humor/quiz întoarce carduri ne-goale cu tip valid."""
    headers = await _make_user(client, "a@example.com", "A")

    resp = await client.get(f"{API}/humor/quiz", headers=headers)
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) > 0
    for card in cards:
        assert card["id"] and card["text"]
        assert card["type"] in HUMOR_TYPES


@pytest.mark.asyncio
async def test_quiz_cards_localized_in_all_four_languages(client):
    """(a) Fiecare card vine cu textul în toate cele 4 limbi, niciunul gol."""
    headers = await _make_user(client, "loc@example.com", "Loc")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        for locale in _LOCALES:
            key = f"text_{locale}"
            assert key in card, f"cardul {card['id']} nu are {key}"
            # (d) niciun text gol / doar spații în nicio limbă.
            assert card[key].strip(), f"cardul {card['id']} are {key} gol"


@pytest.mark.asyncio
async def test_quiz_cards_texts_differ_between_languages(client):
    """Textele chiar sunt localizate, nu același șir copiat în toate limbile."""
    headers = await _make_user(client, "diff@example.com", "Diff")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        texts = {card[f"text_{locale}"] for locale in _LOCALES}
        assert len(texts) == len(_LOCALES), f"cardul {card['id']} are texte duplicate"


@pytest.mark.asyncio
async def test_quiz_covers_every_humor_type(client):
    """(b) Toate cele 7 tipuri apar în quiz — altfel vectorul iese distorsionat."""
    headers = await _make_user(client, "types@example.com", "Types")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    assert {c["type"] for c in cards} == set(HUMOR_TYPES)


@pytest.mark.asyncio
async def test_quiz_keeps_deprecated_text_alias(client):
    """Câmpul deprecat `text` rămâne în răspuns (= text_ro) pentru clientul publicat."""
    headers = await _make_user(client, "alias@example.com", "Alias")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    for card in cards:
        assert card["text"] == card["text_ro"]


@pytest.mark.asyncio
async def test_submit_builds_normalized_vector(client):
    """POST /humor/submit → vector cu sumă ≈ 1.0 și ponderi mai mari pe alese."""
    headers = await _make_user(client, "b@example.com", "B")

    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    # Alegem primele două carduri drept amuzante, restul nu.
    chosen = cards[:2]
    chosen_types = {c["type"] for c in chosen}
    answers = [
        {"card_id": c["id"], "funny": c in chosen} for c in cards
    ]

    resp = await client.post(
        f"{API}/humor/submit", json={"answers": answers}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    vector = resp.json()["vector"]

    # Suma ponderilor ≈ 1.0.
    assert abs(sum(vector.values()) - 1.0) < 1e-6

    # Tipurile alese au pondere strict mai mare decât cele nealese.
    for chosen_type in chosen_types:
        assert vector[chosen_type] > 0
    for humor_type in HUMOR_TYPES:
        if humor_type not in chosen_types:
            assert vector[humor_type] == 0


@pytest.mark.asyncio
async def test_get_me_returns_saved_vector(client):
    """GET /humor/me întoarce vectorul salvat anterior."""
    headers = await _make_user(client, "c@example.com", "C")
    cards = (await client.get(f"{API}/humor/quiz", headers=headers)).json()
    answers = [{"card_id": c["id"], "funny": c["type"] == "memes"} for c in cards]

    submitted = (
        await client.post(
            f"{API}/humor/submit", json={"answers": answers}, headers=headers
        )
    ).json()["vector"]

    resp = await client.get(f"{API}/humor/me", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["vector"] == submitted
    assert submitted["memes"] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_submit_without_profile_404(client):
    """User fără anketă → submit întoarce 404."""
    headers = await _register(client, "noprofile@example.com")
    resp = await client.post(
        f"{API}/humor/submit",
        json={"answers": [{"card_id": "c1", "funny": True}]},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text
