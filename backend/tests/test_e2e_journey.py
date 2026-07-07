"""Test integrat cap-coadă (E2E) al parcursului unui utilizator (SQLite in-memory).

Un SINGUR flux care leagă modulele reale între ele: auth → profil → feed →
swipe/match → chat (+ mascare contacte + reacții) → billing → evenimente →
stories. Fiecare pas are aserțiuni clare. Folosește DOAR endpoint-uri reale.
"""
from datetime import date

import pytest

from app.services.contact_masker import MASK

API = "/api/v1"

# Vârstă adultă deterministă (~25 ani → 18+), ca în celelalte teste.
_ADULT_YEAR = date.today().year - 25


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
    assert token, "Nu am putut obține un access token la register."
    return {"Authorization": f"Bearer {token}"}


async def _me_id(client, headers: dict) -> str:
    """Id-ul userului curent."""
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(*, name: str, city: str) -> dict:
    """O anketă validă parametrizabilă (aliniată cu test_feed.py)."""
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": city,
        "street": None,
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious", "friendship"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


@pytest.mark.asyncio
async def test_full_user_journey(client):
    """Parcurge tot fluxul unui utilizator, verificând fiecare pas al integrării."""
    # --- Pas 1: register a 2 useri ------------------------------------------
    a_headers = await _register(client, "alice@example.com")
    b_headers = await _register(client, "bob@example.com")
    a_id = await _me_id(client, a_headers)
    b_id = await _me_id(client, b_headers)
    assert a_id != b_id

    # --- Pas 2: completează anketa ambilor (orașe diferite pt. distanță) -----
    resp = await client.put(
        f"{API}/profiles/me",
        json=_anketa(name="Alice", city="Chișinău"),
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    resp = await client.put(
        f"{API}/profiles/me",
        json=_anketa(name="Bob", city="București"),
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text

    # --- Pas 3: A vede B în feed cu compatibility (int 0-100) + distance_km --
    resp = await client.get(f"{API}/feed/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    card = next((c for c in resp.json() if c["user_id"] == b_id), None)
    assert card is not None, "B trebuie să apară în feed-ul lui A."
    assert isinstance(card["compatibility"], int)
    assert 0 <= card["compatibility"] <= 100
    # Orașe cunoscute diferite → distanță geocodabilă ne-null și pozitivă.
    assert card["distance_km"] is not None
    assert card["distance_km"] > 0

    # --- Pas 4: A dă like lui B → încă fără match ---------------------------
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["matched"] is False
    assert resp.json()["chat_id"] is None

    # --- Pas 5: B dă like lui A → match + chat_id ---------------------------
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    swipe = resp.json()
    assert swipe["matched"] is True
    assert swipe["match_id"] is not None
    chat_id = swipe["chat_id"]
    assert chat_id is not None, "Un match trebuie să producă un chat_id."

    # --- Pas 6: GET /chats conține chatul, cu compatibility -----------------
    resp = await client.get(f"{API}/chats/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    chat = next((c for c in resp.json() if c["chat_id"] == chat_id), None)
    assert chat is not None, "Chatul match-ului trebuie să apară în /chats."
    assert chat["other_user_id"] == b_id
    assert isinstance(chat["compatibility"], int)
    assert 0 <= chat["compatibility"] <= 100

    # --- Pas 7: A trimite mesaj cu contact → mascat (was_masked, ****) ------
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "scrie-mi pe telegram @ion, 069123456"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    message_id = msg["id"]
    assert msg["was_masked"] is True
    assert MASK in msg["body"]
    assert "@ion" not in msg["body"]
    assert "069123456" not in msg["body"]
    assert msg["sender_id"] == a_id

    # B vede mesajul (deja mascat) în conversație.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.status_code == 200, resp.text
    assert any(m["id"] == message_id for m in resp.json())

    # --- Pas 8: B reacționează la mesaj → reacția apare ---------------------
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{message_id}/react",
        json={"reaction": "❤️"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reaction"] == "❤️"

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    by_id = {m["id"]: m for m in resp.json()}
    assert by_id[message_id]["reaction"] == "❤️"

    # --- Pas 9: A cumpără premium → entitlements premium=True ---------------
    resp = await client.post(
        f"{API}/subscriptions/purchase",
        json={"plan": "premium"},
        headers=a_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["plan"] == "premium"
    assert resp.json()["status"] == "active"

    resp = await client.get(f"{API}/subscriptions/entitlements", headers=a_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["premium"] is True

    # --- Pas 10: A face check-in la un eveniment → ștampilă în passport -----
    resp = await client.get(f"{API}/events/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    events = resp.json()
    assert events, "Seed-ul de evenimente trebuie să existe."
    event = events[0]

    resp = await client.post(
        f"{API}/events/{event['id']}/checkin", headers=a_headers
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["event_id"] == event["id"]

    resp = await client.get(f"{API}/events/passport", headers=a_headers)
    assert resp.status_code == 200, resp.text
    assert any(s["event_id"] == event["id"] for s in resp.json())

    # --- Pas 11: A publică o poveste → B (match) o vede --------------------
    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/alice.jpg", "caption": "Prima poveste"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    story_id = resp.json()["id"]

    # B, fiind match cu A, vede povestea grupată sub A.
    resp = await client.get(f"{API}/stories/", headers=b_headers)
    assert resp.status_code == 200, resp.text
    a_group = next((g for g in resp.json() if g["user_id"] == a_id), None)
    assert a_group is not None, "Match-ul B trebuie să vadă povestea lui A."
    assert any(s["id"] == story_id for s in a_group["stories"])
