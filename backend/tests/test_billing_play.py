"""Teste pentru validarea achizițiilor Google Play (`purchases.subscriptionsv2.get`).

Breșa reparată aici: providerul `play` ridica `NotImplementedError` ⇒ PRIMA achiziție
de pe Android întorcea 500. Acum: verificare reală, iar dacă lipsesc cheile → 503 cu
mesaj clar, nu un crash.

Apelurile HTTP către Google sunt mock-uite (nu atingem rețeaua, nu ne trebuie chei
reale). Ce NU e mock-uit: derivarea planului din produs, dedup-ul și expirarea — adică
exact logica de securitate.
"""
import json
import uuid

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from app.services import billing

API = "/api/v1"

PACKAGE = "eu.flirt.app"
PRODUCT_PREMIUM = "eu.flirt.app.premium.monthly"
PRODUCT_NO_ADS = "eu.flirt.app.noads.monthly"


class _FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error", request=None, response=None  # type: ignore[arg-type]
            )


def _extract_token(payload: dict) -> str | None:
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    return None


async def _new_user(client, db_session, email: str):
    from app.models.user import User

    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Passw0rd!"}
    )
    assert resp.status_code in (200, 201), resp.text
    headers = {"Authorization": f"Bearer {_extract_token(resp.json())}"}
    me = await client.get(f"{API}/auth/me", headers=headers)
    return await db_session.get(User, uuid.UUID(me.json()["id"]))


def _expiry(days: int) -> str:
    import datetime as dt

    return (
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)
    ).isoformat().replace("+00:00", "Z")


@pytest.fixture
def play(tmp_path, monkeypatch):
    """Comută billing-ul pe Google Play, cu un service account fals (cheie RSA reală)."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    sa_file = tmp_path / "service-account.json"
    sa_file.write_text(
        json.dumps(
            {
                "type": "service_account",
                "client_email": "flirt@flirt.iam.gserviceaccount.com",
                "private_key": pem,
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        )
    )

    monkeypatch.setattr(billing.settings, "billing_provider", "play")
    monkeypatch.setattr(billing.settings, "google_play_package", PACKAGE)
    monkeypatch.setattr(
        billing.settings, "google_play_service_account_file", str(sa_file)
    )
    monkeypatch.setattr(billing.settings, "environment", "development")
    return sa_file


def _mock_google(monkeypatch, subscription: dict, captured: dict | None = None):
    """Mock-uiește schimbul de token (POST) + `subscriptionsv2.get` (GET)."""

    async def fake_post(self, url, data=None, json=None, **kwargs):
        if captured is not None:
            captured["token_url"] = url
        return _FakeResponse({"access_token": "ya29.fake-token"})

    async def fake_get(self, url, headers=None, **kwargs):
        if captured is not None:
            captured["api_url"] = url
            captured["headers"] = headers
        return _FakeResponse(subscription)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)


def _active_subscription(product_id: str = PRODUCT_PREMIUM, **overrides) -> dict:
    data = {
        "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
        "latestOrderId": "GPA.3311-1234-5678-90123..0",
        "lineItems": [{"productId": product_id, "expiryTime": _expiry(30)}],
    }
    data.update(overrides)
    return data


# --- BREȘA: `NotImplementedError` → 500 la prima achiziție Android -------------


@pytest.mark.asyncio
async def test_play_fara_chei_raspunde_503_nu_500(client, db_session, monkeypatch):
    """`BILLING_PROVIDER=play` fără service account → 503 cu mesaj clar.

    Înainte: `NotImplementedError` ⇒ 500 Internal Server Error, fără nicio indicație
    despre ce lipsește. Un 500 la prima achiziție de pe Android e un incident;
    un 503 explicit e o configurare de terminat.
    """
    monkeypatch.setattr(billing.settings, "billing_provider", "play")
    monkeypatch.setattr(billing.settings, "google_play_package", PACKAGE)
    monkeypatch.setattr(billing.settings, "google_play_service_account_file", "")

    user = await _new_user(client, db_session, "play-nokeys@example.com")

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt="token-abc")
    assert exc.value.status_code == 503
    assert "GOOGLE_PLAY_SERVICE_ACCOUNT_FILE" in exc.value.detail


@pytest.mark.asyncio
async def test_play_provider_necunoscut_raspunde_503(client, db_session, monkeypatch):
    """Un provider inexistent în config → 503, nu `NotImplementedError` (500)."""
    monkeypatch.setattr(billing.settings, "billing_provider", "paypal")

    user = await _new_user(client, db_session, "unknown-provider@example.com")
    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt="x")
    assert exc.value.status_code == 503
    assert "BILLING_PROVIDER" in exc.value.detail


# --- Cazul fericit + verificarea apelului -------------------------------------


@pytest.mark.asyncio
async def test_play_achizitie_valida_activeaza(play, client, db_session, monkeypatch):
    """Abonament ACTIVE → plan activat, cu expirarea raportată de Google."""
    user = await _new_user(client, db_session, "play-ok@example.com")

    captured: dict = {}
    _mock_google(monkeypatch, _active_subscription(), captured)

    sub = await billing.purchase(db_session, user, "premium", receipt="purchase-token-1")
    assert sub.plan == "premium"
    assert sub.status == "active"

    import datetime as dt

    delta = sub.expires_at - dt.datetime.now(dt.timezone.utc)
    assert dt.timedelta(days=29) < delta < dt.timedelta(days=31)

    # A lovit endpoint-ul corect, cu pachetul și token-ul din cerere.
    assert "subscriptionsv2/tokens/purchase-token-1" in captured["api_url"]
    assert f"applications/{PACKAGE}/" in captured["api_url"]
    assert captured["headers"]["Authorization"] == "Bearer ya29.fake-token"


# --- Escaladare de plan (aceeași breșă ca la App Store) -----------------------


@pytest.mark.asyncio
async def test_play_produs_ieftin_nu_poate_cere_plan_scump(
    play, client, db_session, monkeypatch
):
    """A cumpărat `no_ads`, cere `all_inclusive` → 402."""
    user = await _new_user(client, db_session, "play-escalate@example.com")
    _mock_google(monkeypatch, _active_subscription(PRODUCT_NO_ADS))

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(
            db_session, user, "all_inclusive", receipt="purchase-token-2"
        )
    assert exc.value.status_code == 402
    assert await billing.get_subscription(db_session, user) is None


@pytest.mark.asyncio
async def test_play_abonament_inactiv_respins(play, client, db_session, monkeypatch):
    """Abonament expirat/anulat la Google → 402, nimic activat."""
    user = await _new_user(client, db_session, "play-inactive@example.com")
    _mock_google(
        monkeypatch,
        _active_subscription(subscriptionState="SUBSCRIPTION_STATE_EXPIRED"),
    )

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt="purchase-token-3")
    assert exc.value.status_code == 402
    assert "inactiv" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_play_achizitie_de_test_respinsa_in_productie(
    play, client, db_session, monkeypatch
):
    """`testPurchase` (licență de test, bani zero) în producție → 402."""
    monkeypatch.setattr(billing.settings, "environment", "production")
    user = await _new_user(client, db_session, "play-test@example.com")
    _mock_google(monkeypatch, _active_subscription(testPurchase={}))

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, user, "premium", receipt="purchase-token-4")
    assert exc.value.status_code == 402
    assert "test" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_play_replay_alt_user_respins(play, client, db_session, monkeypatch):
    """Același `latestOrderId` la alt cont → 402 (dedup comun cu App Store)."""
    owner = await _new_user(client, db_session, "play-owner@example.com")
    leech = await _new_user(client, db_session, "play-leech@example.com")
    _mock_google(monkeypatch, _active_subscription())

    await billing.purchase(db_session, owner, "premium", receipt="purchase-token-5")

    with pytest.raises(HTTPException) as exc:
        await billing.purchase(db_session, leech, "premium", receipt="purchase-token-5")
    assert exc.value.status_code == 402
    assert "alt cont" in exc.value.detail.lower()
