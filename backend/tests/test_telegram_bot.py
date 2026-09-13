"""Teste pentru botul Telegram: webhookul și clientul Bot API.

Toate apelurile HTTP sunt MOCK-uite (monkeypatch pe `httpx.AsyncClient.post`,
ca în `test_push_billing_live`), deci NU se atinge rețeaua și nu e nevoie de un
token real. Interceptăm doar cererile către `api.telegram.org`; cererile
clientului de test către aplicație (ASGI) trec neatinse către implementarea
originală.
"""
import logging

import httpx
import pytest

from app.api.v1 import telegram as telegram_api
from app.services import telegram_bot

API = "/api/v1"
WEBHOOK = f"{API}/telegram/webhook"

# Token FALS, cu forma reală (`<id>:<secret>`), folosit ca să verificăm că nu
# scapă în loguri. Nu e un token valid și nu ajunge niciodată pe rețea.
BOT_TOKEN = "1234567890:AAH-fals-pentru-teste-nu-e-real"
WEBHOOK_SECRET = "secret-de-webhook-pentru-teste"
MINIAPP_URL = "https://miniapp.flrt.md/tg"


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
            raise httpx.HTTPStatusError(
                "error", request=None, response=None  # type: ignore[arg-type]
            )


def _update(text: str, chat_id: int = 555, update_id: int = 1) -> dict:
    """Un update Telegram minimal, de tip mesaj text."""
    return {
        "update_id": update_id,
        "message": {
            "message_id": 10,
            "chat": {"id": chat_id, "type": "private"},
            "from": {"id": chat_id, "is_bot": False, "first_name": "Ion"},
            "text": text,
        },
    }


def _button(call: dict) -> dict:
    """Extrage butonul inline din payload-ul unui `sendMessage` capturat."""
    markup = call["json"]["reply_markup"]
    return markup["inline_keyboard"][0][0]


@pytest.fixture
def live_bot(monkeypatch):
    """Comută botul pe 'live' cu token/secret/URL false (fără rețea reală)."""
    monkeypatch.setattr(telegram_bot.settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_token", BOT_TOKEN)
    monkeypatch.setattr(telegram_bot.settings, "telegram_webhook_secret", WEBHOOK_SECRET)
    monkeypatch.setattr(telegram_bot.settings, "telegram_miniapp_url", MINIAPP_URL)


@pytest.fixture
def telegram_calls(monkeypatch):
    """Interceptează DOAR cererile către api.telegram.org; restul trec normal.

    Clientul de test folosește tot `httpx.AsyncClient.post` ca să lovească
    aplicația prin ASGI — dacă am înlocui metoda complet, testele n-ar mai putea
    face nicio cerere.
    """
    calls: list[dict] = []
    original_post = httpx.AsyncClient.post

    async def fake_post(self, url, **kwargs):
        if isinstance(url, str) and url.startswith(telegram_bot.TELEGRAM_API_BASE):
            calls.append({"url": url, "json": kwargs.get("json")})
            return _FakeResponse({"ok": True, "result": {"message_id": 11}})
        return await original_post(self, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls


# --- Autorizarea webhookului --------------------------------------------------
@pytest.mark.asyncio
async def test_webhook_fara_antet_de_secret_este_respins(client, live_bot, telegram_calls):
    """Fără `X-Telegram-Bot-Api-Secret-Token` → 403, fără procesare."""
    resp = await client.post(WEBHOOK, json=_update("/start"))
    assert resp.status_code == 403, resp.text
    assert telegram_calls == [], "Un update neautorizat nu are voie să fie procesat."


@pytest.mark.asyncio
async def test_webhook_cu_secret_gresit_este_respins(client, live_bot, telegram_calls):
    """Secret greșit → 403 sec, fără detalii despre motiv."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start"),
        headers={telegram_api.SECRET_HEADER: "nu-e-secretul-bun"},
    )
    assert resp.status_code == 403, resp.text
    # Răspunsul nu trebuie să spună CE anume a fost greșit.
    assert "secret" not in resp.text.lower()
    assert telegram_calls == []


@pytest.mark.asyncio
async def test_webhook_live_fara_secret_configurat_respinge_tot(
    client, live_bot, telegram_calls, monkeypatch
):
    """Mod 'live' fără secret în config → ruta e închisă complet (403)."""
    monkeypatch.setattr(telegram_bot.settings, "telegram_webhook_secret", "")
    resp = await client.post(WEBHOOK, json=_update("/start"))
    assert resp.status_code == 403, resp.text
    assert telegram_calls == []


# --- /start și butonul web_app ------------------------------------------------
@pytest.mark.asyncio
async def test_start_raspunde_cu_buton_web_app(client, live_bot, telegram_calls):
    """Secret corect + `/start` → 200 și un `sendMessage` cu buton `web_app`."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}

    assert len(telegram_calls) == 1, telegram_calls
    call = telegram_calls[0]
    assert call["url"].endswith("/sendMessage")
    assert call["json"]["chat_id"] == 555

    button = _button(call)
    assert "web_app" in button, "Butonul trebuie să fie de tip web_app."
    assert button["web_app"]["url"] == MINIAPP_URL
    assert button["text"] == telegram_api.BUTTON_TEXT
    # Mesajul de bun venit e în română.
    assert "bine ai venit" in call["json"]["text"].lower()


@pytest.mark.asyncio
async def test_deep_link_ajunge_in_url_ul_butonului(client, live_bot, telegram_calls):
    """`/start promo-2026` → parametrul apare ca query param în URL-ul butonului."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start promo-2026"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text

    url = _button(telegram_calls[0])["web_app"]["url"]
    assert url.startswith(MINIAPP_URL)
    assert f"{telegram_bot.START_PARAM_QUERY}=promo-2026" in url


@pytest.mark.asyncio
async def test_parametru_de_start_invalid_este_ignorat(client, live_bot, telegram_calls):
    """Un parametru cu caractere nepermise NU ajunge în URL (injecție de query)."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start ../../evil?x=1&y=2"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text

    url = _button(telegram_calls[0])["web_app"]["url"]
    assert url == MINIAPP_URL
    assert "evil" not in url


@pytest.mark.asyncio
async def test_start_cu_username_de_bot(client, live_bot, telegram_calls):
    """Forma `/start@numebot` (din grupuri) e recunoscută tot ca /start."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start@flirt_bot"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text
    assert "bine ai venit" in telegram_calls[0]["json"]["text"].lower()


# --- Mesaje oarecare & update-uri necunoscute ---------------------------------
@pytest.mark.asyncio
async def test_mesaj_oarecare_primeste_raspuns_scurt_cu_buton(
    client, live_bot, telegram_calls
):
    """Orice alt text → un răspuns scurt care reamintește cum se deschide app-ul."""
    resp = await client.post(
        WEBHOOK,
        json=_update("salut, cine ești?"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text

    call = telegram_calls[0]
    assert call["json"]["text"] == telegram_api.FALLBACK_TEXT
    assert "/start" in call["json"]["text"]
    assert "web_app" in _button(call)


@pytest.mark.asyncio
async def test_update_necunoscut_este_confirmat_cu_200(
    client, live_bot, telegram_calls, caplog
):
    """Un update fără mesaj (ex. `callback_query`) → 200, logat, fără trimitere."""
    unknown = {"update_id": 7, "callback_query": {"id": "abc", "data": "x"}}
    with caplog.at_level(logging.INFO):
        resp = await client.post(
            WEBHOOK,
            json=unknown,
            headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
        )
    assert resp.status_code == 200, resp.text
    assert telegram_calls == []
    assert "callback_query" in caplog.text


@pytest.mark.asyncio
async def test_corp_invalid_nu_provoaca_reincercari(client, live_bot, telegram_calls):
    """JSON invalid → tot 200 (altfel Telegram reîncearcă la nesfârșit)."""
    resp = await client.post(
        WEBHOOK,
        content=b"nu-e-json",
        headers={
            telegram_api.SECRET_HEADER: WEBHOOK_SECRET,
            "Content-Type": "application/json",
        },
    )
    assert resp.status_code == 200, resp.text
    assert telegram_calls == []


@pytest.mark.asyncio
async def test_eroare_la_trimitere_nu_doboara_webhookul(
    client, live_bot, monkeypatch, caplog
):
    """Dacă `sendMessage` eșuează, webhookul întoarce totuși 200."""
    original_post = httpx.AsyncClient.post

    async def failing_post(self, url, **kwargs):
        if isinstance(url, str) and url.startswith(telegram_bot.TELEGRAM_API_BASE):
            raise httpx.ConnectError(f"connect failed: {url}")
        return await original_post(self, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", failing_post)

    with caplog.at_level(logging.WARNING):
        resp = await client.post(
            WEBHOOK,
            json=_update("/start"),
            headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
        )
    assert resp.status_code == 200, resp.text
    assert BOT_TOKEN not in caplog.text


# --- Modul stub ---------------------------------------------------------------
@pytest.mark.asyncio
async def test_modul_stub_nu_atinge_reteaua(monkeypatch, telegram_calls, caplog):
    """În 'stub' nu se face niciun apel HTTP, dar se întoarce un răspuns fals."""
    monkeypatch.setattr(telegram_bot.settings, "telegram_auth_mode", "stub")
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_token", BOT_TOKEN)
    monkeypatch.setattr(telegram_bot.settings, "telegram_miniapp_url", MINIAPP_URL)

    with caplog.at_level(logging.INFO):
        result = await telegram_bot.send_message(
            42, "salut", telegram_bot.web_app_keyboard("Deschide")
        )

    assert result["ok"] is True
    assert result["stub"] is True
    assert result["method"] == "sendMessage"
    assert telegram_calls == [], "Modul stub nu are voie să atingă rețeaua."
    assert BOT_TOKEN not in caplog.text


@pytest.mark.asyncio
async def test_live_fara_token_degradeaza_in_stub(monkeypatch, telegram_calls):
    """Mod 'live' fără token → stub (nu trimitem cereri sortite eșecului)."""
    monkeypatch.setattr(telegram_bot.settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_token", "")

    result = await telegram_bot.send_message(42, "salut")
    assert result.get("stub") is True
    assert telegram_calls == []


# --- Clientul Bot API: setWebhook / setChatMenuButton -------------------------
@pytest.mark.asyncio
async def test_set_webhook_si_menu_button_trimit_payload_corect(
    live_bot, telegram_calls
):
    """`setWebhook` trimite url+secret_token; `setChatMenuButton` un buton web_app."""
    await telegram_bot.set_webhook("https://api.flrt.md/api/v1/telegram/webhook", "s3cr3t")
    await telegram_bot.set_chat_menu_button(MINIAPP_URL, "Deschide FLIRT")
    await telegram_bot.delete_webhook()

    methods = [c["url"].rsplit("/", 1)[-1] for c in telegram_calls]
    assert methods == ["setWebhook", "setChatMenuButton", "deleteWebhook"]

    assert telegram_calls[0]["json"] == {
        "url": "https://api.flrt.md/api/v1/telegram/webhook",
        "secret_token": "s3cr3t",
    }
    menu = telegram_calls[1]["json"]["menu_button"]
    assert menu["type"] == "web_app"
    assert menu["web_app"]["url"] == MINIAPP_URL


# --- Tokenul nu apare NICIODATĂ în loguri sau erori ---------------------------
@pytest.mark.asyncio
async def test_tokenul_nu_apare_in_loguri_sau_erori(live_bot, monkeypatch, caplog):
    """Eroarea httpx conține URL-ul (deci tokenul) — trebuie redactat peste tot."""
    async def exploding_post(self, url, **kwargs):
        # Mesajul imită httpx: include URL-ul complet, adică și tokenul.
        raise httpx.ConnectError(f"All connection attempts failed for {url}")

    monkeypatch.setattr(httpx.AsyncClient, "post", exploding_post)

    with caplog.at_level(logging.DEBUG):
        result = await telegram_bot.send_message(42, "salut")

    assert result["ok"] is False
    # Nici în valoarea întoarsă...
    assert BOT_TOKEN not in result["error"]
    assert telegram_bot._REDACTED in result["error"]
    # ...nici în niciun mesaj de log.
    assert BOT_TOKEN not in caplog.text
    # Nici măcar partea secretă a tokenului (după `:`).
    assert BOT_TOKEN.split(":", 1)[1] not in caplog.text


def test_redact_scoate_tokenul_din_orice_text(live_bot):
    """`_redact` curăță tokenul indiferent de forma textului."""
    raw = f"POST https://api.telegram.org/bot{BOT_TOKEN}/sendMessage a eșuat"
    cleaned = telegram_bot._redact(raw)
    assert BOT_TOKEN not in cleaned
    assert telegram_bot._REDACTED in cleaned


def test_url_ul_bot_api_contine_tokenul_dar_nu_se_loghează(live_bot):
    """`_api_url` chiar conține tokenul — de aceea NU are voie să ajungă în log."""
    url = telegram_bot._api_url("sendMessage")
    assert url == f"{telegram_bot.TELEGRAM_API_BASE}/bot{BOT_TOKEN}/sendMessage"
    assert BOT_TOKEN not in telegram_bot._redact(url)


# --- Secretul de webhook nu apare NICIODATĂ în loguri --------------------------
#
# `_call` loghează, în modul stub, ÎNTREG payload-ul cererii
# (`logger.info("STUB telegram -> %s payload=%r", ...)`). Payload-ul metodei
# `setWebhook` conține `secret_token` — exact secretul care AUTENTIFICĂ
# webhookul (antetul `X-Telegram-Bot-Api-Secret-Token`, verificat în
# `api/v1/telegram.py`). Redactarea acoperea doar tokenul botului.
#
# SCENARIUL DE EȘEC: `scripts/setup_telegram_bot.py` se rulează pe server ca să
# înregistreze webhookul; dacă modul e stub (sau devine stub pentru că tokenul
# lipsește din mediu), secretul ajunge în clar pe stdout → în jurnalul
# containerului → în orice colector de log-uri. Cine citește log-urile poate
# POST-a apoi update-uri Telegram FALSE pe ruta noastră de webhook: mesaje
# fabricate, „utilizatori" fabricați, în numele botului. Un secret ajuns în
# log-uri nu mai e secret, iar log-urile se păstrează mult mai mult decât ne
# amintim noi.


@pytest.mark.asyncio
async def test_secretul_de_webhook_nu_apare_in_log_in_modul_stub(
    monkeypatch, telegram_calls, caplog
):
    """Modul stub loghează payload-ul → `secret_token` trebuie redactat."""
    monkeypatch.setattr(telegram_bot.settings, "telegram_auth_mode", "stub")
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_token", BOT_TOKEN)
    monkeypatch.setattr(telegram_bot.settings, "telegram_webhook_secret", WEBHOOK_SECRET)

    with caplog.at_level(logging.DEBUG):
        result = await telegram_bot.set_webhook(
            "https://api.flrt.md/api/v1/telegram/webhook", WEBHOOK_SECRET
        )

    assert telegram_calls == []
    assert result["ok"] is True
    # Nici în log-uri...
    assert WEBHOOK_SECRET not in caplog.text
    assert telegram_bot._REDACTED in caplog.text
    # ...nici în valoarea întoarsă (apelantul o poate tipări/loga mai departe:
    # vezi `scripts/setup_telegram_bot.py`).
    assert WEBHOOK_SECRET not in repr(result)


@pytest.mark.asyncio
async def test_secretul_dat_ca_argument_este_redactat_chiar_daca_difera_de_setari(
    monkeypatch, telegram_calls, caplog
):
    """Redactarea nu se poate baza DOAR pe valoarea din `settings`.

    `set_webhook(url, secret)` primește secretul ca ARGUMENT; poate fi altul
    decât cel din configurație (rotire de secret, rulare cu `--secret` etc.).
    Redactăm după CHEIA din payload, nu doar după valoarea cunoscută.
    """
    monkeypatch.setattr(telegram_bot.settings, "telegram_auth_mode", "stub")
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_token", BOT_TOKEN)
    monkeypatch.setattr(telegram_bot.settings, "telegram_webhook_secret", "alt-secret")

    rotit = "secret-NOU-abia-rotit-987"
    with caplog.at_level(logging.DEBUG):
        await telegram_bot.set_webhook("https://api.flrt.md/hook", rotit)

    assert rotit not in caplog.text


@pytest.mark.asyncio
async def test_secretul_de_webhook_nu_apare_in_eroarea_unui_apel_live(
    live_bot, monkeypatch, caplog
):
    """Un mesaj de eroare care conține payload-ul nu are voie să scurgă secretul."""
    async def exploding_post(self, url, **kwargs):
        # Unele erori httpx/servere de proxy includ corpul cererii în mesaj.
        raise httpx.ConnectError(f"failed POST {url} body={kwargs.get('json')!r}")

    monkeypatch.setattr(httpx.AsyncClient, "post", exploding_post)

    with caplog.at_level(logging.DEBUG):
        result = await telegram_bot.set_webhook("https://api.flrt.md/hook", WEBHOOK_SECRET)

    assert result["ok"] is False
    assert WEBHOOK_SECRET not in result["error"]
    assert WEBHOOK_SECRET not in caplog.text
    assert BOT_TOKEN not in caplog.text


def test_redact_scoate_si_secretul_de_webhook(live_bot):
    """`_redact` curăță ȘI secretul de webhook, nu doar tokenul botului."""
    raw = f"setWebhook payload={{'secret_token': '{WEBHOOK_SECRET}'}} token={BOT_TOKEN}"
    cleaned = telegram_bot._redact(raw)
    assert WEBHOOK_SECRET not in cleaned
    assert BOT_TOKEN not in cleaned
    assert telegram_bot._REDACTED in cleaned


def test_redactarea_nu_strica_restul_payload_ului():
    """Redactăm secretele, nu tot: restul payload-ului rămâne util în log."""
    payload = {
        "url": "https://api.flrt.md/api/v1/telegram/webhook",
        "secret_token": "s3cr3t-de-webhook",
        "menu_button": {"type": "web_app", "text": "Deschide"},
    }
    masked = telegram_bot._redact_payload(payload)

    assert masked["url"] == payload["url"]
    assert masked["menu_button"] == payload["menu_button"]
    assert masked["secret_token"] == telegram_bot._REDACTED
    # Originalul NU e modificat: payload-ul chiar se trimite la Telegram.
    assert payload["secret_token"] == "s3cr3t-de-webhook"
