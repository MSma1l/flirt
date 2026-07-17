"""Teste pentru clientul AI (OpenRouter) + comutatorul AI per user.

Toate apelurile HTTP sunt MOCK-uite (monkeypatch pe `httpx.AsyncClient.post`),
deci NU ating rețeaua și nu au nevoie de o cheie reală — șablonul e cel din
`test_push_billing_live.py`. Cheia folosită aici e un șir inventat.
"""
import base64
import json
import uuid

import httpx
import pytest

from app.services import ai, photo_moderation

API = "/api/v1"

# PNG 1x1 valid (același ca în test_photo_moderation / test_upload_security).
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


# --- Helpers ------------------------------------------------------------------
class _FakeResponse:
    """Răspuns httpx fals: `.json()` + `.raise_for_status()` cu status real.

    `raise_for_status` ridică `HTTPStatusError` cu `response=self`, ca `ai.py` să
    poată citi `exc.response.status_code` — exact ca la httpx-ul adevărat.
    """

    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"status {self.status_code}",
                request=httpx.Request("POST", "https://openrouter.test/x"),
                response=self,  # type: ignore[arg-type]
            )


def _chat_payload(content: str) -> dict:
    """Un răspuns OpenAI-compatibil minimal, ca cel real de la OpenRouter."""
    return {
        "id": "gen-123",
        "model": "anthropic/claude-haiku-4.5",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}}],
    }


def _configure(monkeypatch, **overrides) -> None:
    """Pune OpenRouter pe „configurat" (cheie FALSĂ) + provider AI activ."""
    monkeypatch.setattr(ai.settings, "ai_provider", overrides.get("ai_provider", "openrouter"))
    monkeypatch.setattr(ai.settings, "openrouter_api_key", "sk-or-v1-FAKE-TEST-KEY")
    monkeypatch.setattr(ai.settings, "openrouter_base_url", "https://openrouter.test/api/v1")
    monkeypatch.setattr(ai.settings, "ai_text_model", "anthropic/claude-haiku-4.5")
    monkeypatch.setattr(ai.settings, "ai_vision_model", "anthropic/claude-haiku-4.5")


def _token(payload: dict) -> str:
    for k in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(k), str):
            return payload[k]
    raise AssertionError("no token")


async def _register(client, email: str) -> dict:
    r = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Pass!"}
    )
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {_token(r.json())}"}


async def _get_user(client, db_session, headers):
    from app.models.user import User

    me = await client.get(f"{API}/auth/me", headers=headers)
    return await db_session.get(User, uuid.UUID(me.json()["id"]))


# --- (d) Clientul parsează răspunsul OpenAI-compatibil -------------------------
@pytest.mark.asyncio
async def test_complete_parses_openai_compatible_response(monkeypatch):
    """`choices[0].message.content` → `AIResult.text`; cererea e cea așteptată."""
    calls = []

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        calls.append({"url": url, "json": json, "headers": headers})
        return _FakeResponse(_chat_payload("Salut, ce faci?"))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("Dă-mi un hint")], max_tokens=64)

    assert result.ok
    assert result.text == "Salut, ce faci?"
    assert len(calls) == 1
    # Endpoint-ul OpenAI-compatibil, nu cel Anthropic.
    assert calls[0]["url"] == "https://openrouter.test/api/v1/chat/completions"
    assert calls[0]["json"]["model"] == "anthropic/claude-haiku-4.5"
    assert calls[0]["json"]["max_tokens"] == 64
    assert calls[0]["json"]["messages"] == [
        {"role": "user", "content": "Dă-mi un hint"}
    ]
    assert calls[0]["headers"]["Authorization"].startswith("Bearer sk-or-v1-")


@pytest.mark.asyncio
async def test_complete_parses_content_as_block_list(monkeypatch):
    """Unele modele întorc `content` ca listă de blocuri — tot text trebuie să iasă."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse(
            {
                "choices": [
                    {
                        "message": {
                            "content": [
                                {"type": "text", "text": "Bună "},
                                {"type": "text", "text": "ziua"},
                            ]
                        }
                    }
                ]
            }
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("hey")])
    assert result.text == "Bună ziua"


@pytest.mark.asyncio
async def test_complete_vision_sends_data_uri(monkeypatch):
    """Vision: imaginea pleacă drept `data:` URI base64, ÎNAINTEA textului."""
    calls = []

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        calls.append(json)
        return _FakeResponse(_chat_payload("ok"))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    await ai.complete_vision("Ce vezi?", _PNG_1X1, "image/png")

    content = calls[0]["messages"][0]["content"]
    assert content[0]["type"] == "image_url"
    assert content[0]["image_url"]["url"].startswith("data:image/png;base64,")
    assert base64.standard_b64decode(
        content[0]["image_url"]["url"].split(",", 1)[1]
    ) == _PNG_1X1
    assert content[1] == {"type": "text", "text": "Ce vezi?"}


# --- (e) 429 / timeout → degradare, nu excepție -------------------------------
@pytest.mark.asyncio
async def test_rate_limit_429_degrades_without_raising(monkeypatch):
    """429 (limitare OpenRouter) → AIResult(error='rate_limit'), fără excepție."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse({"error": {"message": "rate limited"}}, status_code=429)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("hey")])

    assert result.text is None
    assert result.error == ai.ERR_RATE_LIMIT
    assert not result.ok


@pytest.mark.asyncio
async def test_rate_limit_200_with_error_body_degrades(monkeypatch):
    """OpenRouter poate da 200 cu `error.code=429` în corp — tot rate_limit e."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse({"error": {"code": 429, "message": "rate limited"}})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("hey")])
    assert result.error == ai.ERR_RATE_LIMIT


@pytest.mark.asyncio
async def test_timeout_degrades_without_raising(monkeypatch):
    """Timeout de rețea → AIResult(error='timeout'), fără excepție spre user."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        raise httpx.ReadTimeout("too slow")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("hey")])
    assert result.text is None
    assert result.error == ai.ERR_TIMEOUT


@pytest.mark.asyncio
async def test_server_error_degrades(monkeypatch):
    """5xx → degradare cu etichetă `http_500`, nu excepție."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse({}, status_code=500)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    result = await ai.complete([ai.user_message("hey")])
    assert result.error == "http_500"


@pytest.mark.asyncio
async def test_network_error_degrades(monkeypatch):
    """Rețea căzută → degradare, nu excepție."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        raise httpx.ConnectError("no route")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)

    assert (await ai.complete([ai.user_message("hey")])).error == ai.ERR_NETWORK


@pytest.mark.asyncio
async def test_missing_key_degrades_without_network(monkeypatch):
    """Fără cheie: NU atingem rețeaua deloc, doar degradăm."""

    async def boom(self, url, json=None, headers=None, **kwargs):
        raise AssertionError("nu trebuia să atingem rețeaua fără cheie")

    monkeypatch.setattr(httpx.AsyncClient, "post", boom)
    monkeypatch.setattr(ai.settings, "openrouter_api_key", "")

    result = await ai.complete([ai.user_message("hey")])
    assert result.error == ai.ERR_NOT_CONFIGURED


# --- (a)(b)(c) Comutatorul AI per user ----------------------------------------
@pytest.mark.asyncio
async def test_ai_disabled_by_default_on_new_user(client, db_session):
    """(a) Un user nou are AI-ul OPRIT — cerința: se aprinde manual."""
    headers = await _register(client, f"ai-default-{uuid.uuid4().hex[:8]}@t.md")

    r = await client.get(f"{API}/settings/", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["ai_enabled"] is False


@pytest.mark.asyncio
async def test_put_settings_turns_ai_on(client, db_session):
    """(b) `PUT /settings` aprinde AI-ul, iar `GET` îl arată pornit."""
    headers = await _register(client, f"ai-on-{uuid.uuid4().hex[:8]}@t.md")

    r = await client.put(f"{API}/settings/", json={"ai_enabled": True}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["ai_enabled"] is True

    r = await client.get(f"{API}/settings/", headers=headers)
    assert r.json()["ai_enabled"] is True

    # ...și se poate stinge la loc.
    r = await client.put(f"{API}/settings/", json={"ai_enabled": False}, headers=headers)
    assert r.json()["ai_enabled"] is False


@pytest.mark.asyncio
async def test_put_settings_partial_update_keeps_ai_flag(client):
    """Un update parțial (doar tema) NU stinge AI-ul aprins anterior."""
    headers = await _register(client, f"ai-part-{uuid.uuid4().hex[:8]}@t.md")

    await client.put(f"{API}/settings/", json={"ai_enabled": True}, headers=headers)
    r = await client.put(f"{API}/settings/", json={"theme": "dark"}, headers=headers)
    assert r.json()["ai_enabled"] is True


@pytest.mark.asyncio
async def test_ai_enabled_for_requires_both_provider_and_user_flag(
    monkeypatch, client, db_session
):
    """(c) Providerul 'stub' bate preferința userului: AI-ul rămâne OPRIT.

    Regresie de protejat: dacă `ai_enabled_for` s-ar uita doar la flagul userului,
    un server fără cheie/provider ar „porni" AI-ul și fiecare apel ar cădea tăcut.
    """
    headers = await _register(client, f"ai-gate-{uuid.uuid4().hex[:8]}@t.md")
    await client.put(f"{API}/settings/", json={"ai_enabled": True}, headers=headers)
    user = await _get_user(client, db_session, headers)

    # Userul a APRINS AI-ul, dar serverul e pe stub → False.
    monkeypatch.setattr(ai.settings, "ai_provider", "stub")
    assert await ai.ai_enabled_for(db_session, user) is False

    # Provider real + user aprins → True.
    monkeypatch.setattr(ai.settings, "ai_provider", "openrouter")
    assert await ai.ai_enabled_for(db_session, user) is True


@pytest.mark.asyncio
async def test_ai_enabled_for_false_when_user_off(monkeypatch, client, db_session):
    """Provider real, dar userul NU a aprins nimic → False (implicit oprit)."""
    headers = await _register(client, f"ai-off-{uuid.uuid4().hex[:8]}@t.md")
    await client.get(f"{API}/settings/", headers=headers)  # creează rândul de setări
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(ai.settings, "ai_provider", "openrouter")
    assert await ai.ai_enabled_for(db_session, user) is False


@pytest.mark.asyncio
async def test_ai_enabled_for_false_without_settings_row(monkeypatch, client, db_session):
    """User fără rând de setări (n-a atins ecranul) → False, fără să-l creeze."""
    from sqlalchemy import select

    from app.models.account import UserSettings

    headers = await _register(client, f"ai-norow-{uuid.uuid4().hex[:8]}@t.md")
    user = await _get_user(client, db_session, headers)

    monkeypatch.setattr(ai.settings, "ai_provider", "openrouter")
    assert await ai.ai_enabled_for(db_session, user) is False

    # Read-only: verificarea NU are voie să scrie în baza de date.
    rows = await db_session.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    assert rows.scalar_one_or_none() is None


# --- (g) Moderarea foto prin providerul 'openrouter' --------------------------
@pytest.mark.asyncio
async def test_openrouter_moderator_rejects_explicit_photo(monkeypatch):
    """(g) Verdict negativ explicit → poza e RESPINSĂ, cu categoria raportată."""
    # Serializat AICI, nu în `fake_post`: acolo parametrul `json` (payload-ul
    # cererii httpx) umbrește modulul `json`.
    verdict_json = json.dumps({"allowed": False, "category": "nudity"})

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse(_chat_payload(verdict_json))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)
    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")

    moderator = photo_moderation.get_photo_moderator()
    assert isinstance(moderator, photo_moderation.OpenRouterPhotoModerator)

    verdict = await moderator.check(_PNG_1X1, "image/png")
    assert verdict.allowed is False
    assert verdict.reason == "nudity"
    assert verdict.needs_review is False  # verdict EXPLICIT, nu fail-open


@pytest.mark.asyncio
async def test_openrouter_moderator_allows_safe_photo(monkeypatch):
    """Verdict pozitiv → poza trece, fără flag de review."""
    verdict_json = json.dumps({"allowed": True, "category": "safe"})

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse(_chat_payload(verdict_json))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)
    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")

    verdict = await photo_moderation.get_photo_moderator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True
    assert verdict.needs_review is False


@pytest.mark.asyncio
async def test_openrouter_moderator_strips_markdown_fence(monkeypatch):
    """JSON împachetat în ```json ... ``` e tot parsat — nu un FAIL-OPEN inutil."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse(
            _chat_payload('```json\n{"allowed": false, "category": "violence"}\n```')
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)
    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")

    verdict = await photo_moderation.get_photo_moderator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is False
    assert verdict.reason == "violence"


@pytest.mark.asyncio
async def test_openrouter_moderator_fails_open_on_rate_limit(monkeypatch):
    """429 la moderare → FAIL-OPEN: poza trece, marcată pentru review uman."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse({"error": {"message": "rate limited"}}, status_code=429)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)
    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")

    verdict = await photo_moderation.get_photo_moderator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is True
    assert verdict.needs_review is True
    assert verdict.raw_label == ai.ERR_RATE_LIMIT


@pytest.mark.asyncio
async def test_openrouter_moderator_fails_open_on_garbage(monkeypatch):
    """Răspuns neparsabil → FAIL-OPEN, nu excepție."""

    async def fake_post(self, url, json=None, headers=None, **kwargs):
        return _FakeResponse(_chat_payload("nu sunt JSON"))

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    _configure(monkeypatch)
    monkeypatch.setattr(photo_moderation.settings, "photo_moderation_provider", "openrouter")

    verdict = await photo_moderation.get_photo_moderator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is True
    assert verdict.needs_review is True
    assert verdict.raw_label == "unparsable_response"
