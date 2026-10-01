"""Teste pentru botul Telegram: webhookul și clientul Bot API.

Toate apelurile HTTP sunt MOCK-uite (monkeypatch pe `httpx.AsyncClient.post`,
ca în `test_push_billing_live`), deci NU se atinge rețeaua și nu e nevoie de un
token real. Interceptăm doar cererile către `api.telegram.org`; cererile
clientului de test către aplicație (ASGI) trec neatinse către implementarea
originală.
"""
import json
import logging

import httpx
import pytest

from app.api.v1 import telegram as telegram_api
from app.services import bot_texts, telegram_bot

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


def _markup(call: dict) -> dict:
    """Tastatura inline dintr-un apel capturat (JSON sau multipart)."""
    if call.get("json") is not None:
        return call["json"]["reply_markup"]
    return json.loads(call["data"]["reply_markup"])


def _button(call: dict) -> dict:
    """Primul buton inline (cel care deschide Mini App-ul)."""
    return _markup(call)["inline_keyboard"][0][0]


def _text(call: dict) -> str:
    """Textul unui `sendMessage` sau legenda unui `sendPhoto`."""
    body = call.get("json") if call.get("json") is not None else call["data"]
    return body.get("text") or body.get("caption") or ""


def _method(call: dict) -> str:
    return call["url"].rsplit("/", 1)[-1]


# Răspunsul Bot API la un `sendPhoto` reușit: variantele pozei, cea mai mare ultima.
PHOTO_RESULT = {
    "ok": True,
    "result": {
        "message_id": 12,
        "photo": [{"file_id": "small-id"}, {"file_id": "WELCOME-FILE-ID"}],
    },
}


@pytest.fixture(autouse=True)
def _cache_file_id_curat(monkeypatch):
    """Fiecare test pornește fără `file_id` memorat și fără Redis."""
    telegram_bot._file_id_cache.clear()

    async def no_redis():
        return None

    monkeypatch.setattr(telegram_bot, "_get_redis", no_redis)
    yield
    telegram_bot._file_id_cache.clear()


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
            calls.append({
                "url": url,
                "json": kwargs.get("json"),
                "data": kwargs.get("data"),
                "files": kwargs.get("files"),
            })
            if url.endswith("/sendPhoto"):
                return _FakeResponse(PHOTO_RESULT)
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
    """Secret corect + `/start` → 200 și o POZĂ (încărcată) cu buton `web_app`."""
    resp = await client.post(
        WEBHOOK,
        json=_update("/start"),
        headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True}

    assert len(telegram_calls) == 1, telegram_calls
    call = telegram_calls[0]
    assert _method(call) == "sendPhoto"
    # Prima trimitere încarcă fișierul (multipart), nu un JSON.
    assert call["json"] is None
    assert call["data"]["chat_id"] == "555"
    assert call["data"]["parse_mode"] == "HTML"
    name, content, mime = call["files"]["photo"]
    assert name == "welcome.png" and mime == "image/png"
    assert content == telegram_bot.WELCOME_IMAGE.read_bytes()

    button = _button(call)
    assert "web_app" in button, "Butonul trebuie să fie de tip web_app."
    assert button["web_app"]["url"] == MINIAPP_URL
    assert button["text"] == bot_texts.button("ro", "open")
    # Mesajul de bun venit e în română.
    assert "bine ai venit" in _text(call).lower()


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
    assert "bine ai venit" in _text(telegram_calls[0]).lower()


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
    assert call["json"]["text"] == bot_texts.fallback_text("ro")
    assert "/help" in call["json"]["text"]
    assert "web_app" in _button(call)


@pytest.mark.asyncio
async def test_update_necunoscut_este_confirmat_cu_200(
    client, live_bot, telegram_calls, caplog
):
    """Un update fără mesaj (ex. `my_chat_member`) → 200, logat, fără trimitere."""
    unknown = {"update_id": 7, "my_chat_member": {"chat": {"id": 1}}}
    with caplog.at_level(logging.INFO):
        resp = await client.post(
            WEBHOOK,
            json=unknown,
            headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET},
        )
    assert resp.status_code == 200, resp.text
    assert telegram_calls == []
    assert "my_chat_member" in caplog.text


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
        # Explicit: altfel Telegram păstrează lista veche (poate fără callback_query).
        "allowed_updates": ["message", "callback_query"],
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


# =========================================================================== #
# Bun venit cu poză, comenzi, butoane callback, profilul botului
# =========================================================================== #
import importlib.util  # noqa: E402
from pathlib import Path  # noqa: E402


def _update_from(text: str, language_code: str | None = None, first_name: str = "Ion",
                 chat_id: int = 555) -> dict:
    update = _update(text, chat_id=chat_id)
    update["message"]["from"]["first_name"] = first_name
    if language_code:
        update["message"]["from"]["language_code"] = language_code
    return update


def _callback_update(data: str, language_code: str = "ro", chat_id: int = 555) -> dict:
    return {
        "update_id": 99,
        "callback_query": {
            "id": "cbq-1",
            "from": {"id": chat_id, "is_bot": False, "first_name": "Ion",
                     "language_code": language_code},
            "message": {"message_id": 10, "chat": {"id": chat_id, "type": "private"}},
            "data": data,
        },
    }


async def _post(client, update: dict):
    resp = await client.post(
        WEBHOOK, json=update, headers={telegram_api.SECRET_HEADER: WEBHOOK_SECRET}
    )
    assert resp.status_code == 200, resp.text
    return resp


def _all_buttons(call: dict) -> list[dict]:
    return [b for row in _markup(call)["inline_keyboard"] for b in row]


class _StatusResponse(_FakeResponse):
    """Răspuns non-2xx cu corp JSON, ca Bot API (`raise_for_status` real)."""

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "error", request=None, response=self  # type: ignore[arg-type]
            )


@pytest.fixture
def scripted_calls(monkeypatch):
    """Ca `telegram_calls`, dar răspunsul fiecărei metode se poate programa."""
    calls: list[dict] = []
    responses: dict[str, object] = {}
    original_post = httpx.AsyncClient.post

    async def fake_post(self, url, **kwargs):
        if isinstance(url, str) and url.startswith(telegram_bot.TELEGRAM_API_BASE):
            call = {"url": url, "json": kwargs.get("json"), "data": kwargs.get("data"),
                    "files": kwargs.get("files")}
            calls.append(call)
            method = url.rsplit("/", 1)[-1]
            handler = responses.get(method)
            if callable(handler):
                return handler(call)
            if handler is not None:
                return handler
            if method == "sendPhoto":
                return _FakeResponse(PHOTO_RESULT)
            return _FakeResponse({"ok": True, "result": {"message_id": 11}})
        return await original_post(self, url, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    return calls, responses


# --- Limba ---------------------------------------------------------------------
@pytest.mark.parametrize(
    ("code", "lang"),
    [(None, "ro"), ("", "ro"), ("ro", "ro"), ("ru", "ru"), ("uk", "ru"), ("be", "ru"),
     ("en", "en"), ("en-US", "en"), ("de", "ro"), ("fr", "ro")],
)
def test_limba_dupa_language_code(code, lang):
    assert bot_texts.lang_for(code) == lang


# --- /start: poză, meniu, localizare ------------------------------------------
@pytest.mark.asyncio
async def test_start_ru_are_legenda_in_rusa_si_meniul_complet(client, live_bot, telegram_calls):
    await _post(client, _update_from("/start", "ru"))

    call = telegram_calls[0]
    assert _method(call) == "sendPhoto"
    assert "Добро пожаловать" in _text(call)

    rows = _markup(call)["inline_keyboard"]
    assert rows[0][0]["text"] == bot_texts.button("ru", "open")
    assert rows[0][0]["web_app"]["url"] == MINIAPP_URL
    events, tickets = rows[1]
    assert events["text"] == bot_texts.button("ru", "events")
    assert events["web_app"]["url"] == f"{MINIAPP_URL}?startapp=events"
    assert tickets["web_app"]["url"] == f"{MINIAPP_URL}?startapp=tickets"
    help_btn, contacts_btn = rows[2]
    assert help_btn["callback_data"] == "help"
    assert contacts_btn["callback_data"] == "contacts"


@pytest.mark.asyncio
async def test_start_en_si_numele_e_escapat_html(client, live_bot, telegram_calls):
    await _post(client, _update_from("/start", "en", first_name="<b>Ion</b> & co"))
    caption = _text(telegram_calls[0])
    assert "Welcome to <b>FLIRT</b>" in caption
    assert "&lt;b&gt;Ion&lt;/b&gt; &amp; co" in caption
    assert "<b>Ion</b>" not in caption


def test_legenda_incape_in_limita_telegram():
    for lang in bot_texts.LANGS:
        assert len(bot_texts.welcome(lang, "X" * 200)) <= 1024


@pytest.mark.asyncio
async def test_a_doua_oara_poza_pleaca_dupa_file_id(client, live_bot, telegram_calls):
    """Prima trimitere încarcă fișierul; a doua refolosește `file_id` (JSON)."""
    await _post(client, _update_from("/start"))
    await _post(client, _update_from("/start"))

    first, second = telegram_calls
    assert first["files"] is not None
    assert _method(second) == "sendPhoto"
    assert second["files"] is None
    assert second["json"]["photo"] == "WELCOME-FILE-ID"
    assert second["json"]["parse_mode"] == "HTML"
    assert "bine ai venit" in second["json"]["caption"].lower()


@pytest.mark.asyncio
async def test_file_id_respins_se_uita_si_poza_se_reincarca(client, live_bot, scripted_calls):
    calls, responses = scripted_calls
    key = telegram_bot.file_id_cache_key(telegram_bot.WELCOME_IMAGE)
    telegram_bot._file_id_cache[key] = "STALE-ID"

    def send_photo(call):
        if call["json"] is not None:  # trimitere după file_id → respinsă
            return _StatusResponse(
                {"ok": False, "error_code": 400, "description": "Bad Request: wrong file_id"},
                status_code=400,
            )
        return _FakeResponse(PHOTO_RESULT)

    responses["sendPhoto"] = send_photo
    await _post(client, _update_from("/start"))

    assert [_method(c) for c in calls] == ["sendPhoto", "sendPhoto"]
    assert calls[0]["json"]["photo"] == "STALE-ID"
    assert calls[1]["files"] is not None
    assert telegram_bot._file_id_cache[key] == "WELCOME-FILE-ID"


@pytest.mark.asyncio
async def test_poza_esuata_cade_pe_mesaj_text(client, live_bot, scripted_calls):
    calls, responses = scripted_calls
    responses["sendPhoto"] = _StatusResponse(
        {"ok": False, "error_code": 400, "description": "Bad Request: IMAGE_PROCESS_FAILED"},
        status_code=400,
    )
    await _post(client, _update_from("/start promo-1"))

    assert [_method(c) for c in calls] == ["sendPhoto", "sendMessage"]
    fallback = calls[1]["json"]
    assert fallback["parse_mode"] == "HTML"
    assert "bine ai venit" in fallback["text"].lower()
    # Meniul și deep linkul se păstrează și pe varianta text.
    assert "startapp=promo-1" in _button(calls[1])["web_app"]["url"]
    assert telegram_bot._file_id_cache == {}


@pytest.mark.asyncio
async def test_file_id_se_memoreaza_si_in_redis(client, live_bot, telegram_calls, monkeypatch):
    store: dict[str, str] = {}

    class FakeRedis:
        async def get(self, key):
            return store.get(key)

        async def set(self, key, value, ex=None):
            assert ex == telegram_bot.FILE_ID_CACHE_TTL_SECONDS
            store[key] = value

        async def delete(self, key):
            store.pop(key, None)

        async def aclose(self):
            pass

    async def fake_redis():
        return FakeRedis()

    monkeypatch.setattr(telegram_bot, "_get_redis", fake_redis)

    await _post(client, _update_from("/start"))
    key = telegram_bot.file_id_cache_key(telegram_bot.WELCOME_IMAGE)
    assert store == {key: "WELCOME-FILE-ID"}
    assert key.startswith("telegram:file_id:1234567890:welcome:")
    assert BOT_TOKEN.split(":", 1)[1] not in key

    # Alt proces (memorie goală) găsește file_id în Redis → fără reîncărcare.
    telegram_bot._file_id_cache.clear()
    await _post(client, _update_from("/start"))
    assert telegram_calls[1]["json"]["photo"] == "WELCOME-FILE-ID"


@pytest.mark.asyncio
async def test_redis_cazut_nu_strica_bun_venitul(client, live_bot, telegram_calls, monkeypatch):
    async def broken_redis():
        raise ConnectionError("redis down")

    monkeypatch.setattr(telegram_bot, "_get_redis", broken_redis)
    await _post(client, _update_from("/start"))
    assert _method(telegram_calls[0]) == "sendPhoto"


@pytest.mark.asyncio
async def test_start_fara_miniapp_url_trimite_doar_butoane_callback(
    client, live_bot, telegram_calls, monkeypatch
):
    monkeypatch.setattr(telegram_bot.settings, "telegram_miniapp_url", "")
    await _post(client, _update_from("/start"))
    buttons = _all_buttons(telegram_calls[0])
    assert buttons and all("web_app" not in b for b in buttons)
    assert {b["callback_data"] for b in buttons} == {"help", "contacts"}


# --- Comenzi -------------------------------------------------------------------
@pytest.mark.asyncio
async def test_help_explica_biletele_si_listeaza_comenzile(client, live_bot, telegram_calls):
    await _post(client, _update_from("/help"))
    call = telegram_calls[0]
    assert _method(call) == "sendMessage"
    body = call["json"]
    assert body["parse_mode"] == "HTML"
    assert body["link_preview_options"] == {"is_disabled": True}
    for command, _ in bot_texts.COMMANDS["ro"]:
        assert f"/{command}" in body["text"]
    assert "MIA" in body["text"]
    assert "web_app" in _button(call)
    callbacks = {b.get("callback_data") for b in _all_buttons(call)}
    assert {"contacts", "privacy"} <= callbacks


@pytest.mark.asyncio
async def test_help_in_engleza(client, live_bot, telegram_calls):
    await _post(client, _update_from("/help", "en"))
    assert "How to buy a ticket" in telegram_calls[0]["json"]["text"]


@pytest.mark.asyncio
async def test_contacts_cu_email_telegram_si_site(client, live_bot, telegram_calls, monkeypatch):
    monkeypatch.setattr(telegram_bot.settings, "legal_contact_email", "help@flrt.md")
    monkeypatch.setattr(telegram_bot.settings, "support_telegram_username", "@flirt_support")
    monkeypatch.setattr(telegram_bot.settings, "public_website_url", "https://flrt.md/")

    await _post(client, _update_from("/contacts"))
    call = telegram_calls[0]
    text = call["json"]["text"]
    assert '<a href="mailto:help@flrt.md">help@flrt.md</a>' in text
    assert '<a href="https://t.me/flirt_support">@flirt_support</a>' in text
    assert '<a href="https://flrt.md">flrt.md</a>' in text
    urls = [b.get("url") for b in _all_buttons(call)]
    assert "https://t.me/flirt_support" in urls
    assert "https://flrt.md" in urls


@pytest.mark.asyncio
async def test_contacts_implicit_doar_emailul_de_suport(client, live_bot, telegram_calls, monkeypatch):
    monkeypatch.setattr(telegram_bot.settings, "legal_contact_email", "")
    monkeypatch.setattr(telegram_bot.settings, "support_telegram_username", "")
    await _post(client, _update_from("/contacts", "ru"))
    text = telegram_calls[0]["json"]["text"]
    assert "support@flrt.md" in text
    assert "t.me/" not in text
    assert "Контакты" in text


@pytest.mark.asyncio
async def test_privacy_are_linkuri_publice_si_buton_spre_app(client, live_bot, telegram_calls, monkeypatch):
    monkeypatch.setattr(telegram_bot.settings, "public_legal_base_url", "https://api.flrt.md/")
    await _post(client, _update_from("/privacy"))
    call = telegram_calls[0]
    text = call["json"]["text"]
    assert '<a href="https://api.flrt.md/legal/privacy">' in text
    assert '<a href="https://api.flrt.md/legal/terms">' in text
    button = _button(call)
    assert button["text"] == bot_texts.button("ro", "privacy_app")
    assert button["web_app"]["url"] == f"{MINIAPP_URL}?startapp=privacy"


@pytest.mark.asyncio
@pytest.mark.parametrize(("command", "param"), [("/events", "events"), ("/tickets", "tickets")])
async def test_events_si_tickets_deschid_ecranul_potrivit(
    client, live_bot, telegram_calls, command, param
):
    await _post(client, _update_from(command))
    assert _button(telegram_calls[0])["web_app"]["url"] == f"{MINIAPP_URL}?startapp={param}"


@pytest.mark.asyncio
async def test_comanda_pentru_alt_bot_e_ignorata(client, live_bot, telegram_calls, monkeypatch):
    monkeypatch.setattr(telegram_bot.settings, "telegram_bot_username", "flrt_party_bot")
    await _post(client, _update_from("/help@alt_bot"))
    assert telegram_calls == []
    await _post(client, _update_from("/help@flrt_party_bot"))
    assert _method(telegram_calls[0]) == "sendMessage"


@pytest.mark.asyncio
async def test_comanda_necunoscuta_primeste_indiciul(client, live_bot, telegram_calls):
    await _post(client, _update_from("/xyz"))
    assert telegram_calls[0]["json"]["text"] == bot_texts.fallback_text("ro")


@pytest.mark.asyncio
async def test_mesaj_editat_nu_primeste_raspuns(client, live_bot, telegram_calls):
    update = _update("/start")
    update["edited_message"] = update.pop("message")
    await _post(client, update)
    assert telegram_calls == []


# --- callback_query ----------------------------------------------------------
@pytest.mark.asyncio
async def test_callback_ajutor_raspunde_si_trimite_ajutorul(client, live_bot, telegram_calls):
    await _post(client, _callback_update("help", "en"))
    assert [_method(c) for c in telegram_calls] == ["answerCallbackQuery", "sendMessage"]
    assert telegram_calls[0]["json"] == {"callback_query_id": "cbq-1"}
    assert telegram_calls[1]["json"]["chat_id"] == 555
    assert "What FLIRT can do" in telegram_calls[1]["json"]["text"]


@pytest.mark.asyncio
async def test_callback_contacte(client, live_bot, telegram_calls):
    await _post(client, _callback_update("contacts", "ro"))
    assert "Contacte FLIRT" in telegram_calls[1]["json"]["text"]


@pytest.mark.asyncio
async def test_callback_necunoscut_e_doar_confirmat(client, live_bot, telegram_calls):
    await _post(client, _callback_update("../../hack"))
    assert [_method(c) for c in telegram_calls] == ["answerCallbackQuery"]


@pytest.mark.asyncio
async def test_callback_fara_secret_e_respins(client, live_bot, telegram_calls):
    resp = await client.post(WEBHOOK, json=_callback_update("help"))
    assert resp.status_code == 403
    assert telegram_calls == []


@pytest.mark.asyncio
async def test_callback_respecta_rate_limit(client, live_bot, telegram_calls, monkeypatch):
    async def over_limit(chat_id):
        return False

    monkeypatch.setattr(telegram_api, "_within_rate_limit", over_limit)
    await _post(client, _callback_update("help"))
    assert telegram_calls == []


# --- Textele profilului: limitele Telegram ------------------------------------
def _utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def test_textele_profilului_respecta_limitele():
    for lang in bot_texts.LANGS:
        assert _utf16_len(bot_texts.DESCRIPTION[lang]) <= 512
        assert _utf16_len(bot_texts.SHORT_DESCRIPTION[lang]) <= 120
        assert 1 <= len(bot_texts.BOT_NAME[lang]) <= 64
        names = [c for c, _ in bot_texts.COMMANDS[lang]]
        assert names == [c for c, _ in bot_texts.COMMANDS["ro"]], "aceleași comenzi în toate limbile"
        for name, desc in bot_texts.COMMANDS[lang]:
            assert name.islower() and 1 <= len(name) <= 32
            assert 1 <= len(desc) <= 256
    # Webhookul înțelege fiecare comandă din meniu.
    assert set(telegram_api._SIMPLE_HANDLERS) | {"start"} == bot_texts.KNOWN_COMMANDS


def test_imaginile_botului_exista_si_au_dimensiunile_corecte():
    from PIL import Image

    with Image.open(telegram_bot.WELCOME_IMAGE) as im:
        assert im.size == (1280, 720)
    with Image.open(telegram_bot.AVATAR_IMAGE) as im:
        assert im.size == (640, 640)


# --- Scriptul de configurare -------------------------------------------------
def _load_setup_script():
    path = Path(__file__).resolve().parent.parent / "scripts" / "setup_telegram_bot.py"
    spec = importlib.util.spec_from_file_location("setup_telegram_bot", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def test_setup_dry_run_nu_face_apeluri(telegram_calls, capsys, monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_URL", raising=False)
    setup = _load_setup_script()
    assert setup._main(["--dry-run"]) == 0
    assert telegram_calls == []
    out = capsys.readouterr().out
    assert "[dry-run]" in out and "/help" in out


def test_setup_configureaza_profilul_fara_sa_atinga_webhookul(
    live_bot, scripted_calls, capsys, monkeypatch
):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_URL", raising=False)
    calls, responses = scripted_calls
    # Numele implicit e deja „FLIRT" → nu se rescrie (idempotent).
    responses["getMyName"] = lambda call: _FakeResponse(
        {"ok": True, "result": {"name": "FLIRT" if not (call["json"] or {}).get("language_code") else "Vechi"}}
    )
    responses["getWebhookInfo"] = _FakeResponse(
        {"ok": True, "result": {"url": "https://api.flrt.md/api/v1/telegram/webhook",
                                "allowed_updates": ["message"], "pending_update_count": 0}}
    )
    setup = _load_setup_script()
    assert setup._main([]) == 0

    methods = [_method(c) for c in calls]
    assert methods.count("setMyCommands") == 8  # 4 limbi × (implicit + private)
    assert methods.count("setMyName") == 3      # implicitul era deja la zi
    assert methods.count("setMyDescription") == 4
    assert methods.count("setMyShortDescription") == 4
    assert "setChatMenuButton" in methods
    assert "setWebhook" not in methods
    assert "setMyProfilePhoto" not in methods

    ru_cmds = next(c["json"] for c in calls if _method(c) == "setMyCommands"
                   and c["json"].get("language_code") == "ru")
    assert {"command": "help", "description": dict(bot_texts.COMMANDS["ru"])["help"]} in ru_cmds["commands"]
    menu = next(c["json"] for c in calls if _method(c) == "setChatMenuButton")["menu_button"]
    assert menu == {"type": "web_app", "text": "FLIRT", "web_app": {"url": MINIAPP_URL}}

    out = capsys.readouterr().out
    assert "REZUMAT" in out
    # allowed_updates fără callback_query → instrucțiune clară, fără modificare.
    assert "--webhook-url" in out
    assert BOT_TOKEN not in out and WEBHOOK_SECRET not in out


def test_setup_cu_webhook_url_seteaza_si_allowed_updates(live_bot, scripted_calls, monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_URL", raising=False)
    calls, _ = scripted_calls
    setup = _load_setup_script()
    assert setup._main(["--webhook-url", "https://api.flrt.md/api/v1/telegram/webhook"]) == 0
    hook = next(c["json"] for c in calls if _method(c) == "setWebhook")
    assert hook["allowed_updates"] == ["message", "callback_query"]
    assert hook["secret_token"] == WEBHOOK_SECRET


def test_setup_poza_de_profil_metoda_lipsa_da_pasii_botfather(
    live_bot, scripted_calls, capsys, monkeypatch
):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_URL", raising=False)
    calls, responses = scripted_calls
    responses["setMyProfilePhoto"] = _StatusResponse(
        {"ok": False, "error_code": 404, "description": "Not Found"}, status_code=404
    )
    setup = _load_setup_script()
    # Metoda lipsă NU e un eșec al scriptului: e o acțiune manuală.
    assert setup._main(["--with-photo"]) == 0

    photo = next(c for c in calls if _method(c) == "setMyProfilePhoto")
    assert json.loads(photo["data"]["photo"]) == {"type": "static", "photo": "attach://avatar"}
    assert photo["files"]["avatar"][1] == telegram_bot.AVATAR_IMAGE.read_bytes()
    out = capsys.readouterr().out
    assert "@BotFather" in out and "Edit Botpic" in out


def test_setup_poza_de_profil_reusita(live_bot, scripted_calls, capsys, monkeypatch):
    monkeypatch.delenv("TELEGRAM_WEBHOOK_URL", raising=False)
    calls, responses = scripted_calls
    responses["setMyProfilePhoto"] = _FakeResponse({"ok": True, "result": True})
    setup = _load_setup_script()
    assert setup._main(["--with-photo"]) == 0
    assert "✓ setMyProfilePhoto" in capsys.readouterr().out
