"""Defecte de „ipoteză greșită" în limitarea de cereri și în anti-replay.

DOUĂ DEFECTE, AMÂNDOUĂ DIN ACEEAȘI FAMILIE cu cele găsite în producție: codul
avea dreptate în cazul pe care și-l imaginase și greșea în cazul real.

1. `client_ip` lua PRIMA intrare din `X-Forwarded-For`. Antetul e o listă pe
   care clientul o poate începe cu ce vrea (nginx doar APPEND-ează adresa reală,
   vezi `$proxy_add_x_forwarded_for` în `nginx/nginx.conf`), deci cheia de
   limitare era aleasă de cel limitat.

2. `claim_init_data` construia clientul Redis ÎN AFARA blocului `try`. O
   dependență opțională lipsă sau un `REDIS_URL` greșit nu degradau la protecția
   per proces, ci ridicau excepția până în rută: 500 la fiecare login Telegram.

Testele lovesc din AFARĂ (antete HTTP reale, rute reale), nu refolosesc
funcțiile pe care le verifică.
"""
from __future__ import annotations

import os
import time

import pytest
from httpx import AsyncClient
from starlette.requests import Request

from app.core import ratelimit
from app.core.config import settings
from app.services import telegram_auth

LOGIN = "/api/v1/auth/login"

# IP-ul pe care îl adaugă PROXY-UL nostru la capătul listei: adresa reală a
# conexiunii. E singura valoare din antet pe care clientul nu o poate scrie.
REAL_PEER = "203.0.113.7"


def _request(xff: str | None, *, peer: str | None = REAL_PEER) -> Request:
    """O cerere ASGI minimă, cu antetele și adresa de conexiune date."""
    headers: list[tuple[bytes, bytes]] = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "client": (peer, 51234) if peer else None,
        }
    )


# --------------------------------------------------------------------------- #
# 1. `X-Forwarded-For` — cine scrie fiecare intrare din listă
# --------------------------------------------------------------------------- #


def test_forged_prefix_does_not_change_the_client_ip():
    """Intrarea inventată de client e ignorată; rămâne cea pusă de proxy.

    Forma antetului ajuns la aplicație e exact cea produsă de
    `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`:
    „ce a trimis clientul, virgulă, IP-ul real".
    """
    assert ratelimit.client_ip(_request(f"9.9.9.9, {REAL_PEER}")) == REAL_PEER


def test_several_forged_entries_still_do_not_change_the_client_ip():
    """Un client poate trimite o listă întreagă; tot ultima intrare contează."""
    forged = "1.1.1.1, 2.2.2.2, 3.3.3.3"
    assert ratelimit.client_ip(_request(f"{forged}, {REAL_PEER}")) == REAL_PEER


def test_non_ip_text_in_the_forged_prefix_is_ignored():
    """Intrările inventate nu trebuie nici măcar să semene cu un IP."""
    assert ratelimit.client_ip(_request(f"not-an-ip, ;drop, {REAL_PEER}")) == REAL_PEER


def test_single_entry_header_is_the_client_ip():
    """Cazul obișnuit: clientul nu trimite nimic, nginx pune o singură adresă."""
    assert ratelimit.client_ip(_request(REAL_PEER)) == REAL_PEER


def test_trailing_separator_does_not_produce_an_empty_key():
    """`"1.2.3.4, "` nu are voie să devină cheia goală (un singur bucket global)."""
    assert ratelimit.client_ip(_request(f"{REAL_PEER}, ")) == REAL_PEER


def test_without_the_header_we_fall_back_to_the_connection():
    assert ratelimit.client_ip(_request(None)) == REAL_PEER


def test_without_header_and_without_peer_the_key_is_stable():
    assert ratelimit.client_ip(_request(None, peer=None)) == "anonymous"


def test_two_real_clients_behind_the_same_proxy_keep_separate_keys():
    """Reparația nu are voie să bage toți userii unui proxy în același bucket."""
    a = ratelimit.client_ip(_request("198.51.100.1"))
    b = ratelimit.client_ip(_request("198.51.100.2"))
    assert a != b


# --------------------------------------------------------------------------- #
# 1b. Același defect, lovit prin rută: plafonul chiar se atinge
# --------------------------------------------------------------------------- #


@pytest.fixture
def rate_limit_on():
    ratelimit.enable_for_tests()
    yield
    ratelimit.disable_for_tests()


async def _login_from(client: AsyncClient, xff: str):
    return await client.post(
        LOGIN,
        json={"email": "nimeni@exemplu.md", "password": "ParolaGresita1!"},
        headers={"X-Forwarded-For": xff},
    )


async def test_rotating_the_forged_prefix_cannot_dodge_the_login_limit(
    client: AsyncClient, rate_limit_on, monkeypatch
):
    """Scenariul de eșec, concret.

    Atacatorul trimite la fiecare încercare alt `X-Forwarded-For`. Antetul ajuns
    la aplicație e „<inventat>, 203.0.113.7" — adresa reală e aceeași de fiecare
    dată. Cu prima intrare drept cheie, fiecare cerere primea bucketul ei și
    plafonul de 2/minut nu se atingea NICIODATĂ: a treia încercare de parolă
    trecea la fel ca prima, la infinit.
    """
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 2)

    first = await _login_from(client, f"9.9.9.1, {REAL_PEER}")
    second = await _login_from(client, f"9.9.9.2, {REAL_PEER}")
    third = await _login_from(client, f"9.9.9.3, {REAL_PEER}")

    assert first.status_code == 401, first.text
    assert second.status_code == 401, second.text
    assert third.status_code == 429, third.text


async def test_a_different_real_client_is_not_punished_for_a_neighbour(
    client: AsyncClient, rate_limit_on, monkeypatch
):
    """Perechea testului de mai sus: limitarea rămâne PE CLIENT, nu globală."""
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 1)

    assert (await _login_from(client, "198.51.100.10")).status_code == 401
    assert (await _login_from(client, "198.51.100.10")).status_code == 429
    # Alt client, prima lui cerere: nu are de ce să fie respins.
    assert (await _login_from(client, "198.51.100.11")).status_code == 401


# --------------------------------------------------------------------------- #
# 2. Anti-replay: un Redis imposibil de construit degradează, nu doboară ruta
# --------------------------------------------------------------------------- #


def _claimable(hash_hex: str) -> telegram_auth.TelegramInitData:
    from datetime import datetime, timezone

    return telegram_auth.TelegramInitData(
        user=telegram_auth.TelegramUser(id=424_000_111),
        auth_date=datetime.now(timezone.utc),
        hash=hash_hex,
    )


@pytest.fixture
def redis_client_cannot_be_built(monkeypatch):
    """`REDIS_URL` setat, dar clientul nu se poate construi deloc.

    Situația reală: `redis` e o dependență OPȚIONALĂ (extras `[live]`), deci o
    imagine construită fără ea ridică `ImportError` exact aici — nu la pornire,
    ci la prima cerere care are nevoie de Redis.
    """

    def _boom(self):
        raise ImportError("No module named 'redis'")

    monkeypatch.setattr(ratelimit.settings, "redis_url", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(ratelimit.RedisRateLimiter, "_get_client", _boom)
    ratelimit.reset_backend()
    telegram_auth.reset_replay_state()
    yield
    ratelimit.reset_backend()
    telegram_auth.reset_replay_state()


async def test_unbuildable_redis_client_does_not_break_the_claim(
    redis_client_cannot_be_built,
):
    """Înainte: `ImportError` urca până în rută → 500 la FIECARE login Telegram."""
    await telegram_auth.claim_init_data(_claimable("a" * 64), ttl_seconds=60)


async def test_replay_is_still_refused_when_the_client_cannot_be_built(
    redis_client_cannot_be_built,
):
    """Degradarea slăbește protecția (per proces), nu o anulează."""
    data = _claimable("b" * 64)
    await telegram_auth.claim_init_data(data, ttl_seconds=60)
    with pytest.raises(telegram_auth.ReplayedInitData):
        await telegram_auth.claim_init_data(data, ttl_seconds=60)


async def test_telegram_login_route_degrades_instead_of_returning_500(
    client: AsyncClient, redis_client_cannot_be_built, monkeypatch
):
    """Prin rută: un Redis neconstruibil nu are voie să oprească intrarea.

    Scenariu: imagine fără extrasul `[live]`, `REDIS_URL` setat (obligatoriu în
    producție). Fiecare `POST /auth/telegram` întorcea 500 — adică Mini App-ul
    nu mai putea autentifica pe nimeni, deși semnătura era perfect verificabilă.
    """
    import hashlib
    import hmac
    import json
    from urllib.parse import urlencode

    bot_token = "7654321:AAFakeTestTokenForUnitTestsOnly-0000000"
    monkeypatch.setattr(settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(settings, "telegram_bot_token", bot_token)
    monkeypatch.setattr(settings, "telegram_init_data_max_age_seconds", 86_400)

    fields = {
        "user": json.dumps({"id": 424_000_222, "first_name": "Ivan"}, separators=(",", ":")),
        "auth_date": str(int(time.time())),
        "query_id": "AAredisLipsa",
    }
    dcs = "\n".join(f"{k}={fields[k]}" for k in sorted(fields))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()

    resp = await client.post(
        "/api/v1/auth/telegram", json={"init_data": urlencode(fields)}
    )
    assert resp.status_code == 200, resp.text


# --------------------------------------------------------------------------- #
# 3. Scurtătura pentru teste nu are voie să existe în producție
# --------------------------------------------------------------------------- #


async def test_an_env_var_cannot_switch_off_rate_limiting_in_production(
    client: AsyncClient, monkeypatch
):
    """`PYTEST_CURRENT_TEST` nu mai oprește limitarea când `ENVIRONMENT=production`.

    Scenariu concret: `.env` al containerului e copiat dintr-un job de CI și
    păstrează `PYTEST_CURRENT_TEST`. `_active()` întorcea False, deci NICIUN
    endpoint nu mai era limitat — nici `/auth/login`, nici `/admin/login` — fără
    nicio linie de log care să spună asta. Singurul semn ar fi fost un atac
    reușit.

    Testul NU cheamă `enable_for_tests()`: tocmai ăsta e miezul. Suntem sub
    pytest (deci variabila CHIAR există), iar limitarea trebuie totuși să
    funcționeze fiindcă mediul se declară „production".
    """
    monkeypatch.setattr(ratelimit.settings, "environment", "production")
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 1)
    ratelimit.limiter.reset()
    ratelimit.reset_backend()
    try:
        assert os.environ.get("PYTEST_CURRENT_TEST"), "premisa testului"
        assert (await _login_from(client, "203.0.113.90")).status_code == 401
        assert (await _login_from(client, "203.0.113.90")).status_code == 429
    finally:
        ratelimit.limiter.reset()
        ratelimit.reset_backend()


async def test_outside_production_the_test_shortcut_still_works(
    client: AsyncClient, monkeypatch
):
    """Perechea: în dev/staging suita existentă nu are voie să fie throttled.

    Fără acest test, o „întărire" care ignoră complet `PYTEST_CURRENT_TEST` ar
    face zeci de teste de auth să primească 429 unele de la altele.
    """
    monkeypatch.setattr(ratelimit.settings, "environment", "staging")
    monkeypatch.setattr(ratelimit.settings, "rate_limit_login_per_min", 1)
    ratelimit.limiter.reset()
    try:
        assert (await _login_from(client, "203.0.113.91")).status_code == 401
        assert (await _login_from(client, "203.0.113.91")).status_code == 401
    finally:
        ratelimit.limiter.reset()
