"""Profilul partenerului din chat + avatarul (poza proprie / poza din Telegram).

Acoperă:
  * `GET /chats/{id}/partner` — doar participanții (străin → 404), block în
    oricare direcție → 403, fără date private (stradă, dată de naștere);
  * avatarul din lista de chat (`other_photo_url`) și din profilul partenerului:
    poza proprie are MEREU prioritate; fără poze proprii → poza din Telegram.
"""
import uuid

import pytest
from sqlalchemy import update

from app.models.profile import Profile
from app.models.user import User
from tests.test_chat import API, _chat_id_for, _make_user, _matched_pair


TG_PHOTO = "https://t.me/i/userpic/320/abcdef.jpg"


async def _set_user(db_session, user_id: str, **values) -> None:
    await db_session.execute(
        update(User).where(User.id == uuid.UUID(user_id)).values(**values)
    )
    await db_session.commit()
    db_session.expire_all()


async def _clear_photos(db_session, user_id: str) -> None:
    await db_session.execute(
        update(Profile).where(Profile.user_id == uuid.UUID(user_id)).values(photos=[])
    )
    await db_session.commit()
    db_session.expire_all()


async def test_partner_profile_returns_public_data(client):
    (a_headers, _), (_, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.get(f"{API}/chats/{chat_id}/partner", headers=a_headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["user_id"] == b_id
    assert data["name"] == "Bob"
    assert data["age"] >= 18
    assert data["city"] == "Chișinău"
    assert data["about"] == "Salut, sunt Bob."
    assert data["interests"] == ["sport", "travel"]
    assert data["languages"] == ["ru", "ro"]
    assert data["height_cm"] == 180
    assert data["photos"], "pozele proprii trebuie întoarse"
    assert data["avatar_url"] == data["photos"][0]
    assert 0 <= data["compatibility"] <= 100
    # Nimic privat: fără stradă, dată de naștere, email.
    for private in ("street", "birth_date", "email", "lat", "lng"):
        assert private not in data


async def test_partner_profile_works_both_ways(client):
    (_, a_id), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, b_headers)
    resp = await client.get(f"{API}/chats/{chat_id}/partner", headers=b_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["user_id"] == a_id
    assert resp.json()["name"] == "Alice"


async def test_outsider_cannot_see_partner_profile(client):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    outsider_headers, _ = await _make_user(client, "c@example.com", "Carol")

    resp = await client.get(f"{API}/chats/{chat_id}/partner", headers=outsider_headers)
    assert resp.status_code == 404


async def test_unknown_chat_returns_404(client):
    (a_headers, _), _ = await _matched_pair(client)
    resp = await client.get(f"{API}/chats/{uuid.uuid4()}/partner", headers=a_headers)
    assert resp.status_code == 404


async def test_partner_profile_requires_auth(client):
    resp = await client.get(f"{API}/chats/{uuid.uuid4()}/partner")
    assert resp.status_code in (401, 403)


@pytest.mark.parametrize("blocker", ["a", "b"])
async def test_block_in_any_direction_hides_partner_profile(client, blocker):
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    if blocker == "a":
        resp = await client.post(
            f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
        )
    else:
        resp = await client.post(
            f"{API}/social/blocks", json={"target_user_id": a_id}, headers=b_headers
        )
    assert resp.status_code in (200, 201, 204), resp.text

    resp = await client.get(f"{API}/chats/{chat_id}/partner", headers=a_headers)
    assert resp.status_code in (403, 404)


async def test_banned_partner_is_not_found(client, db_session):
    (a_headers, _), (_, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    from datetime import datetime, timezone

    await _set_user(db_session, b_id, banned_at=datetime.now(timezone.utc))
    resp = await client.get(f"{API}/chats/{chat_id}/partner", headers=a_headers)
    assert resp.status_code == 404


async def test_chat_list_avatar_is_own_first_photo(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    own = (await client.get(f"{API}/profiles/me", headers=b_headers)).json()["photos"]

    chats = (await client.get(f"{API}/chats/", headers=a_headers)).json()
    assert chats[0]["other_photo_url"] == own[0]


async def test_own_photos_beat_telegram_photo(client, db_session):
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    await _set_user(db_session, b_id, telegram_photo_url=TG_PHOTO)
    own = (await client.get(f"{API}/profiles/me", headers=b_headers)).json()["photos"]

    chats = (await client.get(f"{API}/chats/", headers=a_headers)).json()
    assert chats[0]["other_photo_url"] == own[0]
    chat_id = chats[0]["chat_id"]
    partner = (await client.get(f"{API}/chats/{chat_id}/partner", headers=a_headers)).json()
    assert partner["photos"] == own
    assert TG_PHOTO not in partner["photos"]


async def test_telegram_photo_is_fallback_without_own_photos(client, db_session):
    (a_headers, _), (_, b_id) = await _matched_pair(client)
    await _clear_photos(db_session, b_id)
    await _set_user(db_session, b_id, telegram_photo_url=TG_PHOTO)

    chats = (await client.get(f"{API}/chats/", headers=a_headers)).json()
    assert chats[0]["other_photo_url"] == TG_PHOTO
    partner = (
        await client.get(f"{API}/chats/{chats[0]['chat_id']}/partner", headers=a_headers)
    ).json()
    assert partner["photos"] == [TG_PHOTO]
    assert partner["avatar_url"] == TG_PHOTO


async def test_no_photos_at_all_means_no_avatar(client, db_session):
    (a_headers, _), (_, b_id) = await _matched_pair(client)
    await _clear_photos(db_session, b_id)

    chats = (await client.get(f"{API}/chats/", headers=a_headers)).json()
    assert chats[0]["other_photo_url"] is None
    partner = (
        await client.get(f"{API}/chats/{chats[0]['chat_id']}/partner", headers=a_headers)
    ).json()
    assert partner["photos"] == []
    assert partner["avatar_url"] is None
