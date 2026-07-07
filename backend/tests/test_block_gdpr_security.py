"""Teste de securitate CHAT-BLOCK / MODERARE / GDPR + validare de input.

Rulează pe SQLite in-memory (fără Docker/Postgres). Acoperă breșele reparate:
- un user blocat nu mai poate scrie / reacționa într-un chat existent (403);
- raport către user inexistent → 404; notă prea lungă → 422;
- GDPR purge: la expirarea grației datele userului sunt șterse/anonimizate;
- validare defensivă de input pe schemele rămase (gol / HTML / non-https).
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.security import hash_password
from app.models.account import (
    AccountDeletionRequest,
    Block,
    Favorite,
    UserSettings,
)
from app.models.chat import Chat, Message
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.story import Story
from app.models.swipe import Like, Match
from app.models.user import User
from app.services import account_service as A

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


# --- Helperi HTTP ------------------------------------------------------------
def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = "Str0ng-Passw0rd!") -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
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
    return headers, await _me_id(client, headers)


async def _matched_pair(client):
    a_headers, a_id = await _make_user(client, "a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "b@example.com", "Bob")
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


# =============================================================================
# 1. CHAT-BLOCK: user blocat nu poate scrie / reacționa într-un chat existent
# =============================================================================
@pytest.mark.asyncio
async def test_blocked_user_cannot_send_message(client):
    """A blochează B; B nu mai poate scrie în chatul existent → 403."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # A îl blochează pe B.
    resp = await client.post(
        f"{API}/social/blocks",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    # B încearcă să scrie în chatul existent → interzis.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "salut, tot aici?"},
        headers=b_headers,
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_blocker_also_cannot_send_message(client):
    """Blocarea taie interacțiunea în AMBELE direcții: și A (blocatorul) e oprit."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/social/blocks",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "hei"},
        headers=a_headers,
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_blocked_user_cannot_react(client):
    """Un user blocat nu poate nici reacționa la mesaje din chatul existent → 403."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # A trimite un mesaj înainte de blocare.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "primul mesaj"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    message_id = resp.json()["id"]

    # A îl blochează pe B.
    resp = await client.post(
        f"{API}/social/blocks",
        json={"target_user_id": b_id},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text

    # B nu mai poate reacționa.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{message_id}/react",
        json={"reaction": "❤️"},
        headers=b_headers,
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_unblock_restores_messaging(client):
    """După deblocare, mesajele curg din nou (regresie: 403 doar cât durează blocarea)."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": "x"}, headers=b_headers
    )
    assert resp.status_code == 403, resp.text

    # A deblochează.
    resp = await client.delete(f"{API}/social/blocks/{b_id}", headers=a_headers)
    assert resp.status_code == 204, resp.text

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "acum merge"},
        headers=b_headers,
    )
    assert resp.status_code == 201, resp.text


# =============================================================================
# 2. MODERARE: validare target + participant + notă
# =============================================================================
@pytest.mark.asyncio
async def test_report_nonexistent_user_404(client):
    """Raport către un user inexistent → 404 (anti-abuz / rapoarte fantomă)."""
    reporter_headers, _ = await _make_user(client, "rep@example.com", "Rep")
    ghost_id = str(uuid.uuid4())

    resp = await client.post(
        f"{API}/reports/",
        json={"reported_user_id": ghost_id, "category": "spam"},
        headers=reporter_headers,
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_report_note_too_long_422(client):
    """O notă peste plafon → 422 (validare de input pe ReportIn.note)."""
    reporter_headers, _ = await _make_user(client, "rep@example.com", "Rep")
    _, target_id = await _make_user(client, "tgt@example.com", "Tgt")

    resp = await client.post(
        f"{API}/reports/",
        json={
            "reported_user_id": target_id,
            "category": "spam",
            "note": "x" * 501,
        },
        headers=reporter_headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_report_note_html_rejected_422(client):
    """O notă cu marcaje HTML e respinsă (anti-XSS stocat) → 422."""
    reporter_headers, _ = await _make_user(client, "rep@example.com", "Rep")
    _, target_id = await _make_user(client, "tgt@example.com", "Tgt")

    resp = await client.post(
        f"{API}/reports/",
        json={
            "reported_user_id": target_id,
            "category": "spam",
            "note": "<script>alert(1)</script>",
        },
        headers=reporter_headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_report_with_foreign_chat_403(client):
    """Raport ce indică un chat la care raportorul NU participă → 403."""
    # Un chat între A și B.
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # C, străin de chat, raportează pe A legând raportul de chatul A-B.
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")
    resp = await client.post(
        f"{API}/reports/",
        json={
            "reported_user_id": a_id,
            "category": "offensive",
            "chat_id": chat_id,
        },
        headers=c_headers,
    )
    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_report_with_own_chat_ok(client):
    """Raport ce indică un chat propriu (participant) → 201 (regresie)."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/reports/",
        json={
            "reported_user_id": b_id,
            "category": "offensive",
            "chat_id": chat_id,
            "note": "mesaje deranjante",
        },
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "open"


# =============================================================================
# 3. GDPR: purge_expired_accounts
# =============================================================================
async def _seed_full_user(db, email: str) -> User:
    """Creează un user cu profil, setări, sesiune și poveste."""
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    db.add(
        Profile(
            user_id=user.id, name="Victima", birth_date=date(_ADULT_YEAR, 1, 1),
            gender="female", height_cm=165, city="Chișinău", languages=["ru"],
            dating_statuses=["serious"], photos=["https://cdn/1.jpg"],
        )
    )
    db.add(
        UserSettings(
            user_id=user.id,
            search_radius_km=10,
            notifications={},
            profile_hidden=True,
        )
    )
    db.add(
        RefreshSession(
            user_id=user.id, jti=uuid.uuid4().hex, family_id=uuid.uuid4().hex,
            token_hash="h", revoked=False,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    db.add(
        Story(
            user_id=user.id, media_url="https://cdn/s.jpg",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
    )
    await db.commit()
    return user


@pytest.mark.asyncio
async def test_purge_expired_account_wipes_data(db_session):
    """Cerere cu purge_after în trecut → datele userului sunt șterse/anonimizate."""
    victim = await _seed_full_user(db_session, "victim@example.com")
    other = await _seed_full_user(db_session, "other@example.com")

    # Match + chat + mesaje + like între victimă și celălalt.
    a_id, b_id = sorted([victim.id, other.id], key=lambda u: str(u))
    match = Match(user_a_id=a_id, user_b_id=b_id)
    db_session.add(match)
    await db_session.flush()
    chat = Chat(match_id=match.id, user_a_id=a_id, user_b_id=b_id)
    db_session.add(chat)
    await db_session.flush()
    db_session.add(Message(chat_id=chat.id, sender_id=victim.id, body="hei"))
    db_session.add(Like(from_user_id=victim.id, to_user_id=other.id, is_like=True))
    db_session.add(Favorite(user_id=victim.id, target_user_id=other.id))
    db_session.add(Block(blocker_id=victim.id, blocked_id=other.id))

    # Cerere de ștergere cu grația DEJA expirată.
    db_session.add(
        AccountDeletionRequest(
            user_id=victim.id,
            requested_at=datetime.now(timezone.utc) - timedelta(days=40),
            purge_after=datetime.now(timezone.utc) - timedelta(days=10),
        )
    )
    await db_session.commit()

    purged = await A.purge_expired_accounts(db_session)
    assert purged == 1

    # Contul e anonimizat (email schimbat, hash invalid).
    refreshed = await db_session.get(User, victim.id)
    assert refreshed is not None
    assert refreshed.email != "victim@example.com"
    assert refreshed.email.endswith("@deleted.invalid")
    assert refreshed.password_hash == ""

    # Datele personale sunt șterse.
    async def _count(model, *conds):
        rows = (await db_session.execute(select(model).where(*conds))).scalars().all()
        return len(rows)

    assert await _count(Profile, Profile.user_id == victim.id) == 0
    assert await _count(Story, Story.user_id == victim.id) == 0
    assert await _count(Message, Message.sender_id == victim.id) == 0
    assert await _count(Like, Like.from_user_id == victim.id) == 0
    assert await _count(Match, Match.user_a_id == victim.id) == 0
    assert await _count(Match, Match.user_b_id == victim.id) == 0
    assert await _count(Favorite, Favorite.user_id == victim.id) == 0
    assert await _count(Block, Block.blocker_id == victim.id) == 0
    assert await _count(UserSettings, UserSettings.user_id == victim.id) == 0
    assert await _count(RefreshSession, RefreshSession.user_id == victim.id) == 0
    assert await _count(Chat, Chat.id == chat.id) == 0

    # Cererea consumată → nu se reprocesează.
    reqs = (
        await db_session.execute(select(AccountDeletionRequest))
    ).scalars().all()
    assert reqs == []

    # Celălalt user rămâne intact.
    other_profile = (
        await db_session.execute(
            select(Profile).where(Profile.user_id == other.id)
        )
    ).scalar_one_or_none()
    assert other_profile is not None


@pytest.mark.asyncio
async def test_purge_ignores_not_yet_expired(db_session):
    """O cerere cu purge_after în viitor NU e atinsă."""
    victim = await _seed_full_user(db_session, "safe@example.com")
    db_session.add(
        AccountDeletionRequest(
            user_id=victim.id,
            requested_at=datetime.now(timezone.utc),
            purge_after=datetime.now(timezone.utc) + timedelta(days=30),
        )
    )
    await db_session.commit()

    purged = await A.purge_expired_accounts(db_session)
    assert purged == 0

    refreshed = await db_session.get(User, victim.id)
    assert refreshed.email == "safe@example.com"
    profile = (
        await db_session.execute(select(Profile).where(Profile.user_id == victim.id))
    ).scalar_one_or_none()
    assert profile is not None


@pytest.mark.asyncio
async def test_purge_is_idempotent(db_session):
    """A doua rulare după purjare e no-op (idempotent)."""
    victim = await _seed_full_user(db_session, "idem@example.com")
    db_session.add(
        AccountDeletionRequest(
            user_id=victim.id,
            requested_at=datetime.now(timezone.utc) - timedelta(days=40),
            purge_after=datetime.now(timezone.utc) - timedelta(days=1),
        )
    )
    await db_session.commit()

    assert await A.purge_expired_accounts(db_session) == 1
    anon_email = (await db_session.get(User, victim.id)).email
    # A doua rulare nu mai găsește cereri expirate.
    assert await A.purge_expired_accounts(db_session) == 0
    # Emailul anonim rămâne stabil (determinist).
    assert (await db_session.get(User, victim.id)).email == anon_email


# =============================================================================
# 4. Validare de input pe schemele rămase
# =============================================================================
@pytest.mark.asyncio
async def test_empty_message_rejected(client):
    """Un mesaj gol / doar spații → 422."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    for bad in ("", "   ", "\t\n "):
        resp = await client.post(
            f"{API}/chats/{chat_id}/messages",
            json={"body": bad},
            headers=a_headers,
        )
        assert resp.status_code == 422, (bad, resp.text)


@pytest.mark.asyncio
async def test_message_html_rejected(client):
    """Un mesaj cu marcaje HTML (anti-XSS stocat) → 422."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "<script>alert(1)</script>"},
        headers=a_headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_story_caption_html_rejected(client):
    """Caption de story cu <script> → 422."""
    headers, _ = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/x.jpg", "caption": "<script>x</script>"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_story_media_url_non_https_rejected(client):
    """media_url non-https → 422."""
    headers, _ = await _make_user(client, "a@example.com", "A")
    for bad in ("http://cdn/x.jpg", "ftp://cdn/x.jpg", "javascript:alert(1)", ""):
        resp = await client.post(
            f"{API}/stories/",
            json={"media_url": bad, "caption": "ok"},
            headers=headers,
        )
        assert resp.status_code == 422, (bad, resp.text)


@pytest.mark.asyncio
async def test_story_https_media_url_ok(client):
    """Un media_url https valid trece (regresie)."""
    headers, _ = await _make_user(client, "a@example.com", "A")
    resp = await client.post(
        f"{API}/stories/",
        json={"media_url": "https://cdn/x.jpg", "caption": "salut"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.asyncio
async def test_empty_region_setting_rejected(client):
    """Region gol după trim → 422 (validare pe SettingsIn)."""
    headers = await _register(client, "s@example.com")
    resp = await client.put(
        f"{API}/settings/",
        json={"region": "   "},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_push_empty_token_rejected(client):
    """Token de push gol → 422 (validare pe PushRegisterIn)."""
    headers = await _register(client, "p@example.com")
    resp = await client.post(
        f"{API}/push/register",
        json={"token": "  ", "platform": "ios"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text
