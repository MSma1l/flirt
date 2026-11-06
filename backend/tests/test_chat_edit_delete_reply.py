"""Teste pentru editarea, ștergerea (pentru toți) și răspunsul la mesaje din chat."""
import uuid

import pytest

from app.services import storage
from app.services.contact_masker import MASK
from tests.test_chat import API, _chat_id_for, _make_user, _matched_pair
from tests.test_chat_attachments import _jpeg_with_gps, _post, media_dir  # noqa: F401


# --- Helperi -----------------------------------------------------------------
async def _send(client, chat_id, headers, body, reply_to_id=None):
    payload = {"body": body}
    if reply_to_id is not None:
        payload["reply_to_id"] = reply_to_id
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages", json=payload, headers=headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _edit(client, chat_id, msg_id, headers, body):
    return await client.patch(
        f"{API}/chats/{chat_id}/messages/{msg_id}", json={"body": body}, headers=headers
    )


async def _delete(client, chat_id, msg_id, headers):
    return await client.delete(f"{API}/chats/{chat_id}/messages/{msg_id}", headers=headers)


async def _listing(client, chat_id, headers):
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=headers)
    assert resp.status_code == 200, resp.text
    return {m["id"]: m for m in resp.json()}


# --- Editare -----------------------------------------------------------------
@pytest.mark.asyncio
async def test_edit_own_text_masks_and_sets_edited_at(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    assert msg["edited_at"] is None
    assert msg["is_deleted"] is False
    assert msg["reply_to"] is None

    resp = await _edit(client, chat_id, msg["id"], a_headers, "scrie-mi pe telegram @ionel_92")
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["id"] == msg["id"]
    assert out["was_masked"] is True
    assert "ionel_92" not in out["body"]
    assert MASK in out["body"]
    assert out["edited_at"] is not None

    # Partenerul vede varianta editată.
    seen = (await _listing(client, chat_id, b_headers))[msg["id"]]
    assert seen["body"] == out["body"]
    assert seen["edited_at"] is not None

    # Același text → neschimbat (edited_at rămâne cel de dinainte).
    resp = await _edit(client, chat_id, msg["id"], a_headers, "scrie-mi pe telegram @ionel_92")
    assert resp.status_code == 200, resp.text
    assert resp.json()["edited_at"] == out["edited_at"]

    # Text curat → mascarea dispare.
    resp = await _edit(client, chat_id, msg["id"], a_headers, "bună")
    assert resp.json()["body"] == "bună"
    assert resp.json()["was_masked"] is False


@pytest.mark.asyncio
async def test_edit_unchanged_body_keeps_edited_at_null(client):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    resp = await _edit(client, chat_id, msg["id"], a_headers, "  salut  ")
    assert resp.status_code == 200, resp.text
    assert resp.json()["edited_at"] is None


@pytest.mark.asyncio
async def test_edit_validation_and_permissions(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")

    # Mesajul altuia → 403.
    resp = await _edit(client, chat_id, msg["id"], b_headers, "hack")
    assert resp.status_code == 403, resp.text
    # Corp gol / HTML → 422 (aceleași reguli ca la trimitere).
    assert (await _edit(client, chat_id, msg["id"], a_headers, "   ")).status_code == 422
    assert (await _edit(client, chat_id, msg["id"], a_headers, "<b>x</b>")).status_code == 422
    # Străin de chat → 404; mesaj inexistent → 404.
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")
    assert (await _edit(client, chat_id, msg["id"], c_headers, "x")).status_code == 404
    assert (await _edit(client, chat_id, uuid.uuid4(), a_headers, "x")).status_code == 404


@pytest.mark.asyncio
async def test_edit_in_blocked_chat_forbidden(client):
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    resp = await client.post(
        f"{API}/social/blocks", json={"target_user_id": b_id}, headers=a_headers
    )
    assert resp.status_code == 201, resp.text

    assert (await _edit(client, chat_id, msg["id"], a_headers, "x")).status_code == 403
    # Ștergerea propriului mesaj rămâne permisă (nivel de citire).
    resp = await _delete(client, chat_id, msg["id"], a_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_deleted"] is True


@pytest.mark.asyncio
async def test_edit_media_returns_422(client, media_dir):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg",
                       data={"caption": "legenda"})
    assert resp.status_code == 201, resp.text
    resp = await _edit(client, chat_id, resp.json()["id"], a_headers, "alta legenda")
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_edit_deleted_returns_409(client):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    assert (await _delete(client, chat_id, msg["id"], a_headers)).status_code == 200
    resp = await _edit(client, chat_id, msg["id"], a_headers, "altceva")
    assert resp.status_code == 409, resp.text


# --- Ștergere ----------------------------------------------------------------
@pytest.mark.asyncio
async def test_delete_own_text_for_everyone(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "secret @ionel_92")
    # Partenerul reacționează înainte de ștergere.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{msg['id']}/react",
        json={"reaction": "❤️"}, headers=b_headers,
    )
    assert resp.status_code == 200, resp.text

    resp = await _delete(client, chat_id, msg["id"], a_headers)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["is_deleted"] is True
    assert out["body"] == ""
    assert out["reaction"] is None
    assert out["was_masked"] is False
    assert out["attachment"] is None
    assert out["kind"] == "text"

    for headers in (a_headers, b_headers):
        seen = (await _listing(client, chat_id, headers))[msg["id"]]
        assert seen["is_deleted"] is True
        assert seen["body"] == ""
        assert seen["reaction"] is None

    # Idempotent.
    resp = await _delete(client, chat_id, msg["id"], a_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_deleted"] is True
    assert resp.json()["body"] == ""


@pytest.mark.asyncio
async def test_delete_others_message_forbidden(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    resp = await _delete(client, chat_id, msg["id"], b_headers)
    assert resp.status_code == 403, resp.text
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")
    assert (await _delete(client, chat_id, msg["id"], c_headers)).status_code == 404
    assert (await _listing(client, chat_id, b_headers))[msg["id"]]["body"] == "salut"


@pytest.mark.asyncio
async def test_delete_attachment_removes_file(client, media_dir):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg",
                       data={"caption": "poza mea"})
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    key = msg["attachment"]["url"].split("/media/", 1)[1]
    assert (media_dir / key).is_file()

    resp = await _delete(client, chat_id, msg["id"], a_headers)
    assert resp.status_code == 200, resp.text
    out = resp.json()
    assert out["is_deleted"] is True
    assert out["attachment"] is None
    assert out["body"] == ""
    assert out["kind"] == "image"
    assert not (media_dir / key).exists()

    seen = (await _listing(client, chat_id, b_headers))[msg["id"]]
    assert seen["attachment"] is None
    assert seen["body"] == ""
    assert seen["is_deleted"] is True


@pytest.mark.asyncio
async def test_delete_survives_storage_failure(client, media_dir, monkeypatch):
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg")
    assert resp.status_code == 201, resp.text

    async def _boom(self, url):
        raise RuntimeError("storage down")

    monkeypatch.setattr(storage.LocalStorage, "delete", _boom)
    resp = await _delete(client, chat_id, resp.json()["id"], a_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_deleted"] is True


@pytest.mark.asyncio
async def test_react_to_deleted_returns_409(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    msg = await _send(client, chat_id, a_headers, "salut")
    await _delete(client, chat_id, msg["id"], a_headers)
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{msg['id']}/react",
        json={"reaction": "👍"}, headers=b_headers,
    )
    assert resp.status_code == 409, resp.text


@pytest.mark.asyncio
async def test_chat_list_last_message_deleted(client):
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    await _send(client, chat_id, a_headers, "primul")
    summary = (await client.get(f"{API}/chats/", headers=b_headers)).json()[0]
    assert summary["last_message"] == "primul"
    assert summary["last_message_deleted"] is False

    msg = await _send(client, chat_id, a_headers, "al doilea")
    await _delete(client, chat_id, msg["id"], a_headers)
    summary = (await client.get(f"{API}/chats/", headers=b_headers)).json()[0]
    assert summary["last_message"] == ""
    assert summary["last_message_deleted"] is True
    # Mesajul șters nu mai apare la necitite.
    assert summary["unread_count"] == 1


# --- Răspuns (citat) ---------------------------------------------------------
@pytest.mark.asyncio
async def test_reply_roundtrip_send_and_listing(client):
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    long_body = "x" * 300
    original = await _send(client, chat_id, a_headers, long_body)

    reply = await _send(client, chat_id, b_headers, "răspuns", reply_to_id=original["id"])
    preview = reply["reply_to"]
    assert preview["id"] == original["id"]
    assert preview["sender_id"] == a_id
    assert preview["kind"] == "text"
    assert preview["is_deleted"] is False
    assert 0 < len(preview["body"]) <= 120
    assert reply["sender_id"] == b_id

    listing = await _listing(client, chat_id, a_headers)
    assert listing[reply["id"]]["reply_to"] == preview
    assert listing[original["id"]]["reply_to"] is None

    # Citatul unui mesaj șters: is_deleted=True, fără conținut.
    await _delete(client, chat_id, original["id"], a_headers)
    listing = await _listing(client, chat_id, b_headers)
    preview = listing[reply["id"]]["reply_to"]
    assert preview["is_deleted"] is True
    assert preview["body"] == ""
    # Răspunsul la un mesaj șters e permis.
    again = await _send(client, chat_id, b_headers, "tot aici", reply_to_id=original["id"])
    assert again["reply_to"]["is_deleted"] is True
    # Ștergerea răspunsului ascunde și citatul.
    resp = await _delete(client, chat_id, reply["id"], b_headers)
    assert resp.json()["reply_to"] is None


@pytest.mark.asyncio
async def test_reply_to_message_from_other_chat_returns_422(client):
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    # Al doilea chat: B + Carol.
    c_headers, c_id = await _make_user(client, "c@example.com", "Carol")
    await client.post(f"{API}/feed/swipe", json={"target_user_id": c_id, "action": "like"},
                      headers=b_headers)
    resp = await client.post(f"{API}/feed/swipe", json={"target_user_id": b_id, "action": "like"},
                             headers=c_headers)
    assert resp.json()["matched"] is True, resp.text
    other_chat = await _chat_id_for(client, c_headers)
    assert other_chat != chat_id
    foreign = await _send(client, other_chat, c_headers, "din alt chat")

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "hei", "reply_to_id": foreign["id"]},
        headers=a_headers,
    )
    assert resp.status_code == 422, resp.text
    assert "citat" in resp.json()["detail"]
    # Id inexistent → tot 422.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "hei", "reply_to_id": str(uuid.uuid4())},
        headers=a_headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_attachment_with_reply_to_id(client, media_dir):
    (a_headers, _), (b_headers, b_id) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)
    original = await _send(client, chat_id, b_headers, "trimite o poză")

    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg",
                       data={"reply_to_id": original["id"]})
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["reply_to"]["id"] == original["id"]
    assert msg["reply_to"]["sender_id"] == b_id
    assert (await _listing(client, chat_id, b_headers))[msg["id"]]["reply_to"]["id"] == original["id"]

    # Citat la o poză fără legendă: body "" + kind image.
    reply = await _send(client, chat_id, b_headers, "frumos", reply_to_id=msg["id"])
    assert reply["reply_to"]["kind"] == "image"
    assert reply["reply_to"]["body"] == ""

    # UUID invalid → 422; mesaj inexistent → 422, fără fișier orfan scris.
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg",
                       data={"reply_to_id": "nu-e-uuid"})
    assert resp.status_code == 422, resp.text
    files_before = sorted(p for p in media_dir.rglob("*") if p.is_file())
    resp = await _post(client, chat_id, a_headers, _jpeg_with_gps(), ct="image/jpeg",
                       data={"reply_to_id": str(uuid.uuid4())})
    assert resp.status_code == 422, resp.text
    assert sorted(p for p in media_dir.rglob("*") if p.is_file()) == files_before
