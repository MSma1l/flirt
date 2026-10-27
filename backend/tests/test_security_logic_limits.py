"""Securitate (logică de business): limite PER USER pe acțiunile scumpe / abuzabile.

* mesaje text în chat (implicit 60/minut per user);
* `GET /me/export` (implicit 1/oră per user);
* AI: cotă zilnică per user (doar apelurile reale) + memorarea scorului de chimie
  24h per pereche, cu porțile de vizibilitate și `ai_enabled` păstrate.
"""
from __future__ import annotations

import pytest

from app.api.v1 import me as me_api
from app.core import ratelimit
from app.services import ai_assist, chat_service
from tests.test_ai_assist import (
    _chat_id_for,
    _configure_ai,
    _enable_ai,
    _fake_cache,
    _fake_complete,
    _make_user,
    _matched_pair,
)

API = "/api/v1"


@pytest.fixture
def limits_on():
    ratelimit.enable_for_tests()
    yield
    ratelimit.disable_for_tests()


# --- 6. Chat ---------------------------------------------------------------------
@pytest.mark.asyncio
async def test_text_messages_are_rate_limited_per_user(client, monkeypatch, limits_on):
    monkeypatch.setattr(chat_service, "MESSAGES_PER_MINUTE_DEFAULT", 3)
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    codes = []
    for i in range(4):
        r = await client.post(
            f"{API}/chats/{chat_id}/messages", json={"body": f"Salut {i}"}, headers=a_headers
        )
        codes.append(r.status_code)
    assert codes == [201, 201, 201, 429], codes

    # Cota e a userului, nu a conversației: celălalt participant poate scrie.
    r = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": "Hei"}, headers=b_headers
    )
    assert r.status_code == 201, r.text


@pytest.mark.asyncio
async def test_rejected_message_does_not_consume_quota(client, monkeypatch, limits_on):
    """Un 404 (chat străin) nu consumă din cotă: limita se aplică după autorizare."""
    import uuid

    monkeypatch.setattr(chat_service, "MESSAGES_PER_MINUTE_DEFAULT", 1)
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    for _ in range(3):
        r = await client.post(
            f"{API}/chats/{uuid.uuid4()}/messages", json={"body": "x"}, headers=a_headers
        )
        assert r.status_code == 404
    r = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": "ok"}, headers=a_headers
    )
    assert r.status_code == 201, r.text


# --- 6. Export ----------------------------------------------------------------------
@pytest.mark.asyncio
async def test_data_export_is_limited_per_user(client, limits_on):
    assert me_api.EXPORT_PER_HOUR_DEFAULT == 1
    a_headers, _ = await _make_user(client, "exp-a@example.com", "Alice")
    b_headers, _ = await _make_user(client, "exp-b@example.com", "Bob")

    first = await client.get(f"{API}/me/export", headers=a_headers)
    second = await client.get(f"{API}/me/export", headers=a_headers)
    other = await client.get(f"{API}/me/export", headers=b_headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 429, second.text
    assert other.status_code == 200, other.text


# --- 7. AI ----------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ai_daily_quota_per_user(client, monkeypatch, limits_on):
    a_headers, _ = await _make_user(client, "q-a@example.com", "Alice")
    _, b_id = await _make_user(client, "q-b@example.com", "Bob")
    _, c_id = await _make_user(client, "q-c@example.com", "Carol")
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Aveți multe în comun.")
    monkeypatch.setattr(ai_assist, "AI_DAILY_QUOTA_DEFAULT", 1)

    first = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)
    second = await client.get(f"{API}/ai/chemistry/{c_id}", headers=a_headers)

    assert first.status_code == 200, first.text
    assert second.status_code == 429, second.text
    assert len(calls) == 1, "Peste cotă, cererea nu ajunge la furnizor."


@pytest.mark.asyncio
async def test_chemistry_is_cached_per_pair_and_cache_hits_are_free(
    client, monkeypatch, limits_on
):
    a_headers, _ = await _make_user(client, "c-a@example.com", "Alice")
    _, b_id = await _make_user(client, "c-b@example.com", "Bob")
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    cache = _fake_cache(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Aveți sport în comun.")
    monkeypatch.setattr(ai_assist, "AI_DAILY_QUOTA_DEFAULT", 1)

    bodies = []
    for _ in range(3):
        r = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)
        assert r.status_code == 200, r.text
        bodies.append(r.json())

    assert len(calls) == 1, "Aceeași pereche în 24h = un singur apel plătit."
    assert all(b["explanation"] == bodies[0]["explanation"] for b in bodies)
    assert any(k.startswith(ai_assist.CHEMISTRY_CACHE_PREFIX) for k in cache.store)


@pytest.mark.asyncio
async def test_chemistry_cache_does_not_bypass_block_or_ai_toggle(client, monkeypatch):
    a_headers, a_id = await _make_user(client, "cb-a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "cb-b@example.com", "Bob")
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    _fake_cache(monkeypatch)
    _fake_complete(monkeypatch, text="Explicație.")

    r = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)
    assert r.status_code == 200, r.text

    # AI oprit pe cont → 403, chiar dacă rezultatul e memorat.
    resp = await client.put(f"{API}/settings/", json={"ai_enabled": False}, headers=a_headers)
    assert resp.status_code == 200, resp.text
    r = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)
    assert r.status_code == 403, r.text

    # Repornit, dar B l-a blocat pe A → 403 (poarta de vizibilitate rulează prima).
    await _enable_ai(client, a_headers)
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": a_id}, headers=b_headers
    )
    assert resp.status_code in (200, 201, 204), resp.text
    r = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)
    assert r.status_code == 403, r.text
