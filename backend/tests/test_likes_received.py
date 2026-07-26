"""Teste pentru `GET /social/likes/received` — cine mi-a dat MIE like.

Inbox-ul de „cereri": userii care MI-AU DAT MIE like (normal sau super) și la care
ÎNCĂ nu am răspuns (nici like reciproc — ar fi deja match —, nici dislike). Din el
deschid ancheta persoanei și răspund cu `POST /feed/swipe` → match + chat, iar
AMBELE mesaje deferred (al lui + al meu) ajung în conversație.
"""
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

from app.models.chat import Chat, Message
from app.models.swipe import Like
from app.models.user import User
from app.services.pagination import SOCIAL_PAGE_LIMIT
from tests.conftest import upload_photo

API = "/api/v1"

# An determinist pentru un profil adult (~25 ani) — aplicația e 18+ only.
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
    """Extrage un access token din răspunsuri de forme uzuale."""
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
    """Înregistrează un user și întoarce headerele cu Bearer token."""
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    if token is None:
        resp = await client.post(f"{API}/auth/login", json=body)
        assert resp.status_code == 200, resp.text
        token = _extract_token(resp.json())
    assert token, "Nu am putut obține un access token."
    return {"Authorization": f"Bearer {token}"}


async def _me_id(client, headers: dict) -> str:
    """Id-ul userului curent."""
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(*, name: str, birth_year: int = _ADULT_YEAR) -> dict:
    """O anketă validă minimă pentru completarea profilului."""
    return {
        "name": name,
        "birth_date": date(birth_year, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "street": None,
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport"],
        "photos": [],
    }


async def _make_user(client, email: str, anketa: dict) -> tuple[dict, str]:
    """Înregistrează un user, îi completează anketa (+poză) și întoarce (headers, id)."""
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=anketa, headers=headers)
    assert resp.status_code == 200, resp.text
    # Fără poză nu apare în feed → n-ar putea fi like-uit; al doilea pas ca-n app.
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


async def _swipe(
    client, headers: dict, target_user_id: str, action: str, message: str | None = None
) -> dict:
    """Swipe prin API-ul real (`POST /feed/swipe`), cu mesaj opțional la like."""
    body: dict = {"target_user_id": target_user_id, "action": action}
    if message is not None:
        body["message"] = message
    resp = await client.post(f"{API}/feed/swipe", json=body, headers=headers)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _received(client, headers: dict, **params) -> tuple[list, str | None]:
    """`GET /social/likes/received` → (items, next_cursor din header)."""
    resp = await client.get(
        f"{API}/social/likes/received", headers=headers, params=params
    )
    assert resp.status_code == 200, resp.text
    return resp.json(), resp.headers.get("X-Next-Cursor")


@pytest.mark.asyncio
async def test_like_primit_apare_cu_profil_si_fara_mesaj(client):
    """(1) Un like fără mesaj apare la destinatar cu cardul de anketă complet."""
    x_headers, x_id = await _make_user(client, "rx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "ry@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "like")

    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id}
    item = items[0]
    assert item["is_super"] is False
    assert item["message"] is None
    assert item["created_at"], "Fiecare cerere poartă momentul like-ului."
    profile = item["profile"]
    assert profile["name"] == "Xenia"
    assert profile["age"] > 0
    assert profile["gender"] == "male"
    assert profile["city"]
    assert profile["about"]
    assert profile["photos"], "Cardul trebuie să poarte pozele pentru randare."


@pytest.mark.asyncio
async def test_like_primit_cu_mesaj_expune_mesajul_autorului(client):
    """(1) Un like CU mesaj → destinatarul vede mesajul autorului (cererea)."""
    x_headers, _ = await _make_user(client, "rmx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rmy@example.com", _anketa(name="Yan"))

    msg = "Salut, mi-a plăcut profilul tău!"
    await _swipe(client, x_headers, y_id, "like", message=msg)

    items, _ = await _received(client, y_headers)
    assert len(items) == 1
    assert items[0]["message"] == msg


@pytest.mark.asyncio
async def test_super_like_primit_expune_is_super(client):
    """(1) Un super like primit poartă `is_super=True` (badge pe mobil)."""
    x_headers, x_id = await _make_user(client, "rsx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rsy@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "super_like")

    items, _ = await _received(client, y_headers)
    assert len(items) == 1
    assert items[0]["user_id"] == x_id
    assert items[0]["is_super"] is True


@pytest.mark.asyncio
async def test_mesajul_primit_e_mascat_de_contacte(client):
    """(1) Datele de contact din mesajul autorului sunt mascate (TZ 5.5).

    Fără mascare, un like cu telefon/telegram ar livra contactul destinatarului
    ÎNAINTE de orice match, ocolind exact filtrul aplicat la livrarea în chat.
    """
    x_headers, _ = await _make_user(client, "rcx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rcy@example.com", _anketa(name="Yan"))

    await _swipe(
        client, x_headers, y_id, "like", message="scrie-mi pe telegram ionpopescu"
    )

    items, _ = await _received(client, y_headers)
    assert len(items) == 1
    shown = items[0]["message"]
    assert "ionpopescu" not in shown, "Contactul din mesaj trebuie mascat."
    assert "****" in shown


@pytest.mark.asyncio
async def test_dislike_primit_nu_apare(client):
    """(1) Un dislike primit (swipe stânga spre mine) NU e o cerere de like."""
    x_headers, _ = await _make_user(client, "rdx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rdy@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "dislike")

    items, _ = await _received(client, y_headers)
    assert items == [], "Un dislike nu apare în like-urile primite."


@pytest.mark.asyncio
async def test_dupa_ce_raspund_cu_dislike_dispare(client):
    """(1) Dacă am răspuns deja (dislike), autorul iese din cereri."""
    x_headers, x_id = await _make_user(client, "rrx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rry@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "like")
    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id}

    # Y răspunde cu dislike → a reacționat, deci cererea dispare din inbox.
    await _swipe(client, y_headers, x_id, "dislike")
    items, _ = await _received(client, y_headers)
    assert items == [], "După ce am reacționat, autorul nu mai e o cerere deschisă."


@pytest.mark.asyncio
async def test_raspuns_cu_like_creeaza_match_chat_si_ambele_mesaje(client, db_session):
    """(2) Răspund cu like+mesaj → match + chat, AMBELE mesaje deferred în chat.

    X îmi dă like cu mesajul lui; eu (Y) răspund cu `POST /feed/swipe` like + mesajul
    meu. Se creează match + chat, iar în conversație ajung ambele mesaje. După asta,
    X dispare din cererile mele (am răspuns), iar Y dispare din ale lui X (match).
    """
    x_headers, x_id = await _make_user(client, "rmatx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rmaty@example.com", _anketa(name="Yan"))

    msg_x = "Mesajul lui X, trimis la like."
    msg_y = "Mesajul lui Y, trimis la răspuns."

    await _swipe(client, x_headers, y_id, "like", message=msg_x)

    # Y vede cererea lui X, apoi răspunde cu like + mesaj propriu.
    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id}

    result = await _swipe(client, y_headers, x_id, "like", message=msg_y)
    assert result.get("matched") is True
    chat_id = result.get("chat_id")
    assert chat_id, "Match-ul trebuie să producă un chat imediat."

    # Ambele mesaje deferred au ajuns în chat.
    chat = (
        await db_session.execute(select(Chat).where(Chat.id == uuid.UUID(chat_id)))
    ).scalar_one()
    msgs = (
        await db_session.execute(
            select(Message).where(Message.chat_id == chat.id)
        )
    ).scalars().all()
    bodies = {m.body for m in msgs}
    assert msg_x in bodies, "Mesajul autorului (X) trebuie livrat la match."
    assert msg_y in bodies, "Mesajul celui care răspunde (Y) trebuie livrat la match."

    # X a devenit match → dispare din cererile lui Y (Y a răspuns cu like).
    items_y, _ = await _received(client, y_headers)
    assert items_y == [], "După răspunsul cu like, cererea devine match și dispare."
    # Simetric: Y nu apare în cererile lui X (X a răspuns primul, dând like).
    items_x, _ = await _received(client, x_headers)
    assert items_x == [], "Autorul care a dat primul like nu are cererea celuilalt."


@pytest.mark.asyncio
async def test_blocatii_nu_apar_in_received(client):
    """(1) Un autor blocat (în orice direcție) dispare din cereri."""
    x_headers, x_id = await _make_user(client, "rbx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rby@example.com", _anketa(name="Yan"))
    z_headers, z_id = await _make_user(client, "rbz@example.com", _anketa(name="Zoe"))

    await _swipe(client, x_headers, y_id, "like")
    await _swipe(client, z_headers, y_id, "like")
    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id, z_id}

    # Y îl blochează pe X (eu → el).
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": x_id}, headers=y_headers
    )
    assert resp.status_code == 201, resp.text
    # Z îl blochează pe Y (el → eu).
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": y_id}, headers=z_headers
    )
    assert resp.status_code == 201, resp.text

    items, _ = await _received(client, y_headers)
    assert items == [], "Blocarea în orice direcție ascunde autorul din cereri."


@pytest.mark.asyncio
async def test_autor_ascuns_nu_apare(client):
    """(1) Un autor cu profilul ascuns (`profile_hidden`) nu apare în cereri."""
    x_headers, x_id = await _make_user(client, "rhx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rhy@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "like")
    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id}

    resp = await client.put(
        f"{API}/settings/", json={"profile_hidden": True}, headers=x_headers
    )
    assert resp.status_code == 200, resp.text

    items, _ = await _received(client, y_headers)
    assert items == [], "Un profil ascuns nu apare în cererile primite."


@pytest.mark.asyncio
async def test_autor_sters_nu_apare(client, db_session):
    """(1) Un cont purjat GDPR (`deleted_at`) al autorului dispare din cereri."""
    x_headers, x_id = await _make_user(client, "rsdx@example.com", _anketa(name="Xenia"))
    y_headers, y_id = await _make_user(client, "rsdy@example.com", _anketa(name="Yan"))

    await _swipe(client, x_headers, y_id, "like")
    items, _ = await _received(client, y_headers)
    assert {i["user_id"] for i in items} == {x_id}

    x_user = (
        await db_session.execute(select(User).where(User.id == uuid.UUID(x_id)))
    ).scalar_one()
    x_user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    items, _ = await _received(client, y_headers)
    assert items == [], "Un cont șters nu are ce căuta în cererile primite."


@pytest.mark.asyncio
async def test_received_pagineaza_pe_cursor(client, db_session):
    """(1) `?limit=` + `X-Next-Cursor` parcurg lista fără duplicate/omisiuni."""
    y_headers, y_id = await _make_user(client, "rpy@example.com", _anketa(name="Yan"))

    # 5 autori cu profil real; like-urile spre Y le inserăm direct (ocolim limita
    # zilnică de swipe-uri, care e o regulă a feed-ului, nu a listării).
    liker_ids: list[str] = []
    for i in range(5):
        _, l_id = await _make_user(
            client, f"rpl{i}@example.com", _anketa(name=f"Liker{i}")
        )
        liker_ids.append(l_id)
        db_session.add(
            Like(
                from_user_id=uuid.UUID(l_id),
                to_user_id=uuid.UUID(y_id),
                is_like=True,
            )
        )
    await db_session.commit()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):  # plafon de siguranță împotriva unei bucle infinite
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        items, cursor = await _received(client, y_headers, **params)
        assert len(items) <= 2
        seen.extend(i["user_id"] for i in items)
        if not cursor:
            break

    assert cursor is None, "Paginarea trebuie să se termine."
    assert len(seen) == len(set(seen)), "Nicio pagină nu are voie să repete un rând."
    assert set(seen) == set(liker_ids), "Toate cererile primite parcurse."

    # Fără `limit`, prima pagină întoarce tot (5 < limita implicită din config).
    items, cursor = await _received(client, y_headers)
    assert len(items) == 5
    assert cursor is None
    assert SOCIAL_PAGE_LIMIT >= 5


@pytest.mark.asyncio
async def test_received_cere_autentificare(client):
    """(1) Ruta e protejată — fără token, 401."""
    resp = await client.get(f"{API}/social/likes/received")
    assert resp.status_code == 401, resp.text
