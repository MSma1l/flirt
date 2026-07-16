"""Teste pentru moderarea automată a pozelor (NSFW) — Apple Guideline 1.2.

Acoperă: stub-ul implicit lasă totul să treacă (fără rețea), verdictul negativ dă
422 și poza NU ajunge în storage, verdictul pozitiv salvează normal, providerul
căzut e FAIL-OPEN (uploadul reușește), iar guardul de producție refuză un provider
„live" fără chei.

Clientul Anthropic e MOCK-uit integral: testele nu ating rețeaua și nu cer o cheie
reală.
"""
import base64
from datetime import date

import pytest

from app.services import photo_moderation
from app.services.photo_moderation import (
    AnthropicPhotoModerator,
    ModerationVerdict,
    RekognitionPhotoModerator,
    StubPhotoModerator,
    get_photo_moderator,
)

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25

# PNG 1x1 valid (recunoscut de imghdr și PIL) — același ca în test_upload_security.
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def _token(payload: dict) -> str:
    for k in ("access_token", "accessToken", "token"):
        if isinstance(payload.get(k), str):
            return payload[k]
    raise AssertionError("no token")


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "languages": ["ro"],
        "about": "Salut.",
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": [],
    }


async def _make_user(client, email: str):
    r = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Pass!"}
    )
    assert r.status_code in (200, 201), r.text
    headers = {"Authorization": f"Bearer {_token(r.json())}"}
    r = await client.put(f"{API}/profiles/me", json=_anketa("A"), headers=headers)
    assert r.status_code == 200, r.text
    return headers


class _SpyStorage:
    """Storage fals care NUMĂRĂ salvările — dovada că poza n-a atins discul."""

    def __init__(self) -> None:
        self.saved: list[tuple[str, bytes]] = []

    async def save(self, key: str, content: bytes, content_type: str) -> str:
        self.saved.append((key, content))
        return f"https://cdn.flirt.local/{key}"

    async def delete(self, key: str) -> None:  # pragma: no cover — nefolosit aici
        pass


def _patch_moderator(monkeypatch, moderator) -> None:
    """Înlocuiește fabrica de moderator DIN ENDPOINT (importată prin `from ... import`)."""
    from app.api.v1 import profiles

    monkeypatch.setattr(profiles, "get_photo_moderator", lambda: moderator)


def _patch_storage(monkeypatch, storage) -> None:
    """Înlocuiește fabrica de storage folosită de `profile_service.add_photo`."""
    from app.services import profile_service

    monkeypatch.setattr(profile_service, "get_storage", lambda: storage)


# --- Stub-ul implicit ---------------------------------------------------------
@pytest.mark.asyncio
async def test_default_provider_is_stub():
    """Fără configurare, fabrica întoarce stub-ul (dev/teste, fără rețea)."""
    from app.core.config import settings

    assert settings.photo_moderation_provider == "stub"
    assert isinstance(get_photo_moderator(), StubPhotoModerator)


@pytest.mark.asyncio
async def test_stub_allows_everything():
    """Stub-ul lasă totul să treacă și nu atinge rețeaua."""
    verdict = await StubPhotoModerator().check(b"orice", "image/png")
    assert verdict.allowed is True
    assert verdict.reason is None
    assert verdict.needs_review is False


@pytest.mark.asyncio
async def test_upload_passes_with_default_stub(client):
    """Uploadul merge out-of-the-box, pe stub, fără nicio configurare."""
    headers = await _make_user(client, "mod-stub@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_unknown_provider_raises(monkeypatch):
    """Un provider necunoscut e o eroare de configurare, nu o degradare tăcută."""
    monkeypatch.setattr(
        photo_moderation.settings, "photo_moderation_provider", "magie"
    )
    with pytest.raises(NotImplementedError):
        get_photo_moderator()


# --- Verdict negativ → 422 + poza NU ajunge în storage ------------------------
@pytest.mark.asyncio
async def test_rejected_photo_returns_422_and_is_not_stored(client, monkeypatch):
    """Verdict allowed=False → 422 cu mesaj în română, iar storage-ul rămâne gol."""

    class _Rejecting:
        async def check(self, image, media_type):
            return ModerationVerdict(
                allowed=False, reason="nudity", raw_label="nudity"
            )

    storage = _SpyStorage()
    _patch_moderator(monkeypatch, _Rejecting())
    _patch_storage(monkeypatch, storage)

    headers = await _make_user(client, "mod-reject@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert "nuditate" in r.json()["detail"].lower()
    # DOVADA că moderarea rulează ÎNAINTE de storage:
    assert storage.saved == []

    # ...și că poza nu e nici în profil.
    r = await client.get(f"{API}/profiles/me", headers=headers)
    assert r.json()["photos"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "category, expected_word",
    [
        ("nudity", "nuditate"),
        ("sexual_activity", "sexual"),
        ("violence", "violență"),
        ("minor", "minor"),
        ("other", "explicit"),
    ],
)
async def test_rejection_message_per_category(
    client, monkeypatch, category, expected_word
):
    """Fiecare categorie primește un mesaj propriu, în română, util pentru user."""

    class _Rejecting:
        async def check(self, image, media_type):
            return ModerationVerdict(allowed=False, reason=category)

    _patch_moderator(monkeypatch, _Rejecting())
    headers = await _make_user(client, f"mod-{category}@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert expected_word in r.json()["detail"].lower()


# --- Verdict pozitiv → poza se salvează normal --------------------------------
@pytest.mark.asyncio
async def test_allowed_photo_is_stored(client, monkeypatch):
    """Verdict allowed=True → poza ajunge în storage și în profil."""

    class _Allowing:
        async def check(self, image, media_type):
            return ModerationVerdict(allowed=True, raw_label="safe")

    storage = _SpyStorage()
    _patch_moderator(monkeypatch, _Allowing())
    _patch_storage(monkeypatch, storage)

    headers = await _make_user(client, "mod-allow@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    assert len(storage.saved) == 1
    assert storage.saved[0][1] == _PNG_1X1
    assert len(r.json()) == 1


# --- FAIL-OPEN: providerul crapă → uploadul REUȘEȘTE --------------------------
@pytest.mark.asyncio
async def test_provider_exception_is_fail_open(client, monkeypatch, caplog):
    """Un moderator care ridică excepție NU are voie să dea 500 sau să blocheze.

    Excepția e prinsă în providerul concret (vezi testele Anthropic mai jos); aici
    verificăm capătul de lanț: un verdict `needs_review` trece și e logat.
    """

    class _Broken:
        async def check(self, image, media_type):
            return ModerationVerdict(
                allowed=True, raw_label="connection_error", needs_review=True
            )

    storage = _SpyStorage()
    _patch_moderator(monkeypatch, _Broken())
    _patch_storage(monkeypatch, storage)

    headers = await _make_user(client, "mod-failopen@example.com")
    with caplog.at_level("WARNING"):
        r = await client.post(
            f"{API}/profiles/photos",
            files={"file": ("x.png", _PNG_1X1, "image/png")},
            headers=headers,
        )
    assert r.status_code == 200, r.text          # NU 500, NU 422
    assert len(storage.saved) == 1               # poza s-a salvat
    assert "REVIEW UMAN" in caplog.text          # dar e marcată pentru om


# --- Providerul Anthropic (client MOCK-uit — fără rețea, fără cheie) ----------
class _FakeBlock:
    def __init__(self, text: str) -> None:
        self.type = "text"
        self.text = text


class _FakeResponse:
    def __init__(self, text: str) -> None:
        self.content = [_FakeBlock(text)]


def _fake_anthropic_client(monkeypatch, *, response=None, exc=None):
    """Mock-uiește `AnthropicPhotoModerator._client` — zero rețea, zero cheie."""
    calls: list[dict] = []

    class _Messages:
        async def create(self, **kwargs):
            calls.append(kwargs)
            if exc is not None:
                raise exc
            return response

    class _Client:
        messages = _Messages()

    monkeypatch.setattr(
        AnthropicPhotoModerator, "_client", lambda self: _Client()
    )
    return calls


@pytest.mark.asyncio
async def test_anthropic_allows_safe_photo(monkeypatch):
    """Răspuns {allowed: true, category: safe} → poza trece."""
    calls = _fake_anthropic_client(
        monkeypatch, response=_FakeResponse('{"allowed": true, "category": "safe"}')
    )
    verdict = await AnthropicPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True
    assert verdict.reason is None
    assert verdict.needs_review is False


@pytest.mark.asyncio
async def test_anthropic_rejects_nudity(monkeypatch):
    """Răspuns {allowed: false, category: nudity} → poza e respinsă, cu categorie."""
    _fake_anthropic_client(
        monkeypatch,
        response=_FakeResponse('{"allowed": false, "category": "nudity"}'),
    )
    verdict = await AnthropicPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is False
    assert verdict.reason == "nudity"
    assert verdict.needs_review is False


@pytest.mark.asyncio
async def test_anthropic_request_shape(monkeypatch):
    """Cererea trimite imaginea base64 + schema JSON + modelul din config."""
    from app.core.config import settings

    calls = _fake_anthropic_client(
        monkeypatch, response=_FakeResponse('{"allowed": true, "category": "safe"}')
    )
    await AnthropicPhotoModerator().check(_PNG_1X1, "image/webp")

    assert len(calls) == 1
    kwargs = calls[0]
    assert kwargs["model"] == settings.photo_moderation_model
    assert kwargs["max_tokens"] == 256
    # Haiku NU suportă `thinking` — nu-l trimitem.
    assert "thinking" not in kwargs

    content = kwargs["messages"][0]["content"]
    image_block = content[0]
    assert image_block["type"] == "image"
    assert image_block["source"]["media_type"] == "image/webp"
    assert base64.standard_b64decode(image_block["source"]["data"]) == _PNG_1X1

    schema = kwargs["output_config"]["format"]["schema"]
    assert kwargs["output_config"]["format"]["type"] == "json_schema"
    assert schema["required"] == ["allowed", "category"]
    assert schema["additionalProperties"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("error_name", ["RateLimitError", "APIConnectionError"])
async def test_anthropic_network_errors_are_fail_open(monkeypatch, error_name):
    """429 / rețea căzută → FAIL-OPEN (allowed=True + needs_review), nu excepție."""
    import anthropic

    error_cls = getattr(anthropic, error_name)
    # RO: construim excepția fără să lovim constructorii reali ai SDK-ului (care cer
    # obiecte httpx) — moștenim doar tipul, ca `except` să-l prindă.
    exc = error_cls.__new__(error_cls)
    Exception.__init__(exc, "boom")

    _fake_anthropic_client(monkeypatch, exc=exc)
    verdict = await AnthropicPhotoModerator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is True
    assert verdict.needs_review is True


@pytest.mark.asyncio
async def test_anthropic_unexpected_exception_is_fail_open(monkeypatch):
    """Orice excepție neprevăzută → tot FAIL-OPEN, niciodată 500 pe user."""
    _fake_anthropic_client(monkeypatch, exc=RuntimeError("ceva neașteptat"))
    verdict = await AnthropicPhotoModerator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is True
    assert verdict.needs_review is True


@pytest.mark.asyncio
async def test_anthropic_unparsable_response_is_fail_open(monkeypatch):
    """Răspuns care nu e JSON valid → FAIL-OPEN, nu crapă parserul."""
    _fake_anthropic_client(monkeypatch, response=_FakeResponse("nu sunt json"))
    verdict = await AnthropicPhotoModerator().check(_PNG_1X1, "image/png")
    assert verdict.allowed is True
    assert verdict.needs_review is True


@pytest.mark.asyncio
async def test_upload_with_anthropic_provider_rejects(client, monkeypatch):
    """Capăt-la-capăt: providerul 'anthropic' respinge → 422, poza nu se salvează."""
    monkeypatch.setattr(
        photo_moderation.settings, "photo_moderation_provider", "anthropic"
    )
    _fake_anthropic_client(
        monkeypatch,
        response=_FakeResponse('{"allowed": false, "category": "sexual_activity"}'),
    )
    storage = _SpyStorage()
    _patch_storage(monkeypatch, storage)

    headers = await _make_user(client, "mod-e2e@example.com")
    r = await client.post(
        f"{API}/profiles/photos",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert r.status_code == 422, r.text
    assert storage.saved == []


# --- Providerul Rekognition (boto3 MOCK-uit) ----------------------------------
def _fake_rekognition(monkeypatch, *, labels=None, exc=None):
    class _Client:
        def detect_moderation_labels(self, **kwargs):
            if exc is not None:
                raise exc
            return {"ModerationLabels": labels or []}

    monkeypatch.setattr(RekognitionPhotoModerator, "_client", lambda self: _Client())


@pytest.mark.asyncio
async def test_rekognition_allows_when_no_labels(monkeypatch):
    """Zero etichete → poza trece."""
    _fake_rekognition(monkeypatch, labels=[])
    verdict = await RekognitionPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True


@pytest.mark.asyncio
async def test_rekognition_rejects_explicit_nudity(monkeypatch):
    """Etichetă „Explicit Nudity" peste prag → respinsă, mapată pe 'nudity'."""
    _fake_rekognition(
        monkeypatch,
        labels=[
            {"Name": "Graphic Male Nudity", "ParentName": "Explicit Nudity",
             "Confidence": 97.0}
        ],
    )
    verdict = await RekognitionPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is False
    assert verdict.reason == "nudity"


@pytest.mark.asyncio
async def test_rekognition_ignores_swimwear(monkeypatch):
    """„Swimwear or Underwear" e NORMAL pe un app de dating → poza trece."""
    _fake_rekognition(
        monkeypatch,
        labels=[
            {"Name": "Swimwear or Underwear", "ParentName": "Suggestive",
             "Confidence": 99.0}
        ],
    )
    verdict = await RekognitionPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True


@pytest.mark.asyncio
async def test_rekognition_ignores_labels_below_threshold(monkeypatch):
    """O etichetă sub `nsfw_confidence_threshold` nu respinge nimic."""
    _fake_rekognition(
        monkeypatch,
        labels=[
            {"Name": "Nudity", "ParentName": "Explicit Nudity", "Confidence": 55.0}
        ],
    )
    verdict = await RekognitionPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True


@pytest.mark.asyncio
async def test_rekognition_error_is_fail_open(monkeypatch):
    """AWS căzut → FAIL-OPEN (poza trece, marcată pentru review)."""
    _fake_rekognition(monkeypatch, exc=RuntimeError("AWS down"))
    verdict = await RekognitionPhotoModerator().check(_PNG_1X1, "image/jpeg")
    assert verdict.allowed is True
    assert verdict.needs_review is True


# --- Guardul de producție -----------------------------------------------------
def _prod_env(**overrides) -> dict:
    """Un mediu de producție VALID; testele îl strică punctual."""
    base = {
        "ENVIRONMENT": "production",
        "DATABASE_URL": "postgresql+asyncpg://u:p@db:5432/flirt",
        "JWT_PRIVATE_KEY": "x",
        "JWT_PUBLIC_KEY": "y",
        "REDIS_URL": "redis://redis:6379/0",
        "SOCIAL_AUTH_MODE": "live",
        "GOOGLE_CLIENT_ID": "g",
        "OTP_MODE": "live",
        "TWILIO_ACCOUNT_SID": "s",
        "TWILIO_AUTH_TOKEN": "t",
        "TWILIO_FROM": "+373",
        "BILLING_PROVIDER": "stripe",
        "STRIPE_SECRET_KEY": "sk",
        "FACE_VERIFY_PROVIDER": "rekognition",
        "AWS_ACCESS_KEY_ID": "AKIA",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "S3_REGION": "eu-central-1",
        "STORAGE_PROVIDER": "local",
        "PUSH_PROVIDER": "expo",
        "GEO_PROVIDER": "nominatim",
        "GEO_USER_AGENT": "FLIRT/1.0 (admin@flrt.md)",
        "CORS_ORIGINS": "https://flrt.md",
        "DEBUG": "false",
    }
    base.update(overrides)
    return base


def _build_settings(monkeypatch, env: dict):
    """Construiește un `Settings` izolat de `.env`-ul local și de os.environ."""
    from app.core.config import Settings

    for key, value in env.items():
        monkeypatch.setenv(key, value)
    # `_env_file=None`: testele nu au voie să depindă de un `.env` de pe mașină.
    return Settings(_env_file=None)


def test_prod_guard_rejects_anthropic_without_key(monkeypatch):
    """PHOTO_MODERATION_PROVIDER=anthropic fără ANTHROPIC_API_KEY → refuză pornirea."""
    env = _prod_env(PHOTO_MODERATION_PROVIDER="anthropic", ANTHROPIC_API_KEY="")
    with pytest.raises(ValueError) as exc:
        _build_settings(monkeypatch, env)
    message = str(exc.value)
    assert "PHOTO_MODERATION_PROVIDER=anthropic" in message
    assert "ANTHROPIC_API_KEY" in message


def test_prod_guard_accepts_anthropic_with_key(monkeypatch):
    """Cu cheie prezentă, aceeași configurare pornește."""
    env = _prod_env(
        PHOTO_MODERATION_PROVIDER="anthropic", ANTHROPIC_API_KEY="sk-ant-test"
    )
    settings = _build_settings(monkeypatch, env)
    assert settings.photo_moderation_provider == "anthropic"


def test_prod_guard_rejects_rekognition_without_aws_keys(monkeypatch):
    """PHOTO_MODERATION_PROVIDER=rekognition fără chei AWS → refuză pornirea."""
    env = _prod_env(
        PHOTO_MODERATION_PROVIDER="rekognition",
        FACE_VERIFY_PROVIDER="stub",  # ca eroarea să vină de la moderare, nu de la KYC
        AWS_ACCESS_KEY_ID="",
        AWS_SECRET_ACCESS_KEY="",
    )
    with pytest.raises(ValueError) as exc:
        _build_settings(monkeypatch, env)
    message = str(exc.value)
    assert "PHOTO_MODERATION_PROVIDER=rekognition" in message
    assert "AWS_ACCESS_KEY_ID" in message


def test_prod_guard_ignores_photo_moderation_keys_in_development(monkeypatch):
    """În dev, un provider fără cheie nu blochează nimic (guardul e doar pt prod)."""
    env = {"ENVIRONMENT": "development", "PHOTO_MODERATION_PROVIDER": "anthropic"}
    settings = _build_settings(monkeypatch, env)
    assert settings.anthropic_api_key == ""
