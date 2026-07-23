"""Teste monetizare (TZ 9) + push (TZ 6.3) — SQLite in-memory, provider stub."""
import pytest

API = "/api/v1"


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


@pytest.mark.asyncio
async def test_plans_public_returns_catalog(client):
    """GET /subscriptions/plans e public și întoarce catalogul complet (TZ 9)."""
    resp = await client.get(f"{API}/subscriptions/plans")
    assert resp.status_code == 200, resp.text
    plans = resp.json()
    codes = {p["code"] for p in plans}
    assert codes == {
        "premium",
        "no_ads",
        "ai_bot",
        "all_inclusive",
        "card_5",
        "card_10",
    }
    # Fiecare plan expune câmpurile așteptate.
    for p in plans:
        assert isinstance(p["title"], str) and p["title"]
        assert isinstance(p["price_eur"], (int, float))
        assert isinstance(p["features"], list) and p["features"]


@pytest.mark.asyncio
async def test_me_null_before_purchase(client):
    """GET /subscriptions/me → null înainte de orice cumpărare."""
    headers = await _register(client, "a@example.com")
    resp = await client.get(f"{API}/subscriptions/me", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() is None


@pytest.mark.asyncio
async def test_purchase_premium_activates_and_me_reflects(client):
    """POST /purchase 'premium' → active; /me reflectă abonamentul."""
    headers = await _register(client, "a@example.com")

    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "premium"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["plan"] == "premium"
    assert body["status"] == "active"
    assert body["expires_at"] is not None

    me = await client.get(f"{API}/subscriptions/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["plan"] == "premium"
    assert me.json()["status"] == "active"


@pytest.mark.asyncio
async def test_entitlements_after_premium(client):
    """GET /entitlements → premium True după cumpărarea planului premium."""
    headers = await _register(client, "a@example.com")

    # Înainte de cumpărare: toate false.
    before = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert before.status_code == 200
    ent_before = before.json()
    assert ent_before["premium"] is False
    assert ent_before["no_ads"] is False
    assert ent_before["ai_bot"] is False
    assert ent_before["event_discount"] is False

    await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "premium"}, headers=headers
    )

    after = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert after.status_code == 200
    ent = after.json()
    assert ent["premium"] is True
    assert ent["no_ads"] is True
    assert ent["ai_bot"] is False
    assert ent["event_discount"] is False


@pytest.mark.asyncio
async def test_entitlements_all_inclusive(client):
    """'all_inclusive' aprinde toate drepturile."""
    headers = await _register(client, "a@example.com")
    await client.post(
        f"{API}/subscriptions/purchase",
        json={"plan": "all_inclusive"},
        headers=headers,
    )
    resp = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    ent = resp.json()
    assert ent["premium"] is True
    assert ent["no_ads"] is True
    assert ent["ai_bot"] is True
    assert ent["event_discount"] is True


@pytest.mark.asyncio
async def test_purchase_card_5_sets_entries_and_event_discount(client):
    """Cardul de reduceri 'card_5' → event_discount True și 5 intrări rămase."""
    headers = await _register(client, "card5@example.com")

    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "card_5"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["plan"] == "card_5"
    assert body["status"] == "active"
    assert body["entries_total"] == 5
    assert body["entries_remaining"] == 5

    ent = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert ent.status_code == 200
    data = ent.json()
    assert data["event_discount"] is True
    assert data["premium"] is False
    assert data["entries_remaining"] == 5
    assert data["entries_total"] == 5

    me = await client.get(f"{API}/subscriptions/me", headers=headers)
    assert me.json()["entries_remaining"] == 5


@pytest.mark.asyncio
async def test_card_10_sets_ten_entries(client):
    """Cardul 'card_10' încarcă 10 intrări."""
    headers = await _register(client, "card10@example.com")
    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "card_10"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["entries_total"] == 10
    assert body["entries_remaining"] == 10


@pytest.mark.asyncio
async def test_non_card_plan_has_null_entries(client):
    """Un plan non-card nu ține evidența intrărilor (null)."""
    headers = await _register(client, "prem@example.com")
    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "premium"}, headers=headers
    )
    body = resp.json()
    assert body["entries_total"] is None
    assert body["entries_remaining"] is None


@pytest.mark.asyncio
async def test_checkin_consumes_card_entry(client):
    """Check-in la un eveniment decrementează intrările cardului (5 → 4)."""
    headers = await _register(client, "consume@example.com")
    await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "card_5"}, headers=headers
    )

    events = await client.get(f"{API}/events/", headers=headers)
    assert events.status_code == 200, events.text
    event_id = events.json()[0]["id"]

    resp = await client.post(f"{API}/events/{event_id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text

    me = await client.get(f"{API}/subscriptions/me", headers=headers)
    assert me.json()["entries_remaining"] == 4
    assert me.json()["entries_total"] == 5

    # Al doilea check-in la ACELAȘI eveniment (ștampilă idempotentă) nu mai scade.
    resp = await client.post(f"{API}/events/{event_id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text
    me = await client.get(f"{API}/subscriptions/me", headers=headers)
    assert me.json()["entries_remaining"] == 4


@pytest.mark.asyncio
async def test_checkin_without_card_does_not_crash(client):
    """Check-in fără card activ funcționează normal (cardul e un bonus, nu condiție)."""
    headers = await _register(client, "nocard@example.com")

    events = await client.get(f"{API}/events/", headers=headers)
    assert events.status_code == 200, events.text
    event_id = events.json()[0]["id"]

    resp = await client.post(f"{API}/events/{event_id}/checkin", headers=headers)
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_purchase_unknown_plan_rejected(client):
    """Un plan necunoscut → 400."""
    headers = await _register(client, "a@example.com")
    resp = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "nope"}, headers=headers
    )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_protected_endpoints_require_auth(client):
    """Endpoint-urile protejate refuză cererile neautentificate."""
    assert (await client.get(f"{API}/subscriptions/me")).status_code == 401
    assert (
        await client.post(f"{API}/subscriptions/purchase", json={"plan": "premium"})
    ).status_code == 401
    assert (await client.post(f"{API}/push/register", json={
        "token": "x", "platform": "ios"
    })).status_code == 401


@pytest.mark.asyncio
async def test_push_register_returns_204_and_upserts(client):
    """POST /push/register → 204; re-înregistrarea aceluiași token rămâne idempotentă."""
    headers = await _register(client, "a@example.com")

    r1 = await client.post(
        f"{API}/push/register",
        json={"token": "expo-token-1", "platform": "ios"},
        headers=headers,
    )
    assert r1.status_code == 204, r1.text

    # Upsert: același token, platformă schimbată → tot 204, fără duplicare.
    r2 = await client.post(
        f"{API}/push/register",
        json={"token": "expo-token-1", "platform": "android"},
        headers=headers,
    )
    assert r2.status_code == 204, r2.text


@pytest.mark.asyncio
async def test_push_test_sends_stub(client):
    """POST /push/test → 204 (trimitere stub către userul curent)."""
    headers = await _register(client, "a@example.com")
    await client.post(
        f"{API}/push/register",
        json={"token": "expo-token-1", "platform": "ios"},
        headers=headers,
    )
    resp = await client.post(f"{API}/push/test", headers=headers)
    assert resp.status_code == 204, resp.text
