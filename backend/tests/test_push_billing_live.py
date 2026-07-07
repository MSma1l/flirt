"""Teste LIVE pentru Push (Expo/FCM) și Billing (Stripe/App Store).

Toate apelurile HTTP sunt MOCK-uite (monkeypatch pe `httpx.AsyncClient`), deci
nu ating rețeaua și nu au nevoie de chei reale. Providerii se comută prin
monkeypatch pe `settings`. Testele stub existente rămân neatinse (stub = default).
"""
import uuid

import httpx
import pytest

from app.services import billing, push

API = "/api/v1"


# --- Helpers ------------------------------------------------------------------
class _FakeResponse:
    """Răspuns httpx fals: expune `.json()` și `.raise_for_status()`."""

    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            # RO: simulăm comportamentul httpx (ridică HTTPStatusError).
            raise httpx.HTTPStatusError(
                "error", request=None, response=None  # type: ignore[arg-type]
            )


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


async def _get_user(client, db_session, headers):
    from app.models.user import User

    me = await client.get(f"{API}/auth/me", headers=headers)
    return await db_session.get(User, uuid.UUID(me.json()["id"]))


# --- Push: Expo ---------------------------------------------------------------
@pytest.mark.asyncio
async def test_expo_send_hits_correct_url_and_payload(monkeypatch):
    """ExpoPush POST la URL-ul Expo cu payload-ul `{to, title, body}`."""
    calls = []

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse({"data": {"status": "ok"}})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(push.settings, "push_provider", "expo")
    monkeypatch.setattr(push.settings, "push_api_key", "expo-secret")

    sender = push.get_push_sender()
    assert isinstance(sender, push.ExpoPush)

    await sender.send(["ExponentPushToken[abc]"], "Salut", "Ai un match nou")

    assert len(calls) == 1
    assert calls[0]["url"] == push.EXPO_PUSH_URL
    assert calls[0]["json"] == {
        "to": "ExponentPushToken[abc]",
        "title": "Salut",
        "body": "Ai un match nou",
    }
    # Cheia opțională → header Authorization Bearer.
    assert calls[0]["headers"]["Authorization"] == "Bearer expo-secret"


@pytest.mark.asyncio
async def test_expo_send_to_user_does_not_crash(monkeypatch, client, db_session):
    """`send_to_user` cu Expo nu crapă chiar dacă providerul întoarce eroare HTTP."""
    async def failing_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse({"error": "boom"}, status_code=500)

    monkeypatch.setattr(push.settings, "push_provider", "expo")

    headers = await _register(client, "expo@example.com")
    user = await _get_user(client, db_session, headers)
    await push.register_device(db_session, user, "ExponentPushToken[x]", "ios")

    # Patch httpx DOAR după înregistrare (client fixture e tot un httpx.AsyncClient).
    monkeypatch.setattr(httpx.AsyncClient, "post", failing_post)
    # Nu trebuie să ridice — erorile HTTP sunt logate, nu propagate.
    await push.send_to_user(db_session, user.id, "T", "B")


# --- Push: FCM ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_fcm_send_hits_correct_url_and_payload(monkeypatch):
    """FcmPush POST la FCM cu header `key=...` și payload `{to, notification}`."""
    calls = []

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse({"success": 1})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(push.settings, "push_provider", "fcm")
    monkeypatch.setattr(push.settings, "fcm_server_key", "server-key-123")

    sender = push.get_push_sender()
    assert isinstance(sender, push.FcmPush)

    await sender.send(["fcm-token"], "Titlu", "Corp")

    assert len(calls) == 1
    assert calls[0]["url"] == push.FCM_PUSH_URL
    assert calls[0]["json"] == {
        "to": "fcm-token",
        "notification": {"title": "Titlu", "body": "Corp"},
    }
    assert calls[0]["headers"]["Authorization"] == "key=server-key-123"


# --- Billing: Stripe ----------------------------------------------------------
@pytest.mark.asyncio
async def test_stripe_purchase_paid_creates_subscription(
    monkeypatch, client, db_session
):
    """Stripe „paid" → `purchase` creează abonamentul activ."""
    captured = {}

    async def fake_get(self, url, auth=None, **kwargs):
        captured["url"] = url
        captured["auth"] = auth
        return _FakeResponse({"payment_status": "paid", "status": "complete"})

    monkeypatch.setattr(billing.settings, "billing_provider", "stripe")
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")

    headers = await _register(client, "stripe-ok@example.com")
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)  # după înregistrare
    sub = await billing.purchase(db_session, user, "premium", receipt="cs_test_abc")
    assert sub.plan == "premium"
    assert sub.status == "active"
    assert sub.expires_at is not None

    # A lovit sesiunea corectă, cu basic auth (cheia ca username).
    assert captured["url"].endswith("/checkout/sessions/cs_test_abc")
    assert captured["auth"] == ("sk_test_123", "")


@pytest.mark.asyncio
async def test_stripe_purchase_unpaid_rejected(monkeypatch, client, db_session):
    """Stripe „unpaid" → `purchase` ridică 402 și NU creează abonament."""
    async def fake_get(self, url, auth=None, **kwargs):
        return _FakeResponse({"payment_status": "unpaid", "status": "open"})

    monkeypatch.setattr(billing.settings, "billing_provider", "stripe")
    monkeypatch.setattr(billing.settings, "stripe_secret_key", "sk_test_123")

    headers = await _register(client, "stripe-bad@example.com")
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)  # după înregistrare

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt="cs_test_x")
    assert exc.value.status_code == 402

    # Nu s-a creat niciun abonament.
    assert await billing.get_subscription(db_session, user) is None


@pytest.mark.asyncio
async def test_stripe_missing_receipt_rejected(monkeypatch, client, db_session):
    """Fără receipt (id sesiune) → 402, fără apel de rețea reușit."""
    monkeypatch.setattr(billing.settings, "billing_provider", "stripe")

    headers = await _register(client, "stripe-none@example.com")
    user = await _get_user(client, db_session, headers)

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium")
    assert exc.value.status_code == 402


# --- Billing: App Store -------------------------------------------------------
@pytest.mark.asyncio
async def test_app_store_status_zero_creates_subscription(
    monkeypatch, client, db_session
):
    """App Store `status:0` → `purchase` creează abonamentul; verifică payload."""
    captured = {}

    async def fake_post(self, url, json=None, **kwargs):
        captured["url"] = url
        captured["json"] = json
        return _FakeResponse({"status": 0})

    monkeypatch.setattr(billing.settings, "billing_provider", "app_store")
    monkeypatch.setattr(billing.settings, "app_store_shared_secret", "shared-xyz")

    headers = await _register(client, "apple-ok@example.com")
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)  # după înregistrare
    sub = await billing.purchase(db_session, user, "no_ads", receipt="base64receipt")
    assert sub.plan == "no_ads"
    assert sub.status == "active"

    assert captured["url"] == billing._APP_STORE_VERIFY_URL
    assert captured["json"] == {
        "receipt-data": "base64receipt",
        "password": "shared-xyz",
    }


@pytest.mark.asyncio
async def test_app_store_status_nonzero_rejected(monkeypatch, client, db_session):
    """App Store `status!=0` → 402 și NU creează abonament."""
    async def fake_post(self, url, json=None, **kwargs):
        return _FakeResponse({"status": 21002})

    monkeypatch.setattr(billing.settings, "billing_provider", "app_store")
    monkeypatch.setattr(billing.settings, "app_store_shared_secret", "shared-xyz")

    headers = await _register(client, "apple-bad@example.com")
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)  # după înregistrare

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "no_ads", receipt="bad-receipt")
    assert exc.value.status_code == 402

    assert await billing.get_subscription(db_session, user) is None
