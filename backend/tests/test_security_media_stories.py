"""Regresii de securitate pe Stories: URL-ul media, vizibilitatea și ștergerea fișierelor.

- `media_url` doar din storage-ul propriu, sub `stories/{user.id}/` (altfel un URL
  arbitrar ocolește moderarea NSFW și scurge IP-ul fiecărui match);
- un user blocat (oricare direcție) / banat / șters / ascuns nu mai apare în bară;
- ștergerea unei povești șterge și fișierul (+ variantele); poveștile expirate și
  pozele orfane din `stories/` sunt curățate de purjarea periodică.
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.core.security import hash_password
from app.models.account import Block, UserSettings
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import StoryIn
from app.services import storage
from app.services import story_service as S

_ADULT_YEAR = date.today().year - 25


async def _user(db, email: str, name: str = "U") -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    db.add(
        Profile(
            user_id=user.id, name=name, birth_date=date(_ADULT_YEAR, 1, 1),
            gender="male", height_cm=180, city="Chișinău", languages=["ru"],
            dating_statuses=["serious"], photos=[],
        )
    )
    await db.commit()
    return user


async def _match(db, a: User, b: User) -> None:
    lo, hi = sorted([a.id, b.id], key=str)
    db.add(Match(user_a_id=lo, user_b_id=hi))
    await db.commit()


def _own_url(uid, ext: str = "jpg") -> str:
    return f"{settings.storage_base_url}/stories/{uid}/{uuid.uuid4().hex}.{ext}"


async def _story(db, user: User, *, expired: bool = False, url: str | None = None) -> Story:
    delta = timedelta(hours=-1 if expired else 23)
    story = Story(
        user_id=user.id,
        media_url=url or _own_url(user.id),
        expires_at=datetime.now(timezone.utc) + delta,
    )
    db.add(story)
    await db.commit()
    await db.refresh(story)
    return story


def _visible_ids(page) -> set:
    return {g.user_id for g in page.items}


# --- 1. media_url arbitrar → 422 ---------------------------------------------
@pytest.mark.asyncio
async def test_story_media_url_must_be_own_storage(db_session):
    me = await _user(db_session, "me@example.com")
    other = await _user(db_session, "other@example.com")
    base = settings.storage_base_url
    hexname = uuid.uuid4().hex
    bad_urls = [
        "https://attacker.example/pixel.jpg",  # server străin (IP leak, fără moderare)
        f"https://evil.example/stories/{me.id}/{hexname}.jpg",  # cale corectă, host străin
        f"{base}/stories/{other.id}/{hexname}.jpg",  # poza ALTUI user
        f"{base}/photos/{me.id}/{hexname}.jpg",  # alt namespace
        f"{base}/stories/{me.id}/../{other.id}/{hexname}.jpg",  # traversare
        f"{base}/stories/{me.id}/{hexname}_256.webp",  # variantă, nu original
        f"{base}/stories/{me.id}/{hexname}.svg",  # extensie nepermisă
        f"{base}/stories/{me.id}/{hexname}.jpg?x=1",  # query
        f"{base}/stories/{me.id}/sub/{hexname}.jpg",  # sub-director
    ]
    for url in bad_urls:
        with pytest.raises(HTTPException) as exc:
            await S.create_story(db_session, me, StoryIn(media_url=url))
        assert exc.value.status_code == 422, url

    out = await S.create_story(db_session, me, StoryIn(media_url=_own_url(me.id)))
    assert out.media_url.startswith(f"{base}/stories/{me.id}/")


@pytest.mark.asyncio
async def test_story_api_rejects_foreign_media_url(client):
    from tests.test_stories import _make_user

    headers, uid = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        "/api/v1/stories/",
        json={"media_url": "https://attacker.example/track.jpg"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
    ok = await client.post(
        "/api/v1/stories/", json={"media_url": _own_url(uid)}, headers=headers
    )
    assert ok.status_code == 201, ok.text


# --- 2. Blocare / ban / ștergere / ascundere → povestea nu se vede ----------
@pytest.mark.asyncio
@pytest.mark.parametrize("direction", ["viewer_blocked_author", "author_blocked_viewer"])
async def test_blocked_match_stories_hidden_both_directions(db_session, direction):
    viewer = await _user(db_session, "v@example.com")
    author = await _user(db_session, "a@example.com")
    await _match(db_session, viewer, author)
    await _story(db_session, author)
    assert author.id in _visible_ids(await S.list_active_grouped(db_session, viewer))

    if direction == "viewer_blocked_author":
        db_session.add(Block(blocker_id=viewer.id, blocked_id=author.id))
    else:
        db_session.add(Block(blocker_id=author.id, blocked_id=viewer.id))
    await db_session.commit()

    assert author.id not in _visible_ids(await S.list_active_grouped(db_session, viewer))
    assert viewer.id not in _visible_ids(await S.list_active_grouped(db_session, author))


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["banned", "deleted", "hidden"])
async def test_banned_deleted_hidden_author_stories_hidden(db_session, state):
    viewer = await _user(db_session, "v@example.com")
    author = await _user(db_session, "a@example.com")
    await _match(db_session, viewer, author)
    await _story(db_session, author)

    now = datetime.now(timezone.utc)
    if state == "banned":
        author.banned_at = now
    elif state == "deleted":
        author.deleted_at = now
    else:
        db_session.add(
            UserSettings(user_id=author.id, search_radius_km=50, profile_hidden=True)
        )
    await db_session.commit()

    assert author.id not in _visible_ids(await S.list_active_grouped(db_session, viewer))


# --- 8. Ștergere fișiere: delete / expirare / orfane --------------------------
@pytest.fixture
def local_media(tmp_path, monkeypatch):
    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    return tmp_path


def _write_story_files(root, uid) -> tuple[str, list]:
    """Original + varianta `_256.webp` pe disc → (url, [căi])."""
    hexname = uuid.uuid4().hex
    folder = root / "stories" / str(uid)
    folder.mkdir(parents=True, exist_ok=True)
    original = folder / f"{hexname}.jpg"
    variant = folder / f"{hexname}_256.webp"
    original.write_bytes(b"jpeg")
    variant.write_bytes(b"webp")
    return f"https://api.flrt.md/media/stories/{uid}/{hexname}.jpg", [original, variant]


@pytest.mark.asyncio
async def test_delete_story_removes_file_and_variants(db_session, local_media):
    me = await _user(db_session, "me@example.com")
    url, paths = _write_story_files(local_media, me.id)
    story = await _story(db_session, me, url=url)

    await S.delete_story(db_session, me, story.id)

    assert await db_session.get(Story, story.id) is None
    assert not any(p.exists() for p in paths), "fișierul poveștii a rămas pe disc"


@pytest.mark.asyncio
async def test_file_kept_while_another_story_uses_it(db_session, local_media):
    """Același upload publicat de două ori: ștergerea primei nu strică a doua."""
    me = await _user(db_session, "me@example.com")
    url, paths = _write_story_files(local_media, me.id)
    first = await _story(db_session, me, url=url)
    second = await _story(db_session, me, url=url)

    await S.delete_story(db_session, me, first.id)
    assert all(p.exists() for p in paths)

    await S.delete_story(db_session, me, second.id)
    assert not any(p.exists() for p in paths)


@pytest.mark.asyncio
async def test_purge_expired_stories_removes_rows_and_files(db_session, local_media):
    me = await _user(db_session, "me@example.com")
    old_url, old_paths = _write_story_files(local_media, me.id)
    live_url, live_paths = _write_story_files(local_media, me.id)
    expired = await _story(db_session, me, expired=True, url=old_url)
    active = await _story(db_session, me, url=live_url)

    purged = await S.purge_expired_stories(db_session)

    assert purged == 1
    db_session.expunge_all()
    assert await db_session.get(Story, expired.id) is None
    assert await db_session.get(Story, active.id) is not None
    assert not any(p.exists() for p in old_paths)
    assert all(p.exists() for p in live_paths)


@pytest.mark.asyncio
async def test_purge_orphan_story_media(db_session, local_media):
    me = await _user(db_session, "me@example.com")
    live_url, live_paths = _write_story_files(local_media, me.id)
    await _story(db_session, me, url=live_url)
    _, orphan_old = _write_story_files(local_media, me.id)
    _, orphan_recent = _write_story_files(local_media, me.id)
    two_hours_ago = time.time() - 7200
    for path in [*orphan_old, *live_paths]:
        os.utime(path, (two_hours_ago, two_hours_ago))

    removed = await S.purge_orphan_story_media(db_session)

    assert removed == 2
    assert not any(p.exists() for p in orphan_old), "orfanul vechi trebuia șters"
    assert all(p.exists() for p in orphan_recent), "un upload recent nu e (încă) orfan"
    assert all(p.exists() for p in live_paths), "povestea activă și-a pierdut fișierul"


@pytest.mark.asyncio
async def test_gdpr_purge_job_runs_story_cleanup(monkeypatch):
    """`scripts/gdpr_purge.run_once` cheamă și curățarea poveștilor."""
    import importlib.util
    import pathlib

    path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "gdpr_purge.py"
    spec = importlib.util.spec_from_file_location("gdpr_purge_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    calls: list[str] = []

    async def fake(name, value=0):
        calls.append(name)
        return value

    monkeypatch.setattr(module, "purge_expired_accounts", lambda db: fake("accounts"))
    monkeypatch.setattr(module, "purge_expired_payment_proofs", lambda db: fake("proofs"))
    monkeypatch.setattr(module, "purge_expired_stories", lambda db: fake("stories", 3))
    monkeypatch.setattr(module, "purge_orphan_story_media", lambda db: fake("orphans"))
    await module.run_once()
    assert calls == ["accounts", "proofs", "stories", "orphans"]


@pytest.mark.asyncio
async def test_story_caption_masks_contacts(db_session):
    """Textul story-ului e mascat ca „despre" din profil: fără telefon / handle."""
    me = await _user(db_session, "caption@example.com")
    out = await S.create_story(
        db_session,
        me,
        StoryIn(media_url=_own_url(me.id), caption="scrie-mi 069123456 sau @numele_meu"),
    )
    assert "069123456" not in out.caption
    assert "@numele_meu" not in out.caption
