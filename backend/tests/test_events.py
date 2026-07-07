"""Teste pentru modulul Evenimente + Flirt Passport (SQLite in-memory, TZ secț. 8)."""
import uuid

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


@pytest.mark.asyncio
async def test_list_events_seeded(client):
    """Lista de evenimente e ne-goală (seed) și i_am_going e False inițial."""
    headers = await _register(client, "e1@example.com")

    resp = await client.get(f"{API}/events/", headers=headers)
    assert resp.status_code == 200, resp.text
    events = resp.json()
    assert len(events) > 0, "Seed-ul ar trebui să insereze evenimente."
    for e in events:
        assert e["i_am_going"] is False
        assert e["attendee_count"] == 0
        assert "starts_at" in e and "kind" in e


@pytest.mark.asyncio
async def test_going_increments_attendee_count(client):
    """going=true crește attendee_count și setează i_am_going."""
    headers = await _register(client, "e2@example.com")

    resp = await client.get(f"{API}/events/", headers=headers)
    event_id = resp.json()[0]["id"]

    resp = await client.post(
        f"{API}/events/{event_id}/going", json={"going": True}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["i_am_going"] is True
    assert data["attendee_count"] == 1

    # Anularea readuce contorul la 0.
    resp = await client.post(
        f"{API}/events/{event_id}/going", json={"going": False}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["i_am_going"] is False
    assert data["attendee_count"] == 0


@pytest.mark.asyncio
async def test_checkin_stamps_passport_idempotent(client):
    """Check-in apare în /passport și nu duplică la a doua apelare."""
    headers = await _register(client, "e3@example.com")

    resp = await client.get(f"{API}/events/", headers=headers)
    event = resp.json()[0]
    event_id = event["id"]

    resp = await client.post(f"{API}/events/{event_id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text
    stamp = resp.json()
    assert stamp["event_id"] == event_id
    assert stamp["event_title"] == event["title"]

    # A doua oară — tot 201, dar fără duplicat.
    resp = await client.post(f"{API}/events/{event_id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text

    resp = await client.get(f"{API}/events/passport", headers=headers)
    assert resp.status_code == 200, resp.text
    stamps = resp.json()
    matching = [s for s in stamps if s["event_id"] == event_id]
    assert len(matching) == 1, "Ștampila nu trebuie duplicată."


@pytest.mark.asyncio
async def test_get_event_not_found(client):
    """GET pe un eveniment inexistent întoarce 404."""
    headers = await _register(client, "e4@example.com")

    resp = await client.get(f"{API}/events/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404, resp.text
