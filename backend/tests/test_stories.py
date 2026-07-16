"""Teste pentru modulul Stories (rulează pe POSTGRESQL real, TZ secț. 11)."""
import base64
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.story import Story
from app.services.photo_moderation import ModerationVerdict
from tests.conftest import upload_photo

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25

# PNG 1x1 valid (recunoscut de imghdr / Pillow) — pentru upload-ul de imagine.
_PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)
# Container ISO-BMFF minimal cu box-ul `ftyp` (brand `mp42`) — un „video" mp4
# valid ca magic-bytes, suficient pentru poarta anti-video din backend.
_MP4_MIN = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"
# Idem, dar brand `qt  ` → QuickTime (.mov).
_MOV_MIN = b"\x00\x00\x00\x18ftypqt  \x00\x00\x00\x00qt  qt  "


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


async def _me_id(client, headers: dict) -> str:
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    # Un profil fără poze nu apare în feedul nimănui (principiu al
    # aplicației) — anketa singură nu e de ajuns. Al doilea pas, exact ca în
    # aplicația reală: PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


async def _match(client, a_headers, a_id, b_headers, b_id) -> None:
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


@pytest.mark.asyncio
async def test_create_and_list_mine(client):
    """POST creează o poveste; apare în /mine și în / grupat sub autor."""
    headers, uid = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/x.jpg", "caption": "Salut"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text

    mine = await client.get(f"{API}/stories/mine", headers=headers)
    assert mine.status_code == 200
    assert len(mine.json()) == 1

    grouped = await client.get(f"{API}/stories/", headers=headers)
    assert grouped.status_code == 200
    groups = grouped.json()
    assert any(g["user_id"] == uid and g["story_count"] == 1 for g in groups)


@pytest.mark.asyncio
async def test_match_sees_story_nonmatch_does_not(client):
    """Un match vede povestea; un ne-match nu."""
    a_headers, a_id = await _make_user(client, "a@example.com", "A")
    b_headers, b_id = await _make_user(client, "b@example.com", "B")
    c_headers, _ = await _make_user(client, "c@example.com", "C")
    await _match(client, a_headers, a_id, b_headers, b_id)

    await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/a.jpg"},
        headers=a_headers,
    )

    b_view = await client.get(f"{API}/stories/", headers=b_headers)
    assert any(g["user_id"] == a_id for g in b_view.json()), "Match-ul trebuie să vadă."

    c_view = await client.get(f"{API}/stories/", headers=c_headers)
    assert all(g["user_id"] != a_id for g in c_view.json()), "Ne-match-ul NU vede."


@pytest.mark.asyncio
async def test_delete_own_and_forbidden_other(client):
    """Ștergi propria poveste; a altcuiva → 403/404."""
    a_headers, _ = await _make_user(client, "a@example.com", "A")
    b_headers, _ = await _make_user(client, "b@example.com", "B")

    created = await client.post(
        f"{API}/stories/", json={"media_url": "https://cdn/a.jpg"}, headers=a_headers
    )
    story_id = created.json()["id"]

    # B nu poate șterge povestea lui A.
    forbidden = await client.delete(f"{API}/stories/{story_id}", headers=b_headers)
    assert forbidden.status_code in (403, 404), forbidden.text

    # A o poate șterge.
    ok = await client.delete(f"{API}/stories/{story_id}", headers=a_headers)
    assert ok.status_code == 204
    mine = await client.get(f"{API}/stories/mine", headers=a_headers)
    assert mine.json() == []


@pytest.mark.asyncio
async def test_expired_story_not_listed(client, db_session):
    """O poveste expirată nu apare în listări."""
    headers, uid = await _make_user(client, "a@example.com", "A")

    db_session.add(
        Story(
            user_id=uuid.UUID(uid),
            media_url="https://cdn/old.jpg",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await db_session.commit()

    mine = await client.get(f"{API}/stories/mine", headers=headers)
    assert mine.json() == [], "Poveștile expirate nu se listează."
    grouped = await client.get(f"{API}/stories/", headers=headers)
    assert grouped.json() == []


# --- Upload media (DOAR imagini — vezi poarta anti-video) ---------------------
@pytest.mark.asyncio
async def test_upload_image_media(client):
    """POST /stories/media cu o imagine validă → media_type 'image' + URL https."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["media_type"] == "image"
    assert body["media_url"].startswith("https://")
    assert "/stories/" in body["media_url"]


@pytest.mark.asyncio
async def test_upload_video_is_rejected(client):
    """Video (mp4/mov) → 422: story-urile acceptă DOAR fotografii (Guideline 1.2).

    Video-ul nu poate fi moderat automat, deci nu are voie să intre deloc.
    """
    headers, _ = await _make_user(client, "a@example.com", "A")

    for name, blob, ctype in (
        ("clip.mp4", _MP4_MIN, "video/mp4"),
        ("clip.mov", _MOV_MIN, "video/quicktime"),
    ):
        resp = await client.post(
            f"{API}/stories/media",
            files={"file": (name, blob, ctype)},
            headers=headers,
        )
        assert resp.status_code == 422, resp.text
        assert "doar fotografii" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_video_disguised_as_image_is_rejected(client):
    """Un mp4 declarat 'image/jpeg' → tot 422: ne uităm la magic-bytes, nu la header."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("poza.jpg", _MP4_MIN, "image/jpeg")},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "doar fotografii" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_create_story_with_video_media_type_is_rejected(client):
    """A doua cale (media_type='video' + URL arbitrar) e închisă tot cu 422."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn.example.com/clip.mp4", "media_type": "video"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "doar fotografii" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_upload_rejects_disallowed_type(client):
    """Un tip nepermis (ex. text) e respins cu 422."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.txt", b"nu sunt media", "text/plain")},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_upload_rejects_spoofed_video(client):
    """Content-Type 'video/mp4' dar conținut ce NU e ISO-BMFF → 422 (anti-spoof)."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("fake.mp4", b"acesta nu e un mp4 real", "video/mp4")},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_create_story_from_uploaded_photo(client):
    """Upload poză → creare story 'image', regăsit în listări."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    up = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert up.status_code == 200, up.text
    media = up.json()

    created = await client.post(
        f"{API}/stories/",
        json={"media_url": media["media_url"], "media_type": media["media_type"]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["media_type"] == "image"

    mine = await client.get(f"{API}/stories/mine", headers=headers)
    assert mine.json()[0]["media_type"] == "image"


@pytest.mark.asyncio
async def test_create_story_defaults_to_image(client):
    """Fără media_type explicit, povestea rămâne 'image' (compatibilitate)."""
    headers, _ = await _make_user(client, "a@example.com", "A")

    created = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/x.jpg"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["media_type"] == "image"


# --- Moderare NSFW a pozelor de story (Apple Guideline 1.2) -------------------
class _SpyStorage:
    """Storage fals care NUMĂRĂ salvările — dovada că poza n-a atins discul."""

    def __init__(self) -> None:
        self.saved: list[tuple[str, bytes]] = []

    async def save(self, key: str, content: bytes, content_type: str) -> str:
        self.saved.append((key, content))
        return f"https://cdn.flirt.local/{key}"

    async def delete(self, key: str) -> None:  # pragma: no cover — nefolosit aici
        pass


def _patch_story_moderator(monkeypatch, moderator) -> None:
    """Înlocuiește fabrica de moderator DIN endpoint-ul de stories."""
    from app.api.v1 import stories

    monkeypatch.setattr(stories, "get_photo_moderator", lambda: moderator)


def _patch_story_storage(monkeypatch, storage) -> None:
    """Înlocuiește fabrica de storage folosită de uploadul de story."""
    from app.api.v1 import stories

    monkeypatch.setattr(stories, "get_storage", lambda: storage)


@pytest.mark.asyncio
async def test_story_photo_rejected_by_moderation_is_not_stored(client, monkeypatch):
    """Verdict allowed=False → 422 în română, iar poza NU ajunge în storage."""

    class _Rejecting:
        async def check(self, image, media_type):
            return ModerationVerdict(allowed=False, reason="nudity", raw_label="nudity")

    storage = _SpyStorage()
    _patch_story_moderator(monkeypatch, _Rejecting())
    _patch_story_storage(monkeypatch, storage)

    headers, _ = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert "nuditate" in resp.json()["detail"].lower()
    # DOVADA că moderarea rulează ÎNAINTE de storage:
    assert storage.saved == []


@pytest.mark.asyncio
async def test_clean_story_photo_is_stored(client, monkeypatch):
    """Verdict allowed=True → poza se salvează normal și se poate publica."""

    class _Allowing:
        async def check(self, image, media_type):
            return ModerationVerdict(allowed=True, raw_label="safe")

    storage = _SpyStorage()
    _patch_story_moderator(monkeypatch, _Allowing())
    _patch_story_storage(monkeypatch, storage)

    headers, _ = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("x.png", _PNG_1X1, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["media_type"] == "image"
    assert len(storage.saved) == 1
    assert storage.saved[0][1] == _PNG_1X1


@pytest.mark.asyncio
async def test_story_moderation_provider_down_is_fail_open(client, monkeypatch, caplog):
    """Providerul cade → FAIL-OPEN: uploadul reușește, dar e logat pentru om."""

    class _Broken:
        async def check(self, image, media_type):
            return ModerationVerdict(
                allowed=True, raw_label="connection_error", needs_review=True
            )

    storage = _SpyStorage()
    _patch_story_moderator(monkeypatch, _Broken())
    _patch_story_storage(monkeypatch, storage)

    headers, _ = await _make_user(client, "a@example.com", "A")
    with caplog.at_level("WARNING"):
        resp = await client.post(
            f"{API}/stories/media",
            files={"file": ("x.png", _PNG_1X1, "image/png")},
            headers=headers,
        )
    assert resp.status_code == 200, resp.text  # NU 500, NU 422
    assert len(storage.saved) == 1             # poza s-a salvat
    assert "REVIEW UMAN" in caplog.text        # dar e marcată pentru om


@pytest.mark.asyncio
async def test_video_is_rejected_before_moderation(client, monkeypatch):
    """Video-ul e oprit de poartă, nu de moderator: moderatorul nici nu e chemat."""
    calls: list[bytes] = []

    class _Counting:
        async def check(self, image, media_type):
            calls.append(image)
            return ModerationVerdict(allowed=True)

    storage = _SpyStorage()
    _patch_story_moderator(monkeypatch, _Counting())
    _patch_story_storage(monkeypatch, storage)

    headers, _ = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        f"{API}/stories/media",
        files={"file": ("clip.mp4", _MP4_MIN, "video/mp4")},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    assert calls == []
    assert storage.saved == []
