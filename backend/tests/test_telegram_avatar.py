"""Poza de profil preluată automat din Telegram (`app.services.telegram_avatar`).

Rețeaua nu e atinsă niciodată: descărcarea și Bot API sunt înlocuite.
"""
import functools
import io
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.core.config import settings
from app.models.user import User
from app.services import account_service, telegram_auth, telegram_avatar
from tests.test_auth_telegram import FAKE_BOT_TOKEN, _sign


TG_PHOTO = "https://t.me/i/userpic/320/abcdef.jpg"


def _jpeg_bytes(size=(900, 700)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, (200, 30, 90)).save(out, format="JPEG")
    return out.getvalue()


# --------------------------------------------------------------------------- #
# Validarea URL-ului
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        TG_PHOTO,
        "https://cdn4.telesco.pe/file/abc.jpg",
        "https://api.telegram.org/file/botX/photos/file_1.jpg",
        "https://T.ME/i/userpic/320/x.jpg",
    ],
)
def test_sanitize_accepts_telegram_https(url):
    assert telegram_avatar.sanitize_photo_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        None,
        123,
        "",
        "http://t.me/i/userpic/320/x.jpg",  # nu https
        "https://evil.com/x.jpg",
        "https://t.me.evil.com/x.jpg",  # sufix înșelător
        "https://eviltelegram.org/x.jpg",  # nu e subdomeniu
        "https://user:pass@t.me/x.jpg",  # credențiale
        "https://t.me:8443/x.jpg",  # port exotic
        "https://t.me/i/userpic/320/x.svg",  # placeholder SVG
        "https://t.me/x.jpg\nX-Injected: 1",
        "javascript:alert(1)",
        "https://t.me/" + "a" * 600,
    ],
)
def test_sanitize_rejects_unsafe_urls(url):
    assert telegram_avatar.sanitize_photo_url(url) is None


def test_avatar_priority_own_photos_first():
    assert telegram_avatar.avatar_url_for(["https://own/1.jpg"], TG_PHOTO) == "https://own/1.jpg"
    assert telegram_avatar.avatar_url_for([], TG_PHOTO) == TG_PHOTO
    assert telegram_avatar.avatar_url_for(None, None) is None


def test_normalize_image_reencodes_and_rejects_non_images():
    out = telegram_avatar._normalize_image(_jpeg_bytes((1600, 1200)))
    assert out is not None and out[:3] == b"\xff\xd8\xff"
    with Image.open(io.BytesIO(out)) as img:
        assert max(img.size) <= telegram_avatar.AVATAR_MAX_SIDE
    assert telegram_avatar._normalize_image(b"<svg></svg>") is None
    assert telegram_avatar._normalize_image(b"not an image") is None


# --------------------------------------------------------------------------- #
# Descărcarea: doar domenii Telegram, inclusiv la redirect
# --------------------------------------------------------------------------- #


def _patch_transport(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        telegram_avatar.httpx,
        "AsyncClient",
        functools.partial(real, transport=httpx.MockTransport(handler)),
    )


async def test_download_follows_redirect_within_telegram(monkeypatch):
    jpeg = _jpeg_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "t.me":
            return httpx.Response(302, headers={"location": "https://cdn4.telesco.pe/a.jpg"})
        return httpx.Response(200, content=jpeg, headers={"content-type": "image/jpeg"})

    _patch_transport(monkeypatch, handler)
    assert await telegram_avatar._download(TG_PHOTO) == jpeg


async def test_download_refuses_redirect_outside_telegram(monkeypatch):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        if request.url.host == "t.me":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest"})
        return httpx.Response(200, content=b"secret")

    _patch_transport(monkeypatch, handler)
    assert await telegram_avatar._download(TG_PHOTO) is None
    assert seen == ["t.me"], "redirectul spre alt host nu are voie să fie urmat"


async def test_download_caps_body_size(monkeypatch):
    monkeypatch.setattr(telegram_avatar, "MAX_DOWNLOAD_BYTES", 1000)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"x" * 5000)

    _patch_transport(monkeypatch, handler)
    assert await telegram_avatar._download(TG_PHOTO) is None


# --------------------------------------------------------------------------- #
# Login: poza din initData e notată pe user
# --------------------------------------------------------------------------- #


@pytest.fixture
def telegram_live(monkeypatch):
    monkeypatch.setattr(settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN)
    monkeypatch.setattr(settings, "telegram_init_data_max_age_seconds", 86_400)
    telegram_auth.reset_replay_state()
    yield
    telegram_auth.reset_replay_state()


def _init_data(telegram_id: int, photo_url: str | None, query_id: str) -> str:
    user = {"id": telegram_id, "first_name": "Ivan", "language_code": "ro"}
    if photo_url is not None:
        user["photo_url"] = photo_url
    fields = {
        "user": json.dumps(user, separators=(",", ":")),
        "auth_date": str(int(time.time())),
        "query_id": query_id,
    }
    fields["hash"] = _sign(fields, FAKE_BOT_TOKEN)
    return urlencode(fields)


async def _login(client, telegram_id: int, photo_url: str | None, query_id: str):
    resp = await client.post(
        "/api/v1/auth/telegram",
        json={"init_data": _init_data(telegram_id, photo_url, query_id)},
    )
    assert resp.status_code == 200, resp.text


async def _user_by_tg(db_session, telegram_id: int) -> User:
    db_session.expire_all()
    return await db_session.scalar(select(User).where(User.telegram_user_id == telegram_id))


async def test_login_stores_telegram_photo_and_updates_it(client, db_session, telegram_live):
    await _login(client, 777_001, TG_PHOTO, "q1")
    user = await _user_by_tg(db_session, 777_001)
    assert user.telegram_photo_url == TG_PHOTO
    assert user.telegram_photo_source == TG_PHOTO

    new_photo = "https://t.me/i/userpic/320/changed.jpg"
    await _login(client, 777_001, new_photo, "q2")
    user = await _user_by_tg(db_session, 777_001)
    assert user.telegram_photo_url == new_photo
    assert user.telegram_photo_source == new_photo


async def test_login_ignores_non_telegram_photo_url(client, db_session, telegram_live):
    await _login(client, 777_002, "https://evil.example/tracker.jpg", "q3")
    user = await _user_by_tg(db_session, 777_002)
    assert user.telegram_photo_url is None
    assert user.telegram_photo_source is None


async def test_login_without_photo_keeps_known_photo(client, db_session, telegram_live):
    await _login(client, 777_003, TG_PHOTO, "q4")
    await _login(client, 777_003, None, "q5")
    user = await _user_by_tg(db_session, 777_003)
    assert user.telegram_photo_url == TG_PHOTO


async def test_login_schedules_background_refresh(client, db_session, telegram_live, monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(
        telegram_avatar, "schedule_refresh", lambda *a, **k: calls.append((a, k))
    )
    await _login(client, 777_004, TG_PHOTO, "q6")
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args[1] == 777_004
    assert kwargs["had_photo_url"] is True


# --------------------------------------------------------------------------- #
# Fundalul: copia în storage, Bot API, ștergerea
# --------------------------------------------------------------------------- #


async def _tg_user(db_session, **values) -> User:
    user = User(
        email=f"tg{uuid.uuid4().hex[:8]}@ext.flirt",
        password_hash="x",
        telegram_user_id=int(uuid.uuid4().int % 10**9),
        **values,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def test_refresh_replaces_telegram_url_with_stored_copy(db_session, monkeypatch):
    user = await _tg_user(db_session, telegram_photo_url=TG_PHOTO, telegram_photo_source=TG_PHOTO)

    async def fake_fetch(url):
        assert url == TG_PHOTO
        return telegram_avatar._normalize_image(_jpeg_bytes())

    monkeypatch.setattr(telegram_avatar, "fetch_avatar_bytes", fake_fetch)
    await telegram_avatar.refresh_avatar(user.id, user.telegram_user_id, True)

    uid = user.id
    db_session.expire_all()
    fresh = await db_session.get(User, uid)
    assert fresh.telegram_photo_url.startswith(f"{settings.storage_base_url}/photos/tg-{user.id}/")
    assert fresh.telegram_photo_url.endswith(".jpg")
    assert fresh.telegram_photo_source == TG_PHOTO


async def test_refresh_keeps_telegram_url_when_download_fails(db_session, monkeypatch):
    user = await _tg_user(db_session, telegram_photo_url=TG_PHOTO, telegram_photo_source=TG_PHOTO)

    async def failing(url):
        return None

    monkeypatch.setattr(telegram_avatar, "fetch_avatar_bytes", failing)
    await telegram_avatar.refresh_avatar(user.id, user.telegram_user_id, True)
    uid = user.id
    db_session.expire_all()
    assert (await db_session.get(User, uid)).telegram_photo_url == TG_PHOTO


def _fake_bot(responses: dict):
    async def call(method, payload):
        return responses[method]

    return call


async def test_refresh_via_bot_api_downloads_new_photo(db_session, monkeypatch):
    user = await _tg_user(db_session)
    monkeypatch.setattr(
        telegram_avatar.telegram_bot,
        "_call",
        _fake_bot(
            {
                "getUserProfilePhotos": {
                    "ok": True,
                    "result": {
                        "total_count": 1,
                        "photos": [[
                            {"file_id": "small", "file_unique_id": "u1", "width": 160},
                            {"file_id": "mid", "file_unique_id": "u2", "width": 640},
                            {"file_id": "big", "file_unique_id": "u3", "width": 1280},
                        ]],
                    },
                },
                "getFile": {"ok": True, "result": {"file_path": "photos/file_1.jpg"}},
            }
        ),
    )
    fetched: list[str] = []

    async def fake_fetch(url):
        fetched.append(url)
        return telegram_avatar._normalize_image(_jpeg_bytes())

    monkeypatch.setattr(telegram_avatar, "fetch_avatar_bytes", fake_fetch)
    await telegram_avatar.refresh_avatar(user.id, user.telegram_user_id, False)

    uid = user.id
    db_session.expire_all()
    fresh = await db_session.get(User, uid)
    assert fetched and fetched[0].endswith("/photos/file_1.jpg")
    assert fresh.telegram_photo_source == "tgfile:u2"  # varianta de 640px
    assert "/photos/tg-" in fresh.telegram_photo_url
    assert FAKE_BOT_TOKEN not in fresh.telegram_photo_url  # tokenul nu ajunge la client
    assert fresh.telegram_photo_checked_at is not None


async def test_refresh_via_bot_api_clears_removed_photo(db_session, monkeypatch):
    user = await _tg_user(db_session, telegram_photo_url=TG_PHOTO, telegram_photo_source=TG_PHOTO)
    monkeypatch.setattr(
        telegram_avatar.telegram_bot,
        "_call",
        _fake_bot({"getUserProfilePhotos": {"ok": True, "result": {"total_count": 0, "photos": []}}}),
    )
    await telegram_avatar.refresh_avatar(user.id, user.telegram_user_id, False)
    uid = user.id
    db_session.expire_all()
    fresh = await db_session.get(User, uid)
    assert fresh.telegram_photo_url is None
    assert fresh.telegram_photo_source is None


async def test_refresh_via_bot_api_is_throttled(db_session, monkeypatch):
    user = await _tg_user(
        db_session, telegram_photo_checked_at=datetime.now(timezone.utc) - timedelta(hours=1)
    )

    async def must_not_call(method, payload):
        raise AssertionError("Bot API interogat înainte de expirarea plafonului")

    monkeypatch.setattr(telegram_avatar.telegram_bot, "_call", must_not_call)
    await telegram_avatar.refresh_avatar(user.id, user.telegram_user_id, False)


async def test_gdpr_purge_clears_telegram_photo(db_session):
    user = await _tg_user(
        db_session,
        telegram_photo_url=f"{settings.storage_base_url}/photos/tg-x/a.jpg",
        telegram_photo_source=TG_PHOTO,
    )
    await account_service.purge_user_data(db_session, user.id)
    await db_session.commit()
    uid = user.id
    db_session.expire_all()
    fresh = await db_session.get(User, uid)
    assert fresh.telegram_photo_url is None
    assert fresh.telegram_photo_source is None
