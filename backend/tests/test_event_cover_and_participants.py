"""Încadrarea copertei (punct focal + zoom) și „Participanți afișați".

Ce se verifică:
  * implicit (nimic setat): centru, zoom 1, participanți = numărul real;
  * încadrarea setată de admin ajunge în lista + detaliul public;
  * validare: focus în [0, 1], zoom în [1, 3], participanți afișați ≥ 0 → 422;
  * `null` explicit la editare resetează încadrarea (coloane NOT NULL);
  * userii văd `max(real, setat)` — niciodată valoarea brută separat;
  * adminul vede ambele (real + setat) și numărul efectiv.
"""
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_admin import ADMIN, API, _make_admin, _register


def _starts_at(days: int = 5) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


async def _create(client, headers, **extra) -> dict:
    resp = await client.post(
        f"{ADMIN}/events",
        json={"title": "Halloween", "starts_at": _starts_at(), "city": "Chișinău", **extra},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_defaults_center_zoom_one_and_real_count(client, db_session):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    user = await _register(client, "u@example.com")

    created = await _create(client, headers)
    assert created["cover_focus_x"] == 0.5
    assert created["cover_focus_y"] == 0.5
    assert created["cover_zoom"] == 1.0
    assert created["displayed_attendee_count"] is None
    assert created["participants_count"] == 0

    detail = (await client.get(f"{API}/events/{created['id']}", headers=user)).json()
    assert detail["cover_focus_x"] == 0.5
    assert detail["cover_zoom"] == 1.0
    assert detail["participants_count"] == 0
    assert detail["attendee_count"] == 0
    # Valoarea brută setată de admin nu se expune userilor.
    assert "displayed_attendee_count" not in detail


@pytest.mark.asyncio
async def test_cover_framing_reaches_public_api(client, db_session):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    user = await _register(client, "u@example.com")

    created = await _create(
        client,
        headers,
        cover_url="https://cdn.example.com/poster.jpg",
        cover_focus_x=0.2,
        cover_focus_y=0.85,
        cover_zoom=1.75,
    )
    detail = (await client.get(f"{API}/events/{created['id']}", headers=user)).json()
    assert detail["cover_focus_x"] == pytest.approx(0.2)
    assert detail["cover_focus_y"] == pytest.approx(0.85)
    assert detail["cover_zoom"] == pytest.approx(1.75)

    listed = (await client.get(f"{API}/events/", headers=user)).json()
    match = [e for e in listed if e["id"] == created["id"]]
    assert match and match[0]["cover_zoom"] == pytest.approx(1.75)

    # Editare parțială: doar zoom-ul; punctul focal rămâne.
    resp = await client.put(
        f"{ADMIN}/events/{created['id']}", json={"cover_zoom": 2.5}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["cover_zoom"] == pytest.approx(2.5)
    assert resp.json()["cover_focus_x"] == pytest.approx(0.2)

    # `null` explicit = resetare la centru / zoom 1 (nu 500 de integritate).
    resp = await client.put(
        f"{ADMIN}/events/{created['id']}",
        json={"cover_focus_x": None, "cover_focus_y": None, "cover_zoom": None},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["cover_focus_x"], body["cover_focus_y"], body["cover_zoom"]) == (
        0.5,
        0.5,
        1.0,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("cover_focus_x", -0.1),
        ("cover_focus_x", 1.01),
        ("cover_focus_y", 2),
        ("cover_zoom", 0.5),
        ("cover_zoom", 3.5),
        ("displayed_attendee_count", -1),
        ("displayed_attendee_count", 1_000_000),
    ],
)
async def test_validation_rejects_out_of_range(client, db_session, field, value):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    resp = await client.post(
        f"{ADMIN}/events",
        json={"title": "X", "starts_at": _starts_at(), "city": "C", field: value},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    created = await _create(client, headers)
    resp = await client.put(
        f"{ADMIN}/events/{created['id']}", json={field: value}, headers=headers
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_displayed_participants_is_max_of_real_and_set(client, db_session):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    alice = await _register(client, "alice@example.com")
    bob = await _register(client, "bob@example.com")

    created = await _create(client, headers, displayed_attendee_count=2)
    event_id = created["id"]
    assert created["displayed_attendee_count"] == 2
    assert created["participants_count"] == 2
    assert created["attendee_count"] == 0  # adminul vede numărul real

    # Setat (2) > real (0) → userii văd 2.
    detail = (await client.get(f"{API}/events/{event_id}", headers=alice)).json()
    assert detail["participants_count"] == 2
    assert detail["attendee_count"] == 2

    # Real (1) < setat (2) → tot 2; „Merg" nu scade numărul.
    resp = await client.post(
        f"{API}/events/{event_id}/going", json={"going": True}, headers=alice
    )
    assert resp.json()["participants_count"] == 2
    assert resp.json()["i_am_going"] is True

    # Coborâm valoarea setată sub real: real câștigă.
    await client.post(f"{API}/events/{event_id}/going", json={"going": True}, headers=bob)
    resp = await client.put(
        f"{ADMIN}/events/{event_id}", json={"displayed_attendee_count": 1}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["attendee_count"] == 2
    assert resp.json()["participants_count"] == 2

    # Gol (null) = numărul real.
    resp = await client.put(
        f"{ADMIN}/events/{event_id}",
        json={"displayed_attendee_count": None},
        headers=headers,
    )
    assert resp.json()["displayed_attendee_count"] is None
    listed = (await client.get(f"{API}/events/", headers=alice)).json()
    match = [e for e in listed if e["id"] == event_id]
    assert match and match[0]["participants_count"] == 2

    # Lista din admin expune ambele.
    rows = (await client.get(f"{ADMIN}/events", headers=headers)).json()
    row = next(r for r in rows if r["id"] == event_id)
    assert row["attendee_count"] == 2
    assert row["participants_count"] == 2
