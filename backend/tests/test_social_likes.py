"""Teste pentru `GET /social/likes/sent` — profilurile cărora le-am dat like.

Ecranul „Favorite" din mobil afișează DOUĂ liste: like-urile trimise (automat, din
deck) și favoritele marcate manual cu ★. Aici verificăm sursa primeia: doar
like-urile MELE, fără dislike-uri, fără blocați, fără conturi purjate, paginat.
"""
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select

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
    """Înregistrează un user, îi completează anketa și întoarce (headers, user_id)."""
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=anketa, headers=headers)
    assert resp.status_code == 200, resp.text
    # Un profil fără poze nu apare în feedul nimănui (principiu al aplicației) —
    # anketa singură nu e de ajuns. Al doilea pas, exact ca în aplicația reală:
    # PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


async def _swipe(client, headers: dict, target_user_id: str, action: str) -> None:
    """Swipe prin API-ul real (`POST /feed/swipe`), ca în aplicație."""
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": target_user_id, "action": action},
        headers=headers,
    )
    assert resp.status_code in (200, 201), resp.text


async def _likes_sent(client, headers: dict, **params) -> tuple[list, str | None]:
    """`GET /social/likes/sent` → (items, next_cursor din header)."""
    resp = await client.get(f"{API}/social/likes/sent", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return resp.json(), resp.headers.get("X-Next-Cursor")


@pytest.mark.asyncio
async def test_likes_sent_contine_doar_like_urile_mele(client):
    """Doar like-urile userului curent apar; dislike-urile și like-urile altora nu."""
    a_headers, _ = await _make_user(client, "la@example.com", _anketa(name="Ana", birth_year=_ADULT_YEAR))
    b_headers, b_id = await _make_user(client, "lb@example.com", _anketa(name="Bob", birth_year=_ADULT_YEAR))
    c_headers, c_id = await _make_user(client, "lc@example.com", _anketa(name="Cip", birth_year=_ADULT_YEAR))

    # A dă like lui B și dislike lui C.
    await _swipe(client, a_headers, b_id, "like")
    await _swipe(client, a_headers, c_id, "dislike")
    # C îi dă like lui B — like-ul ALTUIA nu are ce căuta în lista lui A.
    await _swipe(client, c_headers, b_id, "like")

    items, _ = await _likes_sent(client, a_headers)
    ids = {i["target_user_id"] for i in items}
    assert ids == {b_id}, "Doar like-ul dat de A lui B trebuie să apară."

    # Cardul are datele necesare randării (nume, vârstă, oraș, poze).
    card = items[0]
    assert card["name"] == "Bob"
    assert card["age"] > 0
    assert card["city"]
    # Pozele CHIAR ajung pe card. Înainte aserțiunea era `== []` — dar doar
    # fiindcă fixtura crea profiluri fără poze, deci nu verifica nimic din ce
    # promite comentariul de mai sus. Un profil fără poze nici n-ar mai putea fi
    # like-uit acum (nu apare în feed), deci `[]` a devenit o stare imposibilă.
    assert card["photos"], "Cardul trebuie să poarte pozele pentru randare."

    # Lista lui B e goală (n-a dat niciun like), deși A i-a dat lui.
    items_b, _ = await _likes_sent(client, b_headers)
    assert items_b == []


@pytest.mark.asyncio
async def test_likes_sent_exclude_blocatii(client):
    """Un user blocat (în orice direcție) dispare din lista de like-uri trimise."""
    a_headers, a_id = await _make_user(client, "ba1@example.com", _anketa(name="Ana", birth_year=_ADULT_YEAR))
    b_headers, b_id = await _make_user(client, "bb1@example.com", _anketa(name="Bob", birth_year=_ADULT_YEAR))
    c_headers, c_id = await _make_user(client, "bc1@example.com", _anketa(name="Cip", birth_year=_ADULT_YEAR))

    await _swipe(client, a_headers, b_id, "like")
    await _swipe(client, a_headers, c_id, "like")

    items, _ = await _likes_sent(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id, c_id}

    # A îl blochează pe B (eu → el).
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    assert resp.status_code == 201, resp.text

    # C îl blochează pe A (el → eu).
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": a_id}, headers=c_headers
    )
    assert resp.status_code == 201, resp.text

    items, _ = await _likes_sent(client, a_headers)
    assert items == [], "Blocarea în orice direcție ascunde profilul din listă."


@pytest.mark.asyncio
async def test_likes_sent_exclude_conturile_sterse(client, db_session):
    """Un cont purjat GDPR (`deleted_at` setat) nu mai apare în listă."""
    a_headers, _ = await _make_user(client, "da@example.com", _anketa(name="Ana", birth_year=_ADULT_YEAR))
    _, b_id = await _make_user(client, "db@example.com", _anketa(name="Bob", birth_year=_ADULT_YEAR))

    await _swipe(client, a_headers, b_id, "like")
    items, _ = await _likes_sent(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id}

    # Marcăm contul lui B ca purjat (ce face `purge_user_data` pe `users`).
    b_user = (
        await db_session.execute(select(User).where(User.id == uuid.UUID(b_id)))
    ).scalar_one()
    b_user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    items, _ = await _likes_sent(client, a_headers)
    assert items == [], "Un cont șters nu are ce căuta în lista de like-uri."


@pytest.mark.asyncio
async def test_likes_sent_pagineaza_pe_cursor(client, db_session):
    """`?limit=` + `X-Next-Cursor` parcurg lista fără duplicate și fără omisiuni."""
    a_headers, a_id = await _make_user(client, "pa@example.com", _anketa(name="Ana", birth_year=_ADULT_YEAR))

    # 5 ținte cu profil real; like-urile le inserăm direct (ocolim limita zilnică
    # de swipe-uri, care e o regulă de business a feed-ului, nu a listării).
    target_ids: list[str] = []
    for i in range(5):
        _, t_id = await _make_user(
            client, f"pt{i}@example.com", _anketa(name=f"Tinta{i}", birth_year=_ADULT_YEAR)
        )
        target_ids.append(t_id)
        db_session.add(
            Like(
                from_user_id=uuid.UUID(a_id),
                to_user_id=uuid.UUID(t_id),
                is_like=True,
            )
        )
    await db_session.commit()

    # Parcurgem cu pagini de câte 2 și adunăm tot.
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):  # plafon de siguranță împotriva unei bucle infinite
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        items, cursor = await _likes_sent(client, a_headers, **params)
        assert len(items) <= 2
        seen.extend(i["target_user_id"] for i in items)
        if not cursor:
            break

    assert cursor is None, "Paginarea trebuie să se termine."
    assert len(seen) == len(set(seen)), "Nicio pagină nu are voie să repete un rând."
    assert set(seen) == set(target_ids), "Toate like-urile trebuie parcurse."

    # Fără `limit`, prima pagină întoarce tot (5 < limita implicită din config).
    items, cursor = await _likes_sent(client, a_headers)
    assert len(items) == 5
    assert cursor is None
    assert SOCIAL_PAGE_LIMIT >= 5


@pytest.mark.asyncio
async def test_likes_sent_cere_autentificare(client):
    """Ruta e protejată — fără token, 401."""
    resp = await client.get(f"{API}/social/likes/sent")
    assert resp.status_code == 401, resp.text
