"""Teste pentru feed-ul de swipe + compatibilitate (rulează pe SQLite in-memory)."""
from datetime import date

import pytest

API = "/api/v1"


def _extract_token(payload: dict) -> str | None:
    """Extrage un access token din răspunsuri de forme uzuale."""
    if not isinstance(payload, dict):
        return None
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    for nested in ("tokens", "data", "auth"):
        if isinstance(payload.get(nested), dict):
            token = _extract_token(payload[nested])
            if token:
                return token
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    """Înregistrează un user și întoarce headerele cu Bearer token."""
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    if token is None:
        resp = await client.post(f"{API}/auth/login", json=body)
        assert resp.status_code == 200, resp.text
        token = _extract_token(resp.json())
    assert token, "Nu am putut obține un access token."
    return {"Authorization": f"Bearer {token}"}


async def _me_id(client, headers: dict) -> str:
    """Id-ul userului curent."""
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(
    *,
    name: str,
    birth_year: int,
    city: str = "Chișinău",
    languages: list[str] | None = None,
    interests: list[str] | None = None,
) -> dict:
    """O anketă validă parametrizabilă."""
    return {
        "name": name,
        "birth_date": date(birth_year, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": city,
        "street": None,
        "nationality": "Moldovean",
        "languages": languages or ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious", "friendship"],
        "interests": interests or ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, anketa: dict) -> tuple[dict, str]:
    """Înregistrează un user, îi completează anketa și întoarce (headers, user_id)."""
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=anketa, headers=headers)
    assert resp.status_code == 200, resp.text
    user_id = await _me_id(client, headers)
    return headers, user_id


# --- Anul curent pentru vârste deterministe ---------------------------------
_ADULT_YEAR = date.today().year - 25   # ~25 ani → 18+
_TEEN_YEAR = date.today().year - 17    # ~17 ani → 16–17


@pytest.mark.asyncio
async def test_feed_excludes_self_and_incomplete(client):
    """Feed-ul nu conține userul curent și nici pe cei fără anketă completă."""
    # A: complet. B: complet. C: doar cont, fără anketă.
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )
    c_headers = await _register(client, "c@example.com")  # fără anketă
    c_id = await _me_id(client, c_headers)

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    ids = {card["user_id"] for card in cards}

    assert a_id not in ids, "Userul curent nu trebuie să apară în feed."
    assert c_id not in ids, "Userii fără anketă completă nu apar în feed."
    assert b_id in ids, "Userul B (complet, aceeași grupă) trebuie să apară."


@pytest.mark.asyncio
async def test_compatibility_is_int_0_100(client):
    """Compatibilitatea din feed este întreg în [0, 100]."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert cards, "Feed-ul ar trebui să conțină cel puțin un candidat."
    for card in cards:
        comp = card["compatibility"]
        assert isinstance(comp, int)
        assert 0 <= comp <= 100
        assert len(card["top_interests"]) <= 3


@pytest.mark.asyncio
async def test_like_without_reciprocity_no_match(client):
    """Like fără reciprocitate → matched False."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    _, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["matched"] is False
    assert data["match_id"] is None


@pytest.mark.asyncio
async def test_mutual_like_creates_match(client):
    """Like reciproc → matched True + match_id, și apare în GET /matches."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    # A dă like lui B (fără match încă).
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    assert resp.json()["matched"] is False

    # B dă like lui A → match.
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["matched"] is True
    assert data["match_id"] is not None

    # Match-ul apare la ambii.
    for headers, other_id in ((a_headers, b_id), (b_headers, a_id)):
        resp = await client.get(f"{API}/feed/matches", headers=headers)
        assert resp.status_code == 200, resp.text
        matches = resp.json()
        assert any(m["user_id"] == other_id for m in matches), matches
        assert all(0 <= m["compatibility"] <= 100 for m in matches)


@pytest.mark.asyncio
async def test_age_separation(client):
    """Un user 18+ NU vede un profil 16–17 și invers (TZ 2.3)."""
    adult_headers, adult_id = await _make_user(
        client, "adult@example.com", _anketa(name="Adult", birth_year=_ADULT_YEAR)
    )
    teen_headers, teen_id = await _make_user(
        client, "teen@example.com", _anketa(name="Teen", birth_year=_TEEN_YEAR)
    )

    # Adultul nu vede minorul.
    resp = await client.get(f"{API}/feed/", headers=adult_headers)
    assert resp.status_code == 200, resp.text
    adult_ids = {c["user_id"] for c in resp.json()}
    assert teen_id not in adult_ids

    # Minorul nu vede adultul.
    resp = await client.get(f"{API}/feed/", headers=teen_headers)
    assert resp.status_code == 200, resp.text
    teen_ids = {c["user_id"] for c in resp.json()}
    assert adult_id not in teen_ids
