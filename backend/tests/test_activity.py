"""Centrul de activitate: `/notifications/activity` + `/profiles/{id}/view`.

Ce apărăm:
  - statisticile sunt corecte (vizualizări total / 7 zile, like, super like,
    dislike, match);
  - vizualizările sunt DEDUPLICATE per viewer per zi (swipe + deschidere
    repetată = o singură vizualizare) și nu se notează pe propriul profil;
  - dislike-urile apar doar ca număr — niciodată în listă, niciodată cine;
  - necititele + marcarea citit (inclusiv `up_to`, care nu pierde ce a sosit
    după încărcarea listei);
  - paginarea pe cursor nu dublează și nu pierde elemente;
  - toate rutele cer autentificare.
"""
import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.activity import ProfileView
from tests.conftest import upload_photo

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25


def _extract_token(payload: dict) -> str | None:
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
    body = {"email": email, "password": password}
    resp = await client.post(f"{API}/auth/register", json=body)
    assert resp.status_code in (200, 201), resp.text
    token = _extract_token(resp.json())
    if token is None:
        resp = await client.post(f"{API}/auth/login", json=body)
        assert resp.status_code == 200, resp.text
        token = _extract_token(resp.json())
    assert token
    return {"Authorization": f"Bearer {token}"}


def _anketa(name: str) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
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


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    await upload_photo(client, headers)
    me = await client.get(f"{API}/auth/me", headers=headers)
    return headers, me.json()["id"]


async def _swipe(client, headers: dict, target: str, action: str) -> dict:
    resp = await client.post(
        f"{API}/feed/swipe",
        json={"target_user_id": target, "action": action},
        headers=headers,
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _activity(client, headers: dict, **params) -> dict:
    resp = await client.get(
        f"{API}/notifications/activity", headers=headers, params=params
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _unread(client, headers: dict) -> int:
    resp = await client.get(f"{API}/notifications/activity/unread", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["unread"]


async def _scenario(client):
    """A primește: like (B), super like (C), dislike (D), like (E) + match cu E."""
    a_h, a_id = await _make_user(client, "act-a@example.com", "Ana")
    b_h, b_id = await _make_user(client, "act-b@example.com", "Bogdan")
    c_h, c_id = await _make_user(client, "act-c@example.com", "Cezar")
    d_h, d_id = await _make_user(client, "act-d@example.com", "Dorin")
    e_h, e_id = await _make_user(client, "act-e@example.com", "Eugen")

    await _swipe(client, b_h, a_id, "like")
    await _swipe(client, c_h, a_id, "super_like")
    await _swipe(client, d_h, a_id, "dislike")
    await _swipe(client, e_h, a_id, "like")
    result = await _swipe(client, a_h, e_id, "like")
    assert result["matched"] is True
    return {
        "a": (a_h, a_id),
        "b": (b_h, b_id),
        "c": (c_h, c_id),
        "d": (d_h, d_id),
        "e": (e_h, e_id),
        "chat_id": result["chat_id"],
    }


@pytest.mark.asyncio
async def test_rutele_cer_autentificare(client):
    assert (await client.get(f"{API}/notifications/activity")).status_code == 401
    assert (await client.get(f"{API}/notifications/activity/unread")).status_code == 401
    assert (await client.post(f"{API}/notifications/activity/read")).status_code == 401
    target = uuid.uuid4()
    assert (await client.post(f"{API}/profiles/{target}/view")).status_code == 401


@pytest.mark.asyncio
async def test_statistici_corecte(client):
    s = await _scenario(client)
    a_h, _ = s["a"]

    page = await _activity(client, a_h)
    assert page["stats"] == {
        # Fiecare swipe spre A (B, C, D, E) = A le-a apărut în feed.
        "views_total": 4,
        "views_last_7_days": 4,
        "likes": 2,  # B + E
        "super_likes": 1,  # C
        "dislikes": 1,  # D
        "matches": 1,  # E
    }

    # Pentru E: o vizualizare (A l-a swipe-uit), un like (A), un match.
    e_page = await _activity(client, s["e"][0])
    assert e_page["stats"]["views_total"] == 1
    assert e_page["stats"]["likes"] == 1
    assert e_page["stats"]["matches"] == 1
    assert e_page["stats"]["dislikes"] == 0


@pytest.mark.asyncio
async def test_lista_cronologica_fara_dislike(client):
    s = await _scenario(client)
    a_h, _ = s["a"]
    _, c_id = s["c"]
    _, d_id = s["d"]
    _, e_id = s["e"]

    page = await _activity(client, a_h)
    kinds = [item["kind"] for item in page["items"]]
    # match (cel mai nou; la același moment cu like-ul care l-a produs, deasupra),
    # like-urile, super like-ul și ziua de vizualizări — fără dislike.
    assert kinds[0] == "match"
    assert sorted(kinds) == sorted(["match", "like", "like", "super_like", "views"])

    match = page["items"][0]
    assert match["actor"]["user_id"] == e_id
    assert match["actor"]["name"] == "Eugen"
    assert match["actor"]["photo"]
    assert match["chat_id"] == s["chat_id"]

    sup = next(i for i in page["items"] if i["kind"] == "super_like")
    assert sup["actor"]["user_id"] == c_id

    views = next(i for i in page["items"] if i["kind"] == "views")
    assert views["count"] == 4
    assert views["actor"] is None, "Vizualizările sunt agregate: niciodată cine."

    # Autorul dislike-ului nu apare NICĂIERI în răspuns.
    assert d_id not in str(page)
    # Ordine descrescătoare pe moment.
    moments = [item["occurred_at"] for item in page["items"]]
    assert moments == sorted(moments, reverse=True)


@pytest.mark.asyncio
async def test_vizualizari_deduplicate_per_zi(client, db_session):
    a_h, a_id = await _make_user(client, "dv-a@example.com", "Ana")
    b_h, b_id = await _make_user(client, "dv-b@example.com", "Bogdan")

    # Deschidere de detaliu de două ori + swipe în aceeași zi = O vizualizare.
    for _ in range(2):
        resp = await client.post(f"{API}/profiles/{a_id}/view", headers=b_h)
        assert resp.status_code == 204
    await _swipe(client, b_h, a_id, "dislike")

    count = await db_session.scalar(
        select(func.count(ProfileView.id)).where(ProfileView.viewed_id == a_id)
    )
    assert count == 1
    page = await _activity(client, a_h)
    assert page["stats"]["views_total"] == 1

    # Propriul profil și un id inexistent: 204, dar nimic notat (fără oracol).
    assert (await client.post(f"{API}/profiles/{a_id}/view", headers=a_h)).status_code == 204
    ghost = uuid.uuid4()
    assert (await client.post(f"{API}/profiles/{ghost}/view", headers=a_h)).status_code == 204
    total = await db_session.scalar(select(func.count(ProfileView.id)))
    assert total == 1


@pytest.mark.asyncio
async def test_vizualizare_ignorata_daca_e_block(client, db_session):
    a_h, a_id = await _make_user(client, "bv-a@example.com", "Ana")
    b_h, _ = await _make_user(client, "bv-b@example.com", "Bogdan")
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": a_id}, headers=b_h
    )
    assert resp.status_code == 201
    assert (await client.post(f"{API}/profiles/{a_id}/view", headers=b_h)).status_code == 204
    total = await db_session.scalar(select(func.count(ProfileView.id)))
    assert total == 0


@pytest.mark.asyncio
async def test_necitite_si_marcare_citit(client):
    s = await _scenario(client)
    a_h, a_id = s["a"]

    # like B + super C + like E + match E + o zi de vizualizări = 5.
    assert await _unread(client, a_h) == 5
    page = await _activity(client, a_h)
    assert page["unread"] == 5
    assert all(item["is_read"] is False for item in page["items"])

    resp = await client.post(f"{API}/notifications/activity/read", headers=a_h)
    assert resp.status_code == 200
    assert resp.json() == {"unread": 0}
    page = await _activity(client, a_h)
    assert all(item["is_read"] is True for item in page["items"])

    # Un like NOU după citire → exact 1 necitit (și ziua de vizualizări redevine nouă).
    f_h, _ = await _make_user(client, "act-f@example.com", "Filip")
    await _swipe(client, f_h, a_id, "like")
    assert await _unread(client, a_h) == 2
    page = await _activity(client, a_h)
    unread = [i["kind"] for i in page["items"] if not i["is_read"]]
    assert sorted(unread) == ["like", "views"]


@pytest.mark.asyncio
async def test_marcare_up_to_nu_pierde_ce_a_sosit_dupa(client):
    s = await _scenario(client)
    a_h, a_id = s["a"]
    page = await _activity(client, a_h)
    newest = page["items"][0]["occurred_at"]

    # Sosește un like DUPĂ ce lista a fost afișată.
    f_h, _ = await _make_user(client, "late-f@example.com", "Filip")
    await _swipe(client, f_h, a_id, "like")

    resp = await client.post(
        f"{API}/notifications/activity/read", json={"up_to": newest}, headers=a_h
    )
    assert resp.status_code == 200
    # Like-ul lui F + ziua de vizualizări (F a văzut profilul după `newest`).
    assert resp.json()["unread"] == 2

    # Semnul nu se mută înapoi: un `up_to` mai vechi nu reînvie necitite.
    resp = await client.post(
        f"{API}/notifications/activity/read",
        json={"up_to": "2000-01-01T00:00:00+00:00"},
        headers=a_h,
    )
    assert resp.json()["unread"] == 2

    # Corp invalid (cheie necunoscută) → 422.
    resp = await client.post(
        f"{API}/notifications/activity/read", json={"foo": 1}, headers=a_h
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_paginare_fara_duplicate_si_cursor_invalid(client):
    s = await _scenario(client)
    a_h, _ = s["a"]
    full = await _activity(client, a_h)
    expected = [item["id"] for item in full["items"]]
    assert len(expected) == 5

    seen: list[str] = []
    cursor = None
    pages = 0
    while True:
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = await _activity(client, a_h, **params)
        pages += 1
        if pages > 1:
            assert page["stats"] is None, "Statisticile vin doar pe prima pagină."
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if not cursor:
            break
        assert pages < 10
    assert seen == expected

    resp = await client.get(
        f"{API}/notifications/activity",
        headers=a_h,
        params={"cursor": "nu-e-un-cursor"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_like_de_la_user_blocat_dispare_din_lista(client):
    s = await _scenario(client)
    a_h, _ = s["a"]
    _, b_id = s["b"]
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_h
    )
    assert resp.status_code == 201
    page = await _activity(client, a_h)
    actors = {i["actor"]["user_id"] for i in page["items"] if i["actor"]}
    assert b_id not in actors
    # Statisticile rămân totaluri brute: like-ul a existat.
    assert page["stats"]["likes"] == 2
