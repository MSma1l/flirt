"""Teste pentru `GET /social/likes/pending` — like-urile mele „în așteptare".

„În așteptare" = profiluri cărora LE-AM DAT like (normal sau super), dar care ÎNCĂ
nu mi-au dat like înapoi, deci NU-s încă match. Când îmi dau like, perechea devine
match și trece în chaturi → dispare de aici. Diferența față de `/likes/sent`
(care întoarce TOATE like-urile mele) e tocmai excluderea match-urilor.
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


async def _pending(client, headers: dict, **params) -> tuple[list, str | None]:
    """`GET /social/likes/pending` → (items, next_cursor din header)."""
    resp = await client.get(
        f"{API}/social/likes/pending", headers=headers, params=params
    )
    assert resp.status_code == 200, resp.text
    return resp.json(), resp.headers.get("X-Next-Cursor")


@pytest.mark.asyncio
async def test_like_fara_reciproc_apare_in_pending(client):
    """(a) Un like dat, ÎNCĂ neîntors, apare în „în așteptare" cu date de card."""
    a_headers, _ = await _make_user(client, "pena@example.com", _anketa(name="Ana"))
    _, b_id = await _make_user(client, "penb@example.com", _anketa(name="Bob"))

    await _swipe(client, a_headers, b_id, "like")

    items, _ = await _pending(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id}
    card = items[0]
    assert card["name"] == "Bob"
    assert card["age"] > 0
    assert card["city"]
    assert card["photos"], "Cardul trebuie să poarte pozele pentru randare."
    # Like normal fără mesaj: fără badge de super, fără mesaj propriu.
    assert card["is_super"] is False
    assert card["my_message"] is None


@pytest.mark.asyncio
async def test_dupa_match_dispare_din_pending(client):
    """(b) Când celălalt dă like înapoi (match), profilul iese din așteptare."""
    a_headers, a_id = await _make_user(client, "pma@example.com", _anketa(name="Ana"))
    b_headers, b_id = await _make_user(client, "pmb@example.com", _anketa(name="Bob"))

    # A dă like lui B → în așteptare.
    await _swipe(client, a_headers, b_id, "like")
    items, _ = await _pending(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id}

    # B dă like lui A → devine match. Confirmăm din răspunsul swipe-ului.
    result = await _swipe(client, b_headers, a_id, "like")
    assert result.get("matched") is True

    # Pentru AMBII, perechea a trecut în chaturi, deci nu mai e „în așteptare".
    items_a, _ = await _pending(client, a_headers)
    assert items_a == [], "Match-ul dispare din pending-ul autorului."
    items_b, _ = await _pending(client, b_headers)
    assert items_b == [], "Match-ul dispare și din pending-ul celuilalt."


@pytest.mark.asyncio
async def test_dislike_nu_apare_in_pending(client):
    """(c) Un dislike nu e un like → nu apare în așteptare."""
    a_headers, _ = await _make_user(client, "pda@example.com", _anketa(name="Ana"))
    _, b_id = await _make_user(client, "pdb@example.com", _anketa(name="Bob"))
    _, c_id = await _make_user(client, "pdc@example.com", _anketa(name="Cip"))

    await _swipe(client, a_headers, b_id, "like")
    await _swipe(client, a_headers, c_id, "dislike")

    items, _ = await _pending(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id}


@pytest.mark.asyncio
async def test_blocatii_nu_apar_in_pending(client):
    """(d) Un user blocat (în orice direcție) dispare din așteptare."""
    a_headers, a_id = await _make_user(client, "pba@example.com", _anketa(name="Ana"))
    b_headers, b_id = await _make_user(client, "pbb@example.com", _anketa(name="Bob"))
    c_headers, c_id = await _make_user(client, "pbc@example.com", _anketa(name="Cip"))

    await _swipe(client, a_headers, b_id, "like")
    await _swipe(client, a_headers, c_id, "like")
    items, _ = await _pending(client, a_headers)
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

    items, _ = await _pending(client, a_headers)
    assert items == [], "Blocarea în orice direcție ascunde profilul din așteptare."


@pytest.mark.asyncio
async def test_conturile_sterse_nu_apar_in_pending(client, db_session):
    """Un cont purjat GDPR (`deleted_at`) nu mai apare în așteptare."""
    a_headers, _ = await _make_user(client, "psa@example.com", _anketa(name="Ana"))
    _, b_id = await _make_user(client, "psb@example.com", _anketa(name="Bob"))

    await _swipe(client, a_headers, b_id, "like")
    items, _ = await _pending(client, a_headers)
    assert {i["target_user_id"] for i in items} == {b_id}

    b_user = (
        await db_session.execute(select(User).where(User.id == uuid.UUID(b_id)))
    ).scalar_one()
    b_user.deleted_at = datetime.now(timezone.utc)
    await db_session.commit()

    items, _ = await _pending(client, a_headers)
    assert items == [], "Un cont șters nu are ce căuta în așteptare."


@pytest.mark.asyncio
async def test_super_like_cu_mesaj_expune_is_super_si_my_message(client):
    """(e)+(g) Super like cu mesaj → apare cu `is_super=True` și mesajul MEU."""
    a_headers, _ = await _make_user(client, "psua@example.com", _anketa(name="Ana"))
    _, b_id = await _make_user(client, "psub@example.com", _anketa(name="Bob"))

    msg = "Salut, mi-a plăcut profilul tău!"
    await _swipe(client, a_headers, b_id, "super_like", message=msg)

    items, _ = await _pending(client, a_headers)
    assert len(items) == 1
    card = items[0]
    assert card["target_user_id"] == b_id
    assert card["is_super"] is True, "Super like → badge de super."
    # Mesajul e AL MEU (autorul), deci am voie să-l văd în lista mea.
    assert card["my_message"] == msg


@pytest.mark.asyncio
async def test_mesajul_nu_e_expus_destinatarului(client):
    """Mesajul deferred rămâne al autorului; destinatarul nu-l vede prin pending.

    B nu i-a dat like lui A, deci pending-ul lui B e gol — nicăieri mesajul lui A
    nu ajunge la B înainte de match.
    """
    a_headers, _ = await _make_user(client, "pmxa@example.com", _anketa(name="Ana"))
    b_headers, b_id = await _make_user(client, "pmxb@example.com", _anketa(name="Bob"))

    await _swipe(client, a_headers, b_id, "like", message="secret pentru match")

    items_b, _ = await _pending(client, b_headers)
    assert items_b == [], "Destinatarul nu vede mesajul autorului în pending."


@pytest.mark.asyncio
async def test_pending_pagineaza_pe_cursor(client, db_session):
    """(f) `?limit=` + `X-Next-Cursor` parcurg lista fără duplicate/omisiuni."""
    a_headers, a_id = await _make_user(client, "ppa@example.com", _anketa(name="Ana"))

    # 5 ținte cu profil real; like-urile le inserăm direct (ocolim limita zilnică
    # de swipe-uri, care e o regulă a feed-ului, nu a listării). Niciuna nu dă
    # like înapoi → toate rămân „în așteptare".
    target_ids: list[str] = []
    for i in range(5):
        _, t_id = await _make_user(
            client, f"ppt{i}@example.com", _anketa(name=f"Tinta{i}")
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

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):  # plafon de siguranță împotriva unei bucle infinite
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        items, cursor = await _pending(client, a_headers, **params)
        assert len(items) <= 2
        seen.extend(i["target_user_id"] for i in items)
        if not cursor:
            break

    assert cursor is None, "Paginarea trebuie să se termine."
    assert len(seen) == len(set(seen)), "Nicio pagină nu are voie să repete un rând."
    assert set(seen) == set(target_ids), "Toate like-urile în așteptare parcurse."

    # Fără `limit`, prima pagină întoarce tot (5 < limita implicită din config).
    items, cursor = await _pending(client, a_headers)
    assert len(items) == 5
    assert cursor is None
    assert SOCIAL_PAGE_LIMIT >= 5


@pytest.mark.asyncio
async def test_pending_cere_autentificare(client):
    """Ruta e protejată — fără token, 401."""
    resp = await client.get(f"{API}/social/likes/pending")
    assert resp.status_code == 401, resp.text
