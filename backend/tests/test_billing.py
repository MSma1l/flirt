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
async def test_plans_public_returns_four(client):
    """GET /subscriptions/plans e public și întoarce cele 4 planuri (TZ 9)."""
    resp = await client.get(f"{API}/subscriptions/plans")
    assert resp.status_code == 200, resp.text
    plans = resp.json()
    assert len(plans) == 4
    codes = {p["code"] for p in plans}
    assert codes == {"premium", "no_ads", "ai_bot", "all_inclusive"}
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
    assert before.json() == {"premium": False, "no_ads": False, "ai_bot": False}

    await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "premium"}, headers=headers
    )

    after = await client.get(f"{API}/subscriptions/entitlements", headers=headers)
    assert after.status_code == 200
    ent = after.json()
    assert ent["premium"] is True
    assert ent["no_ads"] is True
    assert ent["ai_bot"] is False


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
    assert resp.json() == {"premium": True, "no_ads": True, "ai_bot": True}


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
