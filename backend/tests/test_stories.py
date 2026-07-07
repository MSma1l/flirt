"""Teste pentru modulul Stories (rulează pe SQLite in-memory, TZ secț. 11)."""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.story import Story

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


async def _me_id(client, headers: dict) -> str:
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


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


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    return headers, await _me_id(client, headers)


async def _match(client, a_headers, a_id, b_headers, b_id) -> None:
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
    assert resp.json()["matched"] is True, resp.text


@pytest.mark.asyncio
async def test_create_and_list_mine(client):
    """POST creează o poveste; apare în /mine și în / grupat sub autor."""
    headers, uid = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/x.jpg", "caption": "Salut"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text

    mine = await client.get(f"{API}/stories/mine", headers=headers)
    assert mine.status_code == 200
    assert len(mine.json()) == 1

    grouped = await client.get(f"{API}/stories/", headers=headers)
    assert grouped.status_code == 200
    groups = grouped.json()
    assert any(g["user_id"] == uid and g["story_count"] == 1 for g in groups)


@pytest.mark.asyncio
async def test_match_sees_story_nonmatch_does_not(client):
    """Un match vede povestea; un ne-match nu."""
    a_headers, a_id = await _make_user(client, "a@example.com", "A")
    b_headers, b_id = await _make_user(client, "b@example.com", "B")
    c_headers, _ = await _make_user(client, "c@example.com", "C")
    await _match(client, a_headers, a_id, b_headers, b_id)

    await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/a.jpg"},
        headers=a_headers,
    )

    b_view = await client.get(f"{API}/stories/", headers=b_headers)
    assert any(g["user_id"] == a_id for g in b_view.json()), "Match-ul trebuie să vadă."

    c_view = await client.get(f"{API}/stories/", headers=c_headers)
    assert all(g["user_id"] != a_id for g in c_view.json()), "Ne-match-ul NU vede."


@pytest.mark.asyncio
async def test_delete_own_and_forbidden_other(client):
    """Ștergi propria poveste; a altcuiva → 403/404."""
    a_headers, _ = await _make_user(client, "a@example.com", "A")
    b_headers, _ = await _make_user(client, "b@example.com", "B")

    created = await client.post(
        f"{API}/stories/", json={"media_url": "https://cdn/a.jpg"}, headers=a_headers
    )
    story_id = created.json()["id"]

    # B nu poate șterge povestea lui A.
    forbidden = await client.delete(f"{API}/stories/{story_id}", headers=b_headers)
    assert forbidden.status_code in (403, 404), forbidden.text

    # A o poate șterge.
    ok = await client.delete(f"{API}/stories/{story_id}", headers=a_headers)
    assert ok.status_code == 204
    mine = await client.get(f"{API}/stories/mine", headers=a_headers)
    assert mine.json() == []


@pytest.mark.asyncio
async def test_expired_story_not_listed(client, db_session):
    """O poveste expirată nu apare în listări."""
    headers, uid = await _make_user(client, "a@example.com", "A")

    db_session.add(
        Story(
            user_id=uuid.UUID(uid),
            media_url="https://cdn/old.jpg",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await db_session.commit()

    mine = await client.get(f"{API}/stories/mine", headers=headers)
    assert mine.json() == [], "Poveștile expirate nu se listează."
    grouped = await client.get(f"{API}/stories/", headers=headers)
    assert grouped.json() == []
