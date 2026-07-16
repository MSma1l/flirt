"""Teste de regresie pentru breșele de securitate din zona FEED/SWIPE (pentest).

Fiecare test demonstrează că o breșă concretă e ÎNCHISĂ:
  1. CRITIC — gate 18+ + authz pe `swipe()` (bypass-ul filtrelor din feed).
  2. ÎNALT — mesajul deferred ajunge MASCAT în chat la match (TZ 5.5).
  3. ÎNALT — feed DoS: distanța se geocodează doar pentru rezultate.
  4. RIDICAT — enforcement limită swipe/zi pentru non-premium (TZ 4.5).

Rulează pe SQLite in-memory, refolosind helperele din stilul lui `test_feed.py`.
"""
from datetime import date
from uuid import UUID

import pytest
from sqlalchemy import update

from app.core.config import settings
from app.models.profile import Profile
from app.services import geo
from tests.conftest import upload_photo

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
    # Un profil fără poze nu apare în feedul nimănui (principiu al
    # aplicației) — anketa singură nu e de ajuns. Al doilea pas, exact ca în
    # aplicația reală: PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    user_id = await _me_id(client, headers)
    return headers, user_id


async def _swipe(client, headers, target_user_id, action="like", message=None):
    body = {"target_user_id": target_user_id, "action": action}
    if message is not None:
        body["message"] = message
    return await client.post(f"{API}/feed/swipe", json=body, headers=headers)


# --- Vârste deterministe -----------------------------------------------------
_ADULT_YEAR = date.today().year - 25   # ~25 ani → 18+
_MINOR_YEAR = date.today().year - 17   # ~17 ani → sub prag (aplicația e 18+ only)


async def _widen_radius(client, headers, km: int = 1000) -> None:
    """Lărgește raza de căutare prin API-ul real (implicit: 50 km, ACUM se aplică)."""
    resp = await client.put(
        f"{API}/settings/", json={"search_radius_km": km}, headers=headers
    )
    assert resp.status_code == 200, resp.text


# ============================================================================
# 1. CRITIC — gate 18+ pe swipe()
# ============================================================================
@pytest.mark.asyncio
async def test_swipe_on_underage_profile_forbidden(client, db_session):
    """Un profil sub 18 nu poate fi swipe-uit și nu poate da swipe (gate dur).

    Aplicația e 18+ ONLY, deci separarea minor/adult de dinainte nu mai are
    obiect. Ce rămâne — și e mai important — e ca un cont sub prag rămas în DB
    (creat înainte de decizia 18+) să nu poată participa la swipe în NICIUN sens,
    nici ca sursă, nici ca țintă. Nu ne bazăm doar pe validarea de la intrare.
    """
    adult_headers, adult_id = await _make_user(
        client, "adult@example.com", _anketa(name="Adult", birth_year=_ADULT_YEAR)
    )
    minor_headers, minor_id = await _make_user(
        client, "old@example.com", _anketa(name="Old", birth_year=_ADULT_YEAR)
    )
    # Coborâm profilul sub prag direct în DB, ocolind validarea API.
    await db_session.execute(
        update(Profile)
        .where(Profile.user_id == UUID(minor_id))
        .values(birth_date=date(_MINOR_YEAR, 1, 1))
    )
    await db_session.commit()

    # Adult → sub-prag: respins cu 404 NEUTRU, intenționat — un 403 explicit ar
    # divulga că ținta există și e minoră (vector de enumerare).
    resp = await _swipe(client, adult_headers, minor_id)
    assert resp.status_code == 404, resp.text

    # Sub-prag → adult: 403 explicit (îi spunem propriului user de ce e blocat).
    resp = await _swipe(client, minor_headers, adult_id)
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_swipe_self_is_rejected(client):
    """Self-swipe → respins (403), niciun self-match posibil."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    resp = await _swipe(client, a_headers, a_id)
    assert resp.status_code in (403, 422), resp.text


@pytest.mark.asyncio
async def test_swipe_nonexistent_target_rejected(client):
    """Swipe pe un user inexistent → 404 (nu 200)."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    ghost = "00000000-0000-0000-0000-000000000000"
    resp = await _swipe(client, a_headers, ghost)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_swipe_on_incomplete_profile_rejected(client):
    """Swipe pe un cont fără anketă completă → 404."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    # B are doar cont, fără anketă.
    b_headers = await _register(client, "b@example.com")
    b_id = await _me_id(client, b_headers)

    resp = await _swipe(client, a_headers, b_id)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_swipe_on_blocked_user_rejected_both_directions(client):
    """Block în orice direcție → swipe respins (I1) în ambele sensuri."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    # A îl blochează pe B.
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    assert resp.status_code == 201, resp.text

    # A (blocker) → B: respins.
    resp = await _swipe(client, a_headers, b_id)
    assert resp.status_code == 403, resp.text

    # B (blocked) → A: respins (direcția inversă).
    resp = await _swipe(client, b_headers, a_id)
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_swipe_on_hidden_profile_rejected(client):
    """Profil ascuns (I2) → swipe respins (404 neutru)."""
    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    resp = await client.put(
        f"{API}/settings/", json={"profile_hidden": True}, headers=b_headers
    )
    assert resp.status_code == 200, resp.text

    resp = await _swipe(client, a_headers, b_id)
    assert resp.status_code == 404, resp.text


# ============================================================================
# 2. ÎNALT — mesaj deferred nemascat la livrare
# ============================================================================
@pytest.mark.asyncio
async def test_deferred_message_is_masked_on_match(client):
    """Like cu date de contact în mesaj → la match apare MASCAT în chat (TZ 5.5)."""
    a_headers, a_id = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    b_headers, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    payload = "Scrie-mi pe telegram @ion_secret sau +373 79 123 456"
    resp = await _swipe(client, a_headers, b_id, message=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["matched"] is False

    # B dă like → match; mesajul deferred devine vizibil, dar MASCAT.
    resp = await _swipe(client, b_headers, a_id)
    assert resp.status_code == 200, resp.text
    chat_id = resp.json()["chat_id"]
    assert chat_id is not None

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.status_code == 200, resp.text
    messages = resp.json()
    # Mesajul lui A există, e mascat și nu mai conține contactele originale.
    a_msgs = [m for m in messages if m["sender_id"] == a_id]
    assert a_msgs, messages
    msg = a_msgs[0]
    assert msg["was_masked"] is True, msg
    assert "@ion_secret" not in msg["body"], msg
    assert "79 123 456" not in msg["body"], msg
    assert "373" not in msg["body"], msg
    assert "****" in msg["body"], msg


@pytest.mark.asyncio
async def test_swipe_message_length_capped(client):
    """Mesaj deferred peste `SWIPE_MESSAGE_MAX_LENGTH` → 422 (anti-DoS payload)."""
    from app.schemas.feed import SWIPE_MESSAGE_MAX_LENGTH

    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    _, b_id = await _make_user(
        client, "b@example.com", _anketa(name="B", birth_year=_ADULT_YEAR)
    )

    huge = "x" * (SWIPE_MESSAGE_MAX_LENGTH + 1)
    resp = await _swipe(client, a_headers, b_id, message=huge)
    assert resp.status_code == 422, resp.text


# ============================================================================
# 3. ÎNALT — feed DoS: geocoding doar pentru rezultate
# ============================================================================
@pytest.mark.asyncio
async def test_feed_geocodes_only_returned_cards(client, monkeypatch):
    """Feed cu limită mică geocodează DOAR cardurile returnate, nu toți candidații."""
    # Feed cu o singură cartelă returnată, dar mai mulți candidați în scan.
    monkeypatch.setattr(settings, "feed_limit", 1)
    geo.clear_geocode_cache()

    # Numărăm câte geocode-uri reale se fac (dincolo de cache).
    calls: list[str] = []
    real_geocode = geo.StubGeocoder.geocode

    async def _counting_geocode(self, city, street=None):
        calls.append(city)
        return await real_geocode(self, city, street)

    monkeypatch.setattr(geo.StubGeocoder, "geocode", _counting_geocode)

    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR, city="Chișinău")
    )
    for i in range(4):
        await _make_user(
            client,
            f"cand{i}@example.com",
            _anketa(name=f"C{i}", birth_year=_ADULT_YEAR, city="București"),
        )
    # Candidații sunt în alt oraș (~350 km): peste raza implicită de 50 km, care
    # ACUM chiar se aplică. Lărgim, altfel feed-ul e — corect — gol.
    await _widen_radius(client, a_headers)

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    cards = resp.json()
    assert len(cards) == 1, cards
    # distance_km prezent pentru rezultatul returnat.
    assert cards[0]["distance_km"] is not None
    # Geocoding NU s-a făcut pentru toți cei 4 candidați: la un feed_limit=1,
    # cu cache pe oraș, avem cel mult câteva orașe distincte (A + 1 rezultat),
    # nu geocode per fiecare candidat scanat.
    distinct_cities = {c.strip().casefold() for c in calls}
    assert distinct_cities <= {"chișinău", "bucurești"}, calls
    assert len(calls) <= 4, calls  # NU ~ (candidați * 2) apeluri


@pytest.mark.asyncio
async def test_feed_scan_limit_caps_candidates(client, monkeypatch):
    """`feed_scan_limit` plafonează scanarea la nivel SQL (anti-DoS)."""
    monkeypatch.setattr(settings, "feed_scan_limit", 2)
    monkeypatch.setattr(settings, "feed_limit", 10)

    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    for i in range(5):
        await _make_user(
            client, f"c{i}@example.com", _anketa(name=f"C{i}", birth_year=_ADULT_YEAR)
        )

    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    # Deși există 5 candidați eligibili, scanarea e plafonată la 2.
    assert len(resp.json()) <= 2, resp.json()


# ============================================================================
# 4. RIDICAT — enforcement limită swipe/zi (TZ 4.5)
# ============================================================================
@pytest.mark.asyncio
async def test_non_premium_swipe_limit_enforced(client, monkeypatch):
    """Non-premium peste `free_daily_swipe_limit` → respins (429)."""
    monkeypatch.setattr(settings, "free_daily_swipe_limit", 2)

    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    target_ids = []
    for i in range(4):
        _, tid = await _make_user(
            client, f"t{i}@example.com", _anketa(name=f"T{i}", birth_year=_ADULT_YEAR)
        )
        target_ids.append(tid)

    # Primele 2 swipe-uri trec.
    for tid in target_ids[:2]:
        resp = await _swipe(client, a_headers, tid)
        assert resp.status_code == 200, resp.text

    # Al treilea (nou) depășește limita → respins.
    resp = await _swipe(client, a_headers, target_ids[2])
    assert resp.status_code in (403, 429), resp.text


@pytest.mark.asyncio
async def test_premium_swipe_unlimited(client, monkeypatch):
    """Premium = fără limită de swipe (chiar sub un prag mic)."""
    monkeypatch.setattr(settings, "free_daily_swipe_limit", 1)

    a_headers, _ = await _make_user(
        client, "a@example.com", _anketa(name="A", birth_year=_ADULT_YEAR)
    )
    # A devine premium (în modul billing 'stub' achiziția activează imediat).
    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "premium"}, headers=a_headers
    )
    assert resp.status_code == 200, resp.text
    resp = await client.get(f"{API}/subscriptions/entitlements", headers=a_headers)
    assert resp.json()["premium"] is True, resp.text

    target_ids = []
    for i in range(3):
        _, tid = await _make_user(
            client, f"t{i}@example.com", _anketa(name=f"T{i}", birth_year=_ADULT_YEAR)
        )
        target_ids.append(tid)

    # Toate cele 3 swipe-uri trec, deși limita free e 1.
    for tid in target_ids:
        resp = await _swipe(client, a_headers, tid)
        assert resp.status_code == 200, resp.text
