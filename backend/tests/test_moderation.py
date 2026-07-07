"""Teste pentru modulul Moderare / Raportări (SQLite in-memory, TZ 5.5 + 10)."""
from datetime import date

import pytest

from app.core.config import settings

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


@pytest.mark.asyncio
async def test_valid_report_created(client):
    """Un raport valid întoarce 201 și status 'open'."""
    reporter_headers, _ = await _make_user(client, "rep@example.com", "Rep")
    _, target_id = await _make_user(client, "tgt@example.com", "Tgt")

    resp = await client.post(
        f"{API}/reports/",
        json={"reported_user_id": target_id, "category": "spam"},
        headers=reporter_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["reported_id"] == target_id
    assert body["status"] == "open"


@pytest.mark.asyncio
async def test_cannot_report_self(client):
    """Auto-raportarea este respinsă cu 422."""
    headers, my_id = await _make_user(client, "self@example.com", "Self")

    resp = await client.post(
        f"{API}/reports/",
        json={"reported_user_id": my_id, "category": "spam"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_duplicate_report_is_idempotent(client):
    """Același raport (reporter, reported, category) nu creează un al doilea."""
    reporter_headers, _ = await _make_user(client, "rep@example.com", "Rep")
    _, target_id = await _make_user(client, "tgt@example.com", "Tgt")

    first = await client.post(
        f"{API}/reports/",
        json={"reported_user_id": target_id, "category": "spam"},
        headers=reporter_headers,
    )
    second = await client.post(
        f"{API}/reports/",
        json={"reported_user_id": target_id, "category": "spam"},
        headers=reporter_headers,
    )
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    # Idempotent: aceeași înregistrare (același id).
    assert first.json()["id"] == second.json()["id"]

    mine = await client.get(f"{API}/reports/mine", headers=reporter_headers)
    assert len(mine.json()) == 1


@pytest.mark.asyncio
async def test_autoban_hides_reported_from_feed(client):
    """La `report_autoban_threshold` raportori distincți, userul e ascuns din feed."""
    threshold = settings.report_autoban_threshold

    # Userul raportat + un observator care îl vede în feed.
    _, target_id = await _make_user(client, "target@example.com", "Target")
    viewer_headers, _ = await _make_user(client, "viewer@example.com", "Viewer")

    # Înainte de ban, observatorul îl vede în feed.
    before = await client.get(f"{API}/feed/", headers=viewer_headers)
    assert any(c["user_id"] == target_id for c in before.json()), before.text

    # `threshold` raportori DISTINCȚI raportează același user.
    last_status = None
    for i in range(threshold):
        rep_headers = await _register(client, f"reporter{i}@example.com")
        resp = await client.post(
            f"{API}/reports/",
            json={"reported_user_id": target_id, "category": "offensive"},
            headers=rep_headers,
        )
        assert resp.status_code == 201, resp.text
        last_status = resp.json()["status"]

    # La atingerea pragului rapoartele devin auto_banned.
    assert last_status == "auto_banned"

    # După ban, userul raportat nu mai apare în feed (profile_hidden=True).
    after = await client.get(f"{API}/feed/", headers=viewer_headers)
    assert all(c["user_id"] != target_id for c in after.json()), after.text
