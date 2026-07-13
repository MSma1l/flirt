"""Teste pentru feed-ul de swipe + compatibilitate (rulează pe SQLite in-memory)."""
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import update

from app.models.profile import Profile
from app.services import geo

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
_MINOR_YEAR = date.today().year - 17   # ~17 ani → sub prag (aplicația e 18+ only)


async def _widen_radius(client, headers, km: int = 1000) -> None:
    """Lărgește raza de căutare prin API-ul real.

    Raza de căutare CHIAR se aplică acum (înainte era salvată și ignorată), iar
    implicitul e `search_radius_default_km` = 50 km. Testele care pun candidați
    în alt oraș (Chișinău↔București ≈ 350 km) trebuie să o lărgească explicit,
    altfel candidatul e — corect — în afara razei.
    """
    resp = await client.put(
        f"{API}/settings/", json={"search_radius_km": km}, headers=headers
    )
    assert resp.status_code == 200, resp.text


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
async def test_mutual_like_creates_chat(client):
    """Match reciproc → chat_id ne-null și chat vizibil în GET /chats (fix)."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["matched"] is True
    assert data["chat_id"] is not None, "Un match trebuie să producă un chat_id."

    # Chat-ul apare în lista de dialoguri a ambilor.
    for headers in (a_headers, b_headers):
        resp = await client.get(f"{API}/chats/", headers=headers)
        assert resp.status_code == 200, resp.text
        chat_ids = {c["chat_id"] for c in resp.json()}
        assert data["chat_id"] in chat_ids, resp.json()


@pytest.mark.asyncio
async def test_swipe_dislike_has_no_chat_id(client):
    """Un swipe fără match întoarce chat_id None."""
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
    assert resp.json()["chat_id"] is None


@pytest.mark.asyncio
async def test_feed_excludes_blocked_both_directions(client):
    """I1: A blochează B → B nu apare la A, iar A nu apare la B."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    resp = await client.post(
        f"{API}/social/blocks",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    # B nu apare în feed-ul lui A (blochează în direcția blocker → blocked).
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert b_id not in {c["user_id"] for c in resp.json()}

    # A nu apare în feed-ul lui B (direcția inversă blocked → blocker).
    resp = await client.get(f"{API}/feed/", headers=b_headers)
    assert a_id not in {c["user_id"] for c in resp.json()}


@pytest.mark.asyncio
async def test_feed_respects_profile_hidden(client):
    """I2: B ascunde profilul → B nu mai apare în feed-ul lui A."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    # Inițial B e vizibil.
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert b_id in {c["user_id"] for c in resp.json()}

    # B își ascunde profilul.
    resp = await client.put(
        f"{API}/settings/", json={"profile_hidden": True}, headers=b_headers
    )
    assert resp.status_code == 200, resp.text

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert b_id not in {c["user_id"] for c in resp.json()}


@pytest.mark.asyncio
async def test_feed_language_hard_gate(client):
    """I3: candidat fără nicio limbă comună cu userul curent → exclus (TZ 4.6)."""
    a_headers, _ = await _make_user(
        client,
        "a@example.com",
        _anketa(name="A", birth_year=_ADULT_YEAR, languages=["ru", "ro"]),
    )
    # B nu are nicio limbă comună cu A.
    _, b_id = await _make_user(
        client,
        "b@example.com",
        _anketa(name="B", birth_year=_ADULT_YEAR, languages=["en"]),
    )
    # C are o limbă comună (ro) → rămâne vizibil, ca sanity check.
    _, c_id = await _make_user(
        client,
        "c@example.com",
        _anketa(name="C", birth_year=_ADULT_YEAR, languages=["ro", "en"]),
    )

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    ids = {c["user_id"] for c in resp.json()}
    assert b_id not in ids, "Fără limbă comună → exclus din feed."
    assert c_id in ids, "Cu limbă comună → rămâne în feed."


@pytest.mark.asyncio
async def test_undo_removes_last_like_and_user_reappears(client):
    """Undo elimină ultimul like; userul swipe-uit reapare în feed (TZ 4.4)."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    _, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    # A dă like lui B → B dispare din feed-ul lui A.
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert b_id not in {c["user_id"] for c in resp.json()}

    # Undo → B revine în feed.
    resp = await client.post(f"{API}/feed/undo", headers=a_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["undone"] is True
    assert data["target_user_id"] == b_id

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert b_id in {c["user_id"] for c in resp.json()}


@pytest.mark.asyncio
async def test_undo_on_nothing_returns_false(client):
    """Undo fără niciun swipe → {undone: false, target_user_id: null}."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )

    resp = await client.post(f"{API}/feed/undo", headers=a_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["undone"] is False
    assert data["target_user_id"] is None


@pytest.mark.asyncio
async def test_undo_dismantles_match_and_chat(client):
    """Undo pe un like care produsese match șterge și match-ul + chat-ul (TZ 4.4)."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    chat_id = resp.json()["chat_id"]
    assert chat_id is not None

    # B face undo → match-ul dispare la ambii, iar chat-ul nu mai e accesibil.
    resp = await client.post(f"{API}/feed/undo", headers=b_headers)
    assert resp.json()["undone"] is True

    for headers in (a_headers, b_headers):
        resp = await client.get(f"{API}/feed/matches", headers=headers)
        assert resp.json() == []

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_deferred_message_delivered_on_mutual_match(client):
    """Like cu `message` + match reciproc → mesajul apare în chat (TZ 4.7)."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    # A dă like lui B cu un mesaj deferred (nu e livrat încă — fără match).
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like", "message": "Salut B!"},
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["matched"] is False

    # B dă like lui A → match; mesajul deferred al lui A devine vizibil.
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    chat_id = resp.json()["chat_id"]
    assert chat_id is not None

    # B vede mesajul deferred al lui A în conversație.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.status_code == 200, resp.text
    messages = resp.json()
    bodies = {m["body"]: m for m in messages}
    assert "Salut B!" in bodies, messages
    assert bodies["Salut B!"]["sender_id"] == a_id


@pytest.mark.asyncio
async def test_minor_cannot_complete_anketa(client):
    """Aplicația e 18+ ONLY: o anketă sub prag e respinsă la validare.

    Înlocuiește vechiul `test_age_separation` (separarea 16-17 / 18+), care nu
    mai are obiect: segmentul de minori a fost eliminat complet, pentru că Apple
    clasifică obligatoriu dating-ul la 18+ și o aplicație 18+ nu poate avea
    conturi de minori.
    """
    headers = await _register(client, "minor@example.com")
    resp = await client.put(
        f"{API}/profiles/me",
        json=_anketa(name="Minor", birth_year=_MINOR_YEAR),
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_underage_profile_never_appears_in_feed(client, db_session):
    """Defense-in-depth: chiar dacă un profil sub 18 ajunge în DB (cont vechi,
    dinainte de trecerea la 18+), gate-ul dur din feed îl ascunde — nu ne bazăm
    doar pe validarea de la intrare."""
    adult_headers, _ = await _make_user(
        client, "adult@example.com", _anketa(name="Adult", birth_year=_ADULT_YEAR)
    )
    # Profil valid la creare, apoi coborât sub prag direct în DB (ocolind API-ul),
    # exact ca un cont existent de dinaintea deciziei 18+.
    _, minor_id = await _make_user(
        client, "old@example.com", _anketa(name="Old", birth_year=_ADULT_YEAR)
    )
    await db_session.execute(
        update(Profile)
        .where(Profile.user_id == UUID(minor_id))
        .values(birth_date=date(_MINOR_YEAR, 1, 1))
    )
    await db_session.commit()

    resp = await client.get(f"{API}/feed/", headers=adult_headers)
    assert resp.status_code == 200, resp.text
    assert minor_id not in {c["user_id"] for c in resp.json()}


# --- Geolocație / distanță (TZ 7) -------------------------------------------
def test_haversine_km_known_points():
    """`haversine_km` pe două puncte cunoscute dă o valoare rezonabilă."""
    # Chișinău ↔ București: ~360 km în realitate (verificăm ordinul de mărime).
    d = geo.haversine_km(47.0105, 28.8638, 44.4268, 26.1025)
    assert 300 < d < 420, d
    # Simetrie și punct identic.
    assert geo.haversine_km(47.0, 28.0, 47.0, 28.0) == pytest.approx(0.0)
    d_rev = geo.haversine_km(44.4268, 26.1025, 47.0105, 28.8638)
    assert d == pytest.approx(d_rev)


@pytest.mark.asyncio
async def test_feed_distance_km_between_known_cities(client):
    """Doi useri în orașe cunoscute diferite → distance_km ne-null și > 0."""
    a_headers, _ = await _make_user(
        client,
        "a@example.com",
        _anketa(name="A", birth_year=_ADULT_YEAR, city="Chișinău"),
    )
    _, b_id = await _make_user(
        client,
        "b@example.com",
        _anketa(name="B", birth_year=_ADULT_YEAR, city="București"),
    )
    # ~350 km între orașe: peste raza implicită de 50 km, care ACUM chiar se aplică.
    await _widen_radius(client, a_headers)

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    card = next(c for c in resp.json() if c["user_id"] == b_id)
    assert card["distance_km"] is not None
    assert card["distance_km"] > 0


@pytest.mark.asyncio
async def test_feed_distance_km_none_for_unknown_city(client):
    """Oraș necunoscut (negeocodabil) → distance_km None, fără eroare."""
    a_headers, _ = await _make_user(
        client,
        "a@example.com",
        _anketa(name="A", birth_year=_ADULT_YEAR, city="Chișinău"),
    )
    # Oraș inexistent în dicționarul stub → geocode None.
    _, b_id = await _make_user(
        client,
        "b@example.com",
        _anketa(name="B", birth_year=_ADULT_YEAR, city="Necunoscutopol"),
    )

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    card = next(c for c in resp.json() if c["user_id"] == b_id)
    assert card["distance_km"] is None
