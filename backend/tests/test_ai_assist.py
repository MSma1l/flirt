"""Teste pentru funcțiile AI de produs: `/ai/chat-hint` și `/ai/chemistry/{id}`.

ZERO APELURI DE REȚEA: clientul AI (`services/ai.complete`) e înlocuit cu o
dublură care întoarce direct un `AIResult`. Nu monkeypatch-uim `httpx` — nivelul
testat aici e logica de PRODUS (apartenență, poartă de activare, degradare,
memorare temporară, mascare), nu transportul; transportul are deja acoperire în
`test_ai_openrouter.py`.

Redis lipsește în teste (`conftest` golește `REDIS_URL`), deci memorarea
temporară se testează cu o dublură in-memory injectată peste `_get_redis`.
"""
from datetime import date

import pytest

from app.core import ratelimit
from app.core.config import settings
from app.services import ai, ai_assist
from app.services.contact_masker import MASK
from tests.conftest import upload_photo

API = "/api/v1"

# Vârstă adultă deterministă (~25 ani → 18+), ca în test_chat.py.
_ADULT_YEAR = date.today().year - 25

# Numărul de telefon folosit în testele de mascare (inventat).
_PHONE = "+37360123456"


# --- Helperi HTTP (aceiași ca în test_chat.py / test_feed.py) ----------------
def _extract_token(payload: dict) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(key), str):
            return payload[key]
    for nested in ("tokens", "data", "auth"):
        if isinstance(payload.get(nested), dict):
            token = _extract_token(payload[nested])
            if token:
                return token
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    assert token, "Nu am putut obține un access token."
    return {"Authorization": f"Bearer {token}"}


async def _me_id(client, headers: dict) -> str:
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(*, name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "street": None,
        "nationality": "Moldovean",
        "languages": ["ro", "ru"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious", "friendship"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    """User complet și acționabil (anketă + poze + umor)."""
    headers = await _register(client, email)
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa(name=name), headers=headers
    )
    assert resp.status_code == 200, resp.text
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


async def _enable_ai(client, headers: dict) -> None:
    """Pornește funcțiile AI pe cont — exact prin ruta reală de setări."""
    resp = await client.put(
        f"{API}/settings/", json={"ai_enabled": True}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ai_enabled"] is True


async def _matched_pair(client):
    """Doi useri cu like reciproc → match (deci și chat)."""
    a_headers, a_id = await _make_user(client, "ai-a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "ai-b@example.com", "Bob")

    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )
    assert resp.json()["matched"] is True, resp.text
    return (a_headers, a_id), (b_headers, b_id)


async def _chat_id_for(client, headers: dict) -> str:
    resp = await client.get(f"{API}/chats/", headers=headers)
    assert resp.status_code == 200, resp.text
    chats = resp.json()
    assert chats, "Lista de dialoguri ar trebui să conțină chat-ul match-ului."
    return chats[0]["chat_id"]


# --- Dubluri ------------------------------------------------------------------
def _configure_ai(monkeypatch) -> None:
    """Pune serverul pe „are AI" (cheie FALSĂ — nu se atinge nicio rețea)."""
    monkeypatch.setattr(settings, "ai_provider", "openrouter")
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-or-v1-FAKE-TEST-KEY")
    monkeypatch.setattr(settings, "openrouter_base_url", "https://openrouter.test/v1")


def _fake_complete(monkeypatch, *, text=None, error=None) -> list:
    """Înlocuiește `ai.complete`; întoarce lista apelurilor (promptul trimis)."""
    calls: list = []

    async def fake(messages, *, model=None, max_tokens=512, response_format=None):
        calls.append(messages)
        return ai.AIResult(text=text, error=error)

    monkeypatch.setattr(ai, "complete", fake)
    return calls


def _prompt_of(call) -> str:
    """Textul promptului dintr-un apel capturat (un singur mesaj `user`)."""
    assert len(call) == 1, call
    return call[0]["content"]


class _FakeRedis:
    """Redis in-memory minimal: doar `get`/`set` cu TTL ignorat."""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str):
        return self.store.get(key)

    async def set(self, key: str, value: str, ex=None) -> None:
        self.store[key] = value


def _fake_cache(monkeypatch) -> _FakeRedis:
    fake = _FakeRedis()

    async def _get_redis():
        return fake

    monkeypatch.setattr(ai_assist, "_get_redis", _get_redis)
    return fake


# --- 1. Drumul fericit --------------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_returns_suggestions(client, monkeypatch):
    """Sugestie reușită: 200, `available=true`, cel mult 3 replici curățate."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Salut! Ce faci în weekend?"},
        headers=b_headers,
    )
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(
        monkeypatch,
        text='1. Merg la munte, vii?\n- "Tu ce planuri ai?"\nBem o cafea sâmbătă?\nA patra',
    )

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["cached"] is False
    # Numerotarea, bulinele și ghilimelele sunt curățate; plafonul e 3.
    assert body["suggestions"] == [
        "Merg la munte, vii?",
        "Tu ce planuri ai?",
        "Bem o cafea sâmbătă?",
    ]
    # Contextul trimis conține mesajul, marcat cu rolul, dar NU nume sau id-uri.
    prompt = _prompt_of(calls[0])
    assert "Ce faci în weekend?" in prompt
    assert "THEM:" in prompt
    assert "Alice" not in prompt and "Bob" not in prompt


@pytest.mark.asyncio
async def test_chat_hint_sends_only_the_last_messages(client, monkeypatch):
    """Spre furnizor pleacă DOAR ultimele câteva mesaje, nu tot istoricul."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    total = ai_assist.HINT_HISTORY_LIMIT + 5
    for i in range(total):
        resp = await client.post(
            f"{API}/chats/{chat_id}/messages",
            json={"body": f"mesajul numarul {i}"},
            headers=b_headers,
        )
        assert resp.status_code == 201, resp.text
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Hai la o cafea?")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    assert resp.status_code == 200, resp.text

    prompt = _prompt_of(calls[0])
    assert prompt.count("THEM:") == ai_assist.HINT_HISTORY_LIMIT
    # Primele mesaje (cele vechi) NU au voie să ajungă la furnizor.
    assert "mesajul numarul 0" not in prompt
    assert f"mesajul numarul {total - 1}" in prompt


# --- 2. Apartenența la conversație (scurgere de date) -------------------------
@pytest.mark.asyncio
async def test_chat_hint_rejects_non_participant(client, monkeypatch):
    """Un user din afara conversației primește 404 și NU declanșează niciun apel."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Secret între noi doi."},
        headers=b_headers,
    )

    intrus_headers, _ = await _make_user(client, "ai-c@example.com", "Carol")
    await _enable_ai(client, intrus_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="ceva")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=intrus_headers
    )

    assert resp.status_code == 404, resp.text
    assert calls == [], "Nu avem voie să chemăm modelul pe o conversație străină."


# --- 3. Poarta de activare ----------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_requires_ai_enabled_on_account(client, monkeypatch):
    """Cu `ai_enabled=false` (implicit): 403 cu mesaj acționabil, fără apel AI."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="ceva")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 403, resp.text
    assert "Setări" in resp.json()["detail"]
    assert calls == []

    # Și devine 200 imediat ce userul o pornește din setări (ruta existentă).
    await _enable_ai(client, a_headers)
    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["available"] is True


# --- 4. Degradare curată ------------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_unavailable_when_ai_not_configured(client, monkeypatch):
    """Fără chei AI: 200 + `available=false`, NU o eroare de server."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    # Config implicită de test: `ai_provider='stub'`, fără cheie.
    calls = _fake_complete(monkeypatch, text="n-ar trebui chemat")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "ai_not_configured"
    assert body["suggestions"] == []
    assert calls == []


@pytest.mark.asyncio
async def test_chat_hint_degrades_when_provider_fails(client, monkeypatch):
    """Furnizorul întoarce eroare (429/timeout/5xx) → `available=false`, 200."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    _fake_complete(monkeypatch, error=ai.ERR_RATE_LIMIT)

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "ai_provider_error"


@pytest.mark.asyncio
async def test_chat_hint_degrades_on_empty_text(client, monkeypatch):
    """Răspuns fără nimic folosibil (spații/punctuație) → `ai_empty_response`."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    _fake_complete(monkeypatch, text="   \n  \n ")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "ai_empty_response"
    assert body["suggestions"] == []


# --- 5. Limitare de cereri ----------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_is_rate_limited(client, monkeypatch):
    """Peste pragul configurat: 429, înainte să se cheme modelul."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="O singură sugestie.")
    monkeypatch.setattr(settings, "rate_limit_ai_per_min", 1)

    ratelimit.enable_for_tests()
    try:
        first = await client.post(
            f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
        )
        second = await client.post(
            f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
        )
    finally:
        ratelimit.disable_for_tests()

    assert first.status_code == 200, first.text
    assert second.status_code == 429, second.text
    assert len(calls) == 1, "A doua cerere nu avea voie să ajungă la furnizor."


# --- 6. Memorare temporară ----------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_cache_hits_and_invalidates_on_new_message(
    client, monkeypatch
):
    """Aceeași conversație fără mesaje noi = un singur apel; mesaj nou = recalcul."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Primul mesaj."},
        headers=b_headers,
    )
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Hai la o cafea?")
    cache = _fake_cache(monkeypatch)

    first = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    second = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert first.json()["cached"] is False
    assert second.json()["cached"] is True
    assert second.json()["suggestions"] == first.json()["suggestions"]
    assert len(calls) == 1, "A doua apăsare trebuia servită din memorie."
    assert len(cache.store) == 1

    # Mesaj nou în conversație ⇒ altă cheie ⇒ recalcul.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Încă un mesaj."},
        headers=b_headers,
    )
    assert resp.status_code == 201, resp.text

    third = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    assert third.json()["cached"] is False
    assert len(calls) == 2
    assert len(cache.store) == 2


@pytest.mark.asyncio
async def test_chat_hint_cache_is_per_user(client, monkeypatch):
    """Cei doi participanți NU împart aceeași memorie: perspectivele diferă."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Primul mesaj."},
        headers=b_headers,
    )
    await _enable_ai(client, a_headers)
    await _enable_ai(client, b_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Hai la o cafea?")
    _fake_cache(monkeypatch)

    first = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    second = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=b_headers
    )

    assert first.json()["cached"] is False
    assert second.json()["cached"] is False
    assert len(calls) == 2
    # Promptul lui A îl are pe B drept „THEM"; al lui B, invers.
    assert "THEM: Primul mesaj." in _prompt_of(calls[0])
    assert "ME: Primul mesaj." in _prompt_of(calls[1])


@pytest.mark.asyncio
async def test_chat_hint_works_without_redis(client, monkeypatch):
    """Fără Redis (cazul din teste/dev) ruta funcționează, doar fără memorare."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Hai la o cafea?")
    assert settings.redis_url == "", "conftest trebuie să lase REDIS_URL gol"

    first = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )
    second = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert first.status_code == second.status_code == 200
    assert second.json()["available"] is True
    assert second.json()["cached"] is False
    assert len(calls) == 2  # fără cache, se recalculează — dar nu se rupe nimic


# --- 7. Mascarea contactelor --------------------------------------------------
@pytest.mark.asyncio
async def test_chat_hint_never_sends_contacts_to_provider(client, monkeypatch):
    """Nici mesajul salvat, nici promptul nu conțin numărul de telefon."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    sent = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": f"Sună-mă la {_PHONE}"},
        headers=b_headers,
    )
    assert sent.status_code == 201, sent.text
    # Ce ajunge în baza de date e DEJA mascat (TZ 5.5).
    assert _PHONE not in sent.json()["body"]
    assert MASK in sent.json()["body"]

    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Mai bine povestește-mi despre tine.")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    prompt = _prompt_of(calls[0])
    assert _PHONE not in prompt
    assert "60123456" not in prompt
    assert MASK in prompt


@pytest.mark.asyncio
async def test_chat_hint_masks_legacy_unmasked_rows(client, monkeypatch, db_session):
    """Un rând vechi, salvat NEMASCAT, e mascat înainte să plece spre furnizor."""
    import uuid as _uuid

    from app.models.chat import Message

    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    # Ocolim `send_message` (deci și masca) — exact forma unui rând legacy.
    db_session.add(
        Message(
            chat_id=_uuid.UUID(chat_id),
            sender_id=_uuid.UUID(b_id),
            body=f"scrie-mi pe {_PHONE}",
            was_masked=False,
            is_read=False,
        )
    )
    await db_session.commit()

    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="Hai să vorbim aici.")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    assert resp.status_code == 200, resp.text
    prompt = _prompt_of(calls[0])
    assert _PHONE not in prompt
    assert MASK in prompt


@pytest.mark.asyncio
async def test_chat_hint_masks_contacts_in_model_output(client, monkeypatch):
    """Dacă modelul inventează un contact, NU ajunge nemascat la user."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    _fake_complete(monkeypatch, text=f"Dă-mi numărul tău, al meu e {_PHONE}")

    resp = await client.post(
        f"{API}/ai/chat-hint", json={"chat_id": chat_id}, headers=a_headers
    )

    suggestions = resp.json()["suggestions"]
    assert suggestions, resp.text
    assert _PHONE not in suggestions[0]
    assert MASK in suggestions[0]


# --- 8. Scorul de chimie ------------------------------------------------------
@pytest.mark.asyncio
async def test_chemistry_returns_existing_score_plus_explanation(
    client, monkeypatch
):
    """Scorul e cel DETERMINIST din feed; AI-ul adaugă doar explicația."""
    a_headers, _ = await _make_user(client, "ai-a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "ai-b@example.com", "Bob")

    # Cifra pe care o vede userul pe cartela din feed (același calcul, aceleași
    # intrări: interese, distanță reală, semnal comportamental).
    feed = await client.get(f"{API}/feed/", headers=a_headers)
    assert feed.status_code == 200, feed.text
    card = next(c for c in feed.json() if c["user_id"] == b_id)

    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(
        monkeypatch, text="Aveți sport și călătorii în comun, plus același oraș."
    )

    resp = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is True
    assert body["user_id"] == b_id
    assert body["explanation"]
    # NU un scor inventat de model: exact cifra afișată pe cartelă.
    assert body["score"] == card["compatibility"]

    # Scorul pleacă spre model DEJA calculat (modelul doar explică).
    assert f"Score: {body['score']}/100" in _prompt_of(calls[0])


@pytest.mark.asyncio
async def test_chemistry_score_survives_missing_ai(client, monkeypatch):
    """Fără chei AI: scorul rămâne, explicația lipsește, fără eroare."""
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    await _enable_ai(client, a_headers)
    calls = _fake_complete(monkeypatch, text="n-ar trebui chemat")

    resp = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["available"] is False
    assert body["reason"] == "ai_not_configured"
    assert body["explanation"] is None
    assert 0 <= body["score"] <= 100
    assert calls == []


@pytest.mark.asyncio
async def test_chemistry_requires_ai_enabled_on_account(client, monkeypatch):
    """Aceeași poartă de activare ca la sugestii: 403 acționabil."""
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    _configure_ai(monkeypatch)
    _fake_complete(monkeypatch, text="ceva")

    resp = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)

    assert resp.status_code == 403, resp.text
    assert "Setări" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_chemistry_refuses_blocked_user(client, monkeypatch):
    """Blocarea (orice direcție) taie accesul — ca la swipe, nu ca un oracol."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="ceva")

    blocked = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    assert blocked.status_code in (200, 201), blocked.text

    resp = await client.get(f"{API}/ai/chemistry/{b_id}", headers=a_headers)

    assert resp.status_code == 403, resp.text
    assert calls == []


@pytest.mark.asyncio
async def test_chemistry_hides_unknown_user(client, monkeypatch):
    """Un user inexistent → 404 neutru (nu divulgăm nimic), fără apel AI."""
    import uuid as _uuid

    a_headers, _ = await _make_user(client, "ai-solo@example.com", "Solo")
    await _enable_ai(client, a_headers)
    _configure_ai(monkeypatch)
    calls = _fake_complete(monkeypatch, text="ceva")

    resp = await client.get(
        f"{API}/ai/chemistry/{_uuid.uuid4()}", headers=a_headers
    )

    assert resp.status_code == 404, resp.text
    assert calls == []
