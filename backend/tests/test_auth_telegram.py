"""Teste pentru autentificarea Telegram Mini App (POST /api/v1/auth/telegram).

DE CE SEMNĂM `initData` „DE MÂNĂ" AICI
--------------------------------------
Testele NU refolosesc funcția de hash din `app.services.telegram_auth`: dacă
implementarea inversează cheia cu mesajul în derivarea `secret_key` (greșeala
clasică a protocolului — constanta `WebAppData` e CHEIA, tokenul botului e
MESAJUL), un test scris peste aceeași funcție ar trece verde, iar backendul ar
respinge în producție ORICE initData real de la Telegram. Semnăm cu algoritmul
din documentația Telegram, scris independent, ca testul să prindă exact asta.
"""
import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import func, select

from app.core.config import Settings, settings
from app.models.user import User
from app.services import telegram_auth
# Baseline-ul de producție VALID, refolosit din testele guardului de config: ce
# verificăm aici e DOAR delta pe Telegram, nu întreaga configurare de prod.
from tests.test_config import _prod_kwargs

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/auth"

# Token de bot FALS, cu forma reală (`<bot_id>:<secret>`). Nu deschide nimic.
FAKE_BOT_TOKEN = "7654321:AAFakeTestTokenForUnitTestsOnly-0000000"


def _sign(fields: dict[str, str], bot_token: str) -> str:
    """Hash-ul Telegram pentru câmpurile date (algoritmul din documentație)."""
    data_check_string = "\n".join(
        f"{k}={fields[k]}" for k in sorted(fields) if k not in ("hash", "signature")
    )
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()
    return hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()


def _build_init_data(
    *,
    telegram_id: int = 555_000_111,
    username: str | None = "ivan_test",
    auth_date: int | None = None,
    bot_token: str = FAKE_BOT_TOKEN,
    query_id: str = "AAHdF6IQAAAAAN0XohDhrOrc",
    with_signature: bool = False,
    hash_override: str | None = None,
) -> str:
    """Construiește un `initData` valid (sau deliberat stricat) ca query-string."""
    user = {
        "id": telegram_id,
        "first_name": "Ivan",
        "last_name": "Test",
        "username": username,
        "language_code": "ro",
        "is_premium": True,
    }
    fields = {
        "user": json.dumps(user, separators=(",", ":")),
        "auth_date": str(auth_date if auth_date is not None else int(time.time())),
        "query_id": query_id,
    }
    if with_signature:
        # Câmp Ed25519 adăugat de Telegram; NU intră în `data_check_string`.
        fields["signature"] = "ZmFrZV9zaWduYXR1cmVfZm9yX3Rlc3Rz"
    fields["hash"] = hash_override or _sign(fields, bot_token)
    return urlencode(fields)


@pytest.fixture(autouse=True)
def telegram_live_mode(monkeypatch):
    """Mod 'live' + token fals + store anti-replay curat, pentru fiecare test.

    Fără asta testele ar rula pe ramura 'stub' (implicită în dev), care sare
    peste exact criptografia pe care o testăm aici.
    """
    monkeypatch.setattr(settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN)
    monkeypatch.setattr(settings, "telegram_init_data_max_age_seconds", 86_400)
    telegram_auth.reset_replay_state()
    yield
    telegram_auth.reset_replay_state()


async def _login(client: AsyncClient, init_data: str):
    return await client.post(f"{BASE}/telegram", json={"init_data": init_data})


# --------------------------------------------------------------------------- #
# Verificarea semnăturii
# --------------------------------------------------------------------------- #


async def test_valid_init_data_returns_tokens(client: AsyncClient):
    resp = await _login(client, _build_init_data())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"


async def test_signature_field_is_excluded_from_data_check_string(
    client: AsyncClient,
):
    """`signature` (Ed25519) NU intră în șirul semnat cu HMAC.

    Dacă ar fi inclus, orice initData modern trimis de Telegram ar fi respins.
    """
    resp = await _login(client, _build_init_data(with_signature=True))
    assert resp.status_code == 200, resp.text


async def test_invalid_hash_returns_401(client: AsyncClient):
    bad = _build_init_data(hash_override="0" * 64)
    assert (await _login(client, bad)).status_code == 401


async def test_hash_signed_with_other_bot_token_returns_401(client: AsyncClient):
    """Un initData semnat cu ALT bot nu are voie să deschidă conturi la noi."""
    other = _build_init_data(bot_token="1111111:AAOtherBotTokenEntirely")
    assert (await _login(client, other)).status_code == 401


async def test_inverted_key_and_message_is_rejected(client: AsyncClient):
    """Regresie: `secret_key` derivat INVERS (token ca cheie) trebuie respins.

    E greșeala clasică a protocolului. Dacă implementarea ar face-o, ACEST
    initData ar trece, iar cel din `test_valid_init_data_returns_tokens` ar pica.
    """
    user = {"id": 999_000_111, "first_name": "Ivan"}
    fields = {
        "user": json.dumps(user, separators=(",", ":")),
        "auth_date": str(int(time.time())),
    }
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    inverted_secret = hmac.new(
        FAKE_BOT_TOKEN.encode(), b"WebAppData", hashlib.sha256
    ).digest()
    fields["hash"] = hmac.new(
        inverted_secret, dcs.encode(), hashlib.sha256
    ).hexdigest()
    assert (await _login(client, urlencode(fields))).status_code == 401


async def test_tampered_user_id_returns_401(client: AsyncClient):
    """Semnătura validă + `user` modificat după semnare → 401 (nu 200 cu alt id)."""
    raw = _build_init_data(telegram_id=100_000_001)
    tampered = raw.replace("100000001", "100000002")
    assert tampered != raw
    assert (await _login(client, tampered)).status_code == 401


# --------------------------------------------------------------------------- #
# auth_date
# --------------------------------------------------------------------------- #


async def test_expired_auth_date_returns_401(client: AsyncClient):
    old = int(time.time()) - (settings.telegram_init_data_max_age_seconds + 60)
    assert (await _login(client, _build_init_data(auth_date=old))).status_code == 401


async def test_future_auth_date_returns_401(client: AsyncClient):
    """`auth_date` în viitor = fabricat, ca să prelungească fereastra de valabilitate."""
    future = int(time.time()) + 3600
    assert (
        await _login(client, _build_init_data(auth_date=future))
    ).status_code == 401


# --------------------------------------------------------------------------- #
# initData malformat
# --------------------------------------------------------------------------- #


async def test_missing_user_field_returns_401(client: AsyncClient):
    fields = {"auth_date": str(int(time.time())), "query_id": "AAA"}
    fields["hash"] = _sign(fields, FAKE_BOT_TOKEN)
    assert (await _login(client, urlencode(fields))).status_code == 401


async def test_corrupt_user_json_returns_401(client: AsyncClient):
    fields = {"user": "{not-json", "auth_date": str(int(time.time()))}
    fields["hash"] = _sign(fields, FAKE_BOT_TOKEN)
    assert (await _login(client, urlencode(fields))).status_code == 401


async def test_user_without_id_returns_401(client: AsyncClient):
    fields = {
        "user": json.dumps({"first_name": "Ivan"}),
        "auth_date": str(int(time.time())),
    }
    fields["hash"] = _sign(fields, FAKE_BOT_TOKEN)
    assert (await _login(client, urlencode(fields))).status_code == 401


async def test_garbage_init_data_returns_401(client: AsyncClient):
    assert (await _login(client, "nu-este-un-query-string")).status_code == 401


async def test_missing_hash_returns_401(client: AsyncClient):
    fields = {
        "user": json.dumps({"id": 42}),
        "auth_date": str(int(time.time())),
    }
    assert (await _login(client, urlencode(fields))).status_code == 401


async def test_too_long_init_data_returns_422(client: AsyncClient):
    """Plafonul de lungime al schemei taie munca inutilă pe un endpoint public."""
    resp = await _login(client, "x=" + "a" * 5000)
    assert resp.status_code == 422


# --------------------------------------------------------------------------- #
# Anti-replay
# --------------------------------------------------------------------------- #


async def test_replay_of_same_init_data_returns_401(client: AsyncClient):
    """Același `initData` e valabil 24h și retrimis identic → se consumă o dată."""
    init_data = _build_init_data(telegram_id=606_000_111)

    first = await _login(client, init_data)
    assert first.status_code == 200, first.text

    second = await _login(client, init_data)
    assert second.status_code == 401


# --------------------------------------------------------------------------- #
# Contul din spate
# --------------------------------------------------------------------------- #


async def test_new_user_gets_telegram_user_id(client: AsyncClient, db_session):
    telegram_id = 777_000_222
    resp = await _login(client, _build_init_data(telegram_id=telegram_id))
    assert resp.status_code == 200, resp.text

    user = await db_session.scalar(
        select(User).where(User.telegram_user_id == telegram_id)
    )
    assert user is not None
    assert user.email == f"telegram_{telegram_id}@ext.flirt"
    assert user.telegram_linked_at is not None
    assert user.profile_completed is False


async def test_existing_user_is_reused_without_duplicate(
    client: AsyncClient, db_session
):
    """A doua intrare (alt initData, același cont Telegram) → ACELAȘI user."""
    telegram_id = 888_000_333

    first = await _login(client, _build_init_data(telegram_id=telegram_id))
    assert first.status_code == 200, first.text

    # initData NOU (alt `query_id` ⇒ alt hash), deci nu e un replay.
    second = await _login(
        client,
        _build_init_data(telegram_id=telegram_id, query_id="BBsecondOpening"),
    )
    assert second.status_code == 200, second.text

    total = await db_session.scalar(
        select(func.count()).select_from(User).where(
            User.telegram_user_id == telegram_id
        )
    )
    assert total == 1


async def test_two_telegram_users_get_separate_accounts(
    client: AsyncClient, db_session
):
    assert (await _login(client, _build_init_data(telegram_id=111_222_333))).status_code == 200
    assert (await _login(client, _build_init_data(telegram_id=444_555_666))).status_code == 200

    total = await db_session.scalar(select(func.count()).select_from(User))
    assert total == 2


async def test_token_from_telegram_login_opens_protected_route(
    client: AsyncClient,
):
    resp = await _login(client, _build_init_data(telegram_id=999_111_222))
    assert resp.status_code == 200, resp.text
    access = resp.json()["access_token"]

    me = await client.get(
        f"{BASE}/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert me.status_code == 200
    assert me.json()["email"] == "telegram_999111222@ext.flirt"
    assert me.json()["profile_completed"] is False


# --------------------------------------------------------------------------- #
# Modul stub (dev) și garda de producție
# --------------------------------------------------------------------------- #


async def test_stub_mode_accepts_test_init_data(client: AsyncClient, monkeypatch):
    """În 'stub' se acceptă un initData de test, ca la Google/Apple."""
    monkeypatch.setattr(settings, "telegram_auth_mode", "stub")
    resp = await _login(client, "stub:123456789:ivan")
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]


async def test_stub_mode_login_is_repeatable(
    client: AsyncClient, db_session, monkeypatch
):
    """Stub-ul nu are voie să fie blocat de anti-replay: dev-ul intră de N ori.

    Hash-ul unui initData de test e un nonce PROASPĂT la fiecare apel, tocmai ca
    a doua deschidere a Mini App-ului în dev să nu primească 401 timp de 24h
    (ca `test_google_stub_login_is_idempotent` pentru Google).
    """
    monkeypatch.setattr(settings, "telegram_auth_mode", "stub")
    assert (await _login(client, "stub:123456789:ivan")).status_code == 200
    assert (await _login(client, "stub:123456789:ivan")).status_code == 200

    total = await db_session.scalar(
        select(func.count()).select_from(User).where(
            User.telegram_user_id == 123456789
        )
    )
    assert total == 1


async def test_stub_mode_is_refused_in_production(client: AsyncClient, monkeypatch):
    """Plasă de siguranță: stub-ul NU autentifică pe nimeni în producție."""
    monkeypatch.setattr(settings, "telegram_auth_mode", "stub")
    monkeypatch.setattr(settings, "environment", "production")
    resp = await _login(client, "stub:123456789")
    assert resp.status_code == 503


async def test_production_guard_requires_keys_for_live_mode():
    """Prod + TELEGRAM_AUTH_MODE=live fără chei → eroare la PORNIRE."""
    with pytest.raises(ValidationError) as exc:
        Settings(**_prod_kwargs(telegram_auth_mode="live"))
    msg = str(exc.value)
    assert "TELEGRAM_BOT_TOKEN" in msg and "TELEGRAM_WEBHOOK_SECRET" in msg


async def test_production_guard_refuses_stub_with_configured_bot():
    """Prod + Mini App configurat, dar mod 'stub' = login fără verificare → refuzat."""
    with pytest.raises(ValidationError) as exc:
        Settings(**_prod_kwargs(telegram_bot_token="7654321:AAsecret"))
    assert "TELEGRAM_AUTH_MODE" in str(exc.value)


async def test_production_guard_allows_telegram_live_with_keys():
    """Prod + 'live' cu token și secret de webhook → pornire validă."""
    s = Settings(
        **_prod_kwargs(
            telegram_auth_mode="live",
            telegram_bot_token="7654321:AAsecret",
            telegram_webhook_secret="whsec_test",
        )
    )
    assert s.telegram_auth_mode == "live"
