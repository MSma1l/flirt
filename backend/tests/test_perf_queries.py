"""Teste de PERFORMANȚĂ (regresie): număr de query-uri, paginare, GET fără scriere.

Testul care contează cel mai mult: `GET /chats` (endpointul pe care mobilul îl
face POLLING) trebuie să execute un număr CONSTANT de query-uri, indiferent de
câte chat-uri are userul. Îl măsurăm cu un event listener pe engine — nu
estimăm, contorizăm efectiv fiecare statement SQL trimis la DB.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, func, select

from app.core.security import hash_password
from app.models.account import Favorite
from app.models.chat import Chat, Message
from app.models.event import Event
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.user import User
from app.schemas.story import StoryIn
from app.services import account_service, chat_service, event_service, story_service
from tests.conftest import upload_photo

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


# --- Contor de query-uri ------------------------------------------------------
class QueryCounter:
    """Numără statement-urile SQL executate pe engine în interiorul blocului."""

    def __init__(self, engine):
        self._sync_engine = engine.sync_engine
        self.statements: list[str] = []

    def _on_execute(self, conn, cursor, statement, params, context, executemany):
        self.statements.append(statement)

    def __enter__(self) -> "QueryCounter":
        event.listen(self._sync_engine, "before_cursor_execute", self._on_execute)
        return self

    def __exit__(self, *exc) -> None:
        event.remove(self._sync_engine, "before_cursor_execute", self._on_execute)

    def __len__(self) -> int:
        return len(self.statements)


# --- Helperi de date ----------------------------------------------------------
async def _make_user(db, email: str) -> User:
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_profile(db, user: User, name: str) -> Profile:
    profile = Profile(
        user_id=user.id,
        name=name,
        birth_date=date(_ADULT_YEAR, 1, 1),
        gender="male",
        height_cm=180,
        city="Chișinău",
        languages=["ru"],
        dating_statuses=["serious"],
        photos=[],
    )
    db.add(profile)
    await db.commit()
    return profile


async def _make_chat(
    db, me: User, other: User, messages: int = 2, spaced: bool = False
) -> Chat:
    """Match + Chat + `messages` mesaje primite de la `other` (necitite).

    `spaced=True` → `created_at` distanțat cu o secundă între mesaje, ca testele
    care verifică „ultimul mesaj" să fie deterministe. Implicit (False) mesajele
    primesc `created_at` din `server_default` — pe SQLite toate cad în ACEEAȘI
    secundă, exact cazul-limită pe care îl vrem în testele de paginare (cheia de
    sortare e identică, doar `id` sparge egalitatea).
    """
    lo, hi = sorted([me.id, other.id], key=str)
    match = Match(user_a_id=lo, user_b_id=hi)
    db.add(match)
    await db.flush()

    chat = Chat(match_id=match.id, user_a_id=lo, user_b_id=hi)
    db.add(chat)
    await db.flush()

    base = datetime.now(timezone.utc)
    for i in range(messages):
        message = Message(
            chat_id=chat.id,
            sender_id=other.id,
            body=f"mesaj {i}",
            was_masked=False,
            is_read=False,
        )
        if spaced:
            message.created_at = base + timedelta(seconds=i)
        db.add(message)
    await db.commit()
    return chat


async def _add_chats(db, me: User, count: int, offset: int = 0) -> None:
    for i in range(count):
        other = await _make_user(db, f"peer{offset + i}@example.com")
        await _make_profile(db, other, f"Peer{offset + i}")
        await _make_chat(db, me, other)


# =============================================================================
# 1. N+1 pe GET /chats — numărul de query-uri NU crește cu numărul de chat-uri
# =============================================================================
@pytest.mark.asyncio
async def test_list_chats_query_count_is_constant(db_session, engine):
    """`GET /chats` face ACELAȘI număr de query-uri cu 1 chat și cu 20 de chat-uri.

    Înainte: 1 SELECT pentru chat-ul match-ului + 1 pentru ultimul mesaj + 1
    pentru necitite = 3 query-uri PER CHAT. Un user cu 200 de match-uri genera
    ~600 de query-uri LA FIECARE POLL.
    """
    me = await _make_user(db_session, "me@example.com")
    await _make_profile(db_session, me, "Me")

    await _add_chats(db_session, me, count=1)
    with QueryCounter(engine) as counter_1:
        chats = await chat_service.list_chats(db_session, me)
    assert len(chats) == 1
    queries_1 = len(counter_1)

    await _add_chats(db_session, me, count=19, offset=1)
    with QueryCounter(engine) as counter_20:
        chats = await chat_service.list_chats(db_session, me)
    assert len(chats) == 20
    queries_20 = len(counter_20)

    assert queries_20 == queries_1, (
        f"N+1: {queries_1} query-uri la 1 chat, {queries_20} la 20 de chat-uri.\n"
        + "\n".join(counter_20.statements)
    )
    # Plafon explicit: rezumatul se compune din câteva agregate, nu din bucle.
    assert queries_20 <= 8, counter_20.statements


@pytest.mark.asyncio
async def test_list_chats_data_is_correct_with_many_chats(db_session):
    """Agregatele (ultimul mesaj / necitite) rămân CORECTE per chat, nu amestecate."""
    me = await _make_user(db_session, "me2@example.com")
    await _make_profile(db_session, me, "Me")

    peer_a = await _make_user(db_session, "pa@example.com")
    await _make_profile(db_session, peer_a, "PeerA")
    chat_a = await _make_chat(db_session, me, peer_a, messages=3, spaced=True)

    peer_b = await _make_user(db_session, "pb@example.com")
    await _make_profile(db_session, peer_b, "PeerB")
    chat_b = await _make_chat(db_session, me, peer_b, messages=1, spaced=True)

    # Un mesaj propriu în chat_b, mai NOU (nu se numără ca necitit pentru mine).
    mine = Message(
        chat_id=chat_b.id,
        sender_id=me.id,
        body="ultimul, al meu",
        was_masked=False,
        is_read=False,
    )
    mine.created_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    db_session.add(mine)
    await db_session.commit()

    by_chat = {c.chat_id: c for c in await chat_service.list_chats(db_session, me)}
    assert by_chat[chat_a.id].unread_count == 3
    assert by_chat[chat_a.id].last_message == "mesaj 2"
    # În chat_b: 1 necitit (de la peer_b); mesajul meu nu se numără.
    assert by_chat[chat_b.id].unread_count == 1
    assert by_chat[chat_b.id].last_message == "ultimul, al meu"


@pytest.mark.asyncio
async def test_list_chats_creates_missing_chat_for_legacy_match(db_session):
    """Un match FĂRĂ chat (istoric) primește un chat la listare — comportament păstrat."""
    me = await _make_user(db_session, "me3@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "other3@example.com")
    await _make_profile(db_session, other, "Other")

    lo, hi = sorted([me.id, other.id], key=str)
    db_session.add(Match(user_a_id=lo, user_b_id=hi))
    await db_session.commit()

    chats = await chat_service.list_chats(db_session, me)
    assert len(chats) == 1
    assert chats[0].other_user_id == other.id

    total = await db_session.execute(select(func.count()).select_from(Chat))
    assert total.scalar_one() == 1  # creat exact o dată, idempotent
    # A doua listare nu mai creează nimic.
    await chat_service.list_chats(db_session, me)
    total = await db_session.execute(select(func.count()).select_from(Chat))
    assert total.scalar_one() == 1


# =============================================================================
# 2. Paginarea mesajelor — fără duplicate, fără mesaje sărite
# =============================================================================
@pytest.mark.asyncio
async def test_messages_pagination_no_duplicates_no_gaps(db_session):
    """Parcurgerea completă pe cursor întoarce FIECARE mesaj exact o dată.

    Toate cele 25 de mesaje sunt inserate în aceeași secundă (pe SQLite
    `created_at` are rezoluție de o secundă) → cazul limită în care cheia de
    sortare `created_at` e IDENTICĂ pentru toate rândurile, iar `id` e singurul
    care sparge egalitatea.
    """
    me = await _make_user(db_session, "m1@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "m2@example.com")
    await _make_profile(db_session, other, "Other")
    chat = await _make_chat(db_session, me, other, messages=25)

    all_ids = set(
        (
            await db_session.execute(
                select(Message.id).where(Message.chat_id == chat.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(all_ids) == 25

    seen: list[uuid.UUID] = []
    cursor = None
    for _ in range(10):  # gardă anti-buclă-infinită
        page = await chat_service.get_messages(
            db_session, me, chat.id, limit=10, cursor=cursor
        )
        assert len(page.items) <= 10
        seen.extend(m.id for m in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert cursor is None, "paginarea nu s-a terminat"
    assert len(seen) == len(set(seen)) == 25, "duplicate sau mesaje sărite"
    assert set(seen) == all_ids


@pytest.mark.asyncio
async def test_messages_first_page_is_bounded_and_newest_first(db_session):
    """Fără `?limit=`, prima pagină e PLAFONATĂ (nu întoarce toate mesajele)."""
    me = await _make_user(db_session, "m3@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "m4@example.com")
    await _make_profile(db_session, other, "Other")
    chat = await _make_chat(db_session, me, other, messages=120)

    page = await chat_service.get_messages(db_session, me, chat.id)
    # Default-ul (MESSAGES_PAGE_LIMIT = 50) — NU cele 120 de mesaje.
    assert len(page.items) == 50
    assert page.next_cursor is not None
    # În interiorul paginii, ordinea rămâne cronologică crescătoare.
    created = [m.created_at for m in page.items]
    assert created == sorted(created)


@pytest.mark.asyncio
async def test_messages_invalid_cursor_is_rejected(db_session):
    """Un cursor fabricat/stricat → 422, nu 500 și nu leak de date."""
    me = await _make_user(db_session, "m5@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "m6@example.com")
    await _make_profile(db_session, other, "Other")
    chat = await _make_chat(db_session, me, other, messages=1)

    with pytest.raises(Exception) as exc:  # HTTPException(422)
        await chat_service.get_messages(
            db_session, me, chat.id, cursor="nu-e-un-cursor"
        )
    assert getattr(exc.value, "status_code", None) == 422


# =============================================================================
# 3. GET /chats/{id}/messages NU mai marchează citit (GET nu mută stare)
# =============================================================================
@pytest.mark.asyncio
async def test_get_messages_does_not_mark_read(db_session):
    """Un GET e idempotent: nu schimbă `is_read`. Marcarea se face cu POST /read."""
    me = await _make_user(db_session, "r1@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "r2@example.com")
    await _make_profile(db_session, other, "Other")
    chat = await _make_chat(db_session, me, other, messages=3)

    await chat_service.get_messages(db_session, me, chat.id)

    unread = await db_session.execute(
        select(func.count())
        .select_from(Message)
        .where(Message.chat_id == chat.id, Message.is_read.is_(False))
    )
    assert unread.scalar_one() == 3, "GET-ul nu are voie să marcheze citit"

    # Lista de dialoguri confirmă că necititele au rămas.
    chats = await chat_service.list_chats(db_session, me)
    assert chats[0].unread_count == 3

    # Endpointul dedicat le marchează (un singur UPDATE bulk).
    await chat_service.mark_read(db_session, me, chat.id)
    unread = await db_session.execute(
        select(func.count())
        .select_from(Message)
        .where(Message.chat_id == chat.id, Message.is_read.is_(False))
    )
    assert unread.scalar_one() == 0


@pytest.mark.asyncio
async def test_mark_read_is_a_single_update(db_session, engine):
    """`_mark_read` face UN SINGUR `UPDATE ... WHERE`, nu unul per mesaj."""
    me = await _make_user(db_session, "r3@example.com")
    await _make_profile(db_session, me, "Me")
    other = await _make_user(db_session, "r4@example.com")
    await _make_profile(db_session, other, "Other")
    chat = await _make_chat(db_session, me, other, messages=30)

    with QueryCounter(engine) as counter:
        await chat_service.mark_read(db_session, me, chat.id)

    updates = [s for s in counter.statements if s.lstrip().upper().startswith("UPDATE")]
    assert len(updates) == 1, counter.statements
    # Total: 1 SELECT (chat-ul + verificarea de participant) + 1 UPDATE.
    assert len(counter) <= 2, counter.statements


@pytest.mark.asyncio
async def test_get_messages_over_http_does_not_mark_read(client):
    """Același contract, prin HTTP: GET-ul lasă `unread_count` neatins."""
    body = {"email": "http1@example.com", "password": "Str0ng-Passw0rd!"}
    resp = await client.post(f"{API}/auth/register", json=body)
    a_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}
    body_b = {"email": "http2@example.com", "password": "Str0ng-Passw0rd!"}
    resp = await client.post(f"{API}/auth/register", json=body_b)
    b_headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    anketa = {
        "name": "X",
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "nationality": "Moldovean",
        "languages": ["ru"],
        "about": "Salut.",
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": [],
    }
    await client.put(f"{API}/profiles/me", json=anketa, headers=a_headers)
    await client.put(f"{API}/profiles/me", json={**anketa, "name": "Y"}, headers=b_headers)
    # Fără poze, profilurile sunt incomplete → swipe-ul de mai jos e respins și
    # nu s-ar mai forma chat-ul pe care îl măsoară testul.
    await upload_photo(client, a_headers)
    await upload_photo(client, b_headers)

    a_id = (await client.get(f"{API}/auth/me", headers=a_headers)).json()["id"]
    b_id = (await client.get(f"{API}/auth/me", headers=b_headers)).json()["id"]
    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": b_id, "action": "like"},
        headers=a_headers,
    )
    await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": a_id, "action": "like"},
        headers=b_headers,
    )

    chat_id = (await client.get(f"{API}/chats/", headers=a_headers)).json()[0]["chat_id"]
    await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": "salut"}, headers=a_headers
    )

    # B citește mesajele cu GET → necititele NU se sting.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    resp = await client.get(f"{API}/chats/", headers=b_headers)
    assert resp.json()[0]["unread_count"] == 1, "GET-ul a marcat citit — regresie"

    # Doar POST /read stinge badge-ul.
    assert (
        await client.post(f"{API}/chats/{chat_id}/read", headers=b_headers)
    ).status_code == 204
    resp = await client.get(f"{API}/chats/", headers=b_headers)
    assert resp.json()[0]["unread_count"] == 0


# =============================================================================
# 4. Paginare pe stories / events / social
# =============================================================================
@pytest.mark.asyncio
async def test_stories_mine_pagination_no_duplicates(db_session):
    user = await _make_user(db_session, "s1@example.com")
    await _make_profile(db_session, user, "S")
    for i in range(12):
        await story_service.create_story(
            db_session, user, StoryIn(media_url=f"https://cdn/{i}.jpg")
        )

    seen: list[uuid.UUID] = []
    cursor = None
    for _ in range(6):
        page = await story_service.list_mine(db_session, user, limit=5, cursor=cursor)
        assert len(page.items) <= 5
        seen.extend(s.id for s in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert cursor is None
    assert len(seen) == len(set(seen)) == 12


@pytest.mark.asyncio
async def test_stories_grouped_pagination_no_duplicate_users(db_session):
    """Paginarea grupată nu poate întoarce același user în două pagini."""
    me = await _make_user(db_session, "g0@example.com")
    await _make_profile(db_session, me, "Me")
    await story_service.create_story(
        db_session, me, StoryIn(media_url="https://cdn/me.jpg")
    )

    for i in range(5):
        peer = await _make_user(db_session, f"g{i + 1}@example.com")
        await _make_profile(db_session, peer, f"P{i}")
        lo, hi = sorted([me.id, peer.id], key=str)
        db_session.add(Match(user_a_id=lo, user_b_id=hi))
        await db_session.commit()
        for j in range(2):
            await story_service.create_story(
                db_session, peer, StoryIn(media_url=f"https://cdn/{i}-{j}.jpg")
            )

    seen: list[uuid.UUID] = []
    cursor = None
    for _ in range(6):
        page = await story_service.list_active_grouped(
            db_session, me, limit=2, cursor=cursor
        )
        seen.extend(g.user_id for g in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert cursor is None
    assert len(seen) == len(set(seen)) == 6  # eu + 5 match-uri, fiecare o dată
    assert seen[0] == me.id  # userul curent rămâne primul


@pytest.mark.asyncio
async def test_events_pagination_no_duplicates(db_session):
    user = await _make_user(db_session, "ev@example.com")
    now = datetime.now(timezone.utc)
    for i in range(12):
        db_session.add(
            Event(
                title=f"Ev {i}",
                starts_at=now + timedelta(days=i + 1),
                city="Chișinău",
                kind="concert",
            )
        )
    await db_session.commit()

    seen: list[uuid.UUID] = []
    cursor = None
    for _ in range(6):
        page = await event_service.list_events(db_session, user, limit=5, cursor=cursor)
        assert len(page.items) <= 5
        seen.extend(e.id for e in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert cursor is None
    assert len(seen) == len(set(seen)) == 12


@pytest.mark.asyncio
async def test_favorites_pagination_no_duplicates(db_session):
    user = await _make_user(db_session, "fav@example.com")
    # Ținte REALE: pe Postgres (ca producția) un favorite către un user inexistent e
    # refuzat de foreign key — SQLite ascundea asta. Creăm 12 useri-țintă reali.
    for i in range(12):
        target = await _make_user(db_session, f"favtarget{i}@example.com")
        db_session.add(Favorite(user_id=user.id, target_user_id=target.id))
    await db_session.commit()

    seen: list[uuid.UUID] = []
    cursor = None
    for _ in range(6):
        page = await account_service.list_favorites(
            db_session, user, limit=5, cursor=cursor
        )
        assert len(page.items) <= 5
        seen.extend(f.target_user_id for f in page.items)
        cursor = page.next_cursor
        if cursor is None:
            break

    assert cursor is None
    assert len(seen) == len(set(seen)) == 12


# =============================================================================
# 5. Seed-ul de evenimente demo e BLOCAT în producție
# =============================================================================
@pytest.mark.asyncio
async def test_seed_events_blocked_in_production(db_session, monkeypatch):
    """`seed_events` nu inserează evenimente DEMO când ENVIRONMENT=production.

    Altfel baza de producție se umplea cu 4 evenimente FALSE la prima cerere
    `GET /events` a primului utilizator real (seed-ul e apelat din `list_events`).
    """
    monkeypatch.setattr(event_service.settings, "environment", "production")

    await event_service.seed_events(db_session)
    count = await db_session.execute(select(func.count()).select_from(Event))
    assert count.scalar_one() == 0

    user = await _make_user(db_session, "prod@example.com")
    page = await event_service.list_events(db_session, user)
    assert page.items == []

    count = await db_session.execute(select(func.count()).select_from(Event))
    assert count.scalar_one() == 0, "list_events a semănat evenimente demo în PROD"


@pytest.mark.asyncio
async def test_seed_events_still_works_in_development(db_session):
    """În dev seed-ul rămâne activ (util pentru demo/QA)."""
    user = await _make_user(db_session, "dev@example.com")
    page = await event_service.list_events(db_session, user)
    assert len(page.items) == 4


@pytest.mark.asyncio
async def test_expired_stories_are_not_returned(db_session):
    """Regresie: filtrul pe `expires_at` (acum indexat) rămâne aplicat."""
    user = await _make_user(db_session, "exp@example.com")
    await _make_profile(db_session, user, "E")
    db_session.add(
        Story(
            user_id=user.id,
            media_url="https://cdn/old.jpg",
            expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
        )
    )
    await db_session.commit()
    assert (await story_service.list_mine(db_session, user)).items == []
