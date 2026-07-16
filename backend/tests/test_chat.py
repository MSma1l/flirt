"""Teste pentru modulul de chat + mascarea contactelor (SQLite in-memory)."""
from datetime import date

import pytest

from app.services.contact_masker import MASK, mask_contacts
from tests.conftest import upload_photo

API = "/api/v1"

# Vârstă adultă deterministă (~25 ani → 18+).
_ADULT_YEAR = date.today().year - 25


# --- Helperi HTTP (aliniate cu test_feed.py) ---------------------------------
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
    """O anketă validă minimală."""
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
        "dating_statuses": ["serious", "friendship"],
        "interests": ["sport", "travel"],
        "photos": [],
    }


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    """Înregistrează user, completează anketa; întoarce (headers, user_id)."""
    headers = await _register(client, email)
    resp = await client.put(
        f"{API}/profiles/me", json=_anketa(name=name), headers=headers
    )
    assert resp.status_code == 200, resp.text
    # Un profil fără poze nu apare în feedul nimănui (principiu al aplicației) —
    # anketa singură nu e de ajuns. Al doilea pas, exact ca în aplicația reală:
    # PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    user_id = await _me_id(client, headers)
    return headers, user_id


async def _matched_pair(client):
    """Creează 2 useri cu like reciproc → match. Întoarce datele ambilor."""
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
    """Primul chat_id din lista de dialoguri a userului."""
    resp = await client.get(f"{API}/chats/", headers=headers)
    assert resp.status_code == 200, resp.text
    chats = resp.json()
    assert chats, "Lista de dialoguri ar trebui să conțină chat-ul match-ului."
    return chats[0]["chat_id"]


# --- Teste de integrare -------------------------------------------------------
@pytest.mark.asyncio
async def test_chat_appears_after_match(client):
    """După match, GET /chats întoarce un dialog cu datele celuilalt."""
    (a_headers, _), (_, b_id) = await _matched_pair(client)

    resp = await client.get(f"{API}/chats/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    chats = resp.json()
    assert len(chats) == 1
    chat = chats[0]
    assert chat["other_user_id"] == b_id
    assert chat["other_name"] == "Bob"
    assert chat["unread_count"] == 0
    assert chat["last_message"] is None


@pytest.mark.asyncio
async def test_outsider_cannot_access_chat(client):
    """Un user din afara chat-ului primește 403/404 la mesaje."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # User complet străin de chat.
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=c_headers)
    assert resp.status_code in (403, 404), resp.text

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "hei"},
        headers=c_headers,
    )
    assert resp.status_code in (403, 404), resp.text


@pytest.mark.asyncio
async def test_send_and_receive_message(client):
    """Un mesaj trimis apare în GET messages la ambii participanți."""
    (a_headers, a_id), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "Bună, ce faci?"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["body"] == "Bună, ce faci?"
    assert msg["was_masked"] is False
    assert msg["sender_id"] == a_id

    # B vede mesajul.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    assert resp.status_code == 200, resp.text
    bodies = [m["body"] for m in resp.json()]
    assert "Bună, ce faci?" in bodies


@pytest.mark.asyncio
async def test_message_masks_telegram_handle(client):
    """Un mesaj cu mențiune telegram + @handle e mascat (was_masked True)."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "scrie-mi pe telegram @ionel_92"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["was_masked"] is True
    assert "ionel_92" not in msg["body"]
    assert MASK in msg["body"]


@pytest.mark.asyncio
async def test_message_masks_phone_number(client):
    """Un mesaj cu număr de telefon e mascat."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "sună-mă la +373 69 123 456"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    msg = resp.json()
    assert msg["was_masked"] is True
    assert "123" not in msg["body"]
    assert MASK in msg["body"]


@pytest.mark.asyncio
async def test_unread_count_and_mark_read(client):
    """unread_count crește la primire și se resetează după marcarea citită."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # A trimite 2 mesaje.
    for text in ("primul", "al doilea"):
        resp = await client.post(
            f"{API}/chats/{chat_id}/messages",
            json={"body": text},
            headers=a_headers,
        )
        assert resp.status_code == 201, resp.text

    # B vede 2 necitite în lista de dialoguri.
    resp = await client.get(f"{API}/chats/", headers=b_headers)
    b_chat = resp.json()[0]
    assert b_chat["unread_count"] == 2
    # Ultimul mesaj e unul dintre cele trimise (pe SQLite timestampurile
    # au rezoluție de o secundă, deci nu forțăm ordinea sub-secundă).
    assert b_chat["last_message"] in ("primul", "al doilea")

    # B marchează citit prin endpoint dedicat.
    resp = await client.post(f"{API}/chats/{chat_id}/read", headers=b_headers)
    assert resp.status_code == 204, resp.text

    resp = await client.get(f"{API}/chats/", headers=b_headers)
    assert resp.json()[0]["unread_count"] == 0

    # A (expeditorul) nu are necitite din propriile mesaje.
    resp = await client.get(f"{API}/chats/", headers=a_headers)
    assert resp.json()[0]["unread_count"] == 0


@pytest.mark.asyncio
async def test_react_to_message_sets_and_clears_reaction(client):
    """Reacția la un mesaj apare în GET messages; None o scoate (TZ 5.2)."""
    (a_headers, _), (b_headers, _) = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    # A trimite un mesaj.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "salut"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    message_id = resp.json()["id"]

    # B reacționează cu un emoji.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{message_id}/react",
        json={"reaction": "❤️"},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reaction"] == "❤️"

    # GET messages reflectă reacția.
    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=a_headers)
    assert resp.status_code == 200, resp.text
    by_id = {m["id"]: m for m in resp.json()}
    assert by_id[message_id]["reaction"] == "❤️"

    # Scoaterea reacției (reaction=None).
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{message_id}/react",
        json={"reaction": None},
        headers=b_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["reaction"] is None

    resp = await client.get(f"{API}/chats/{chat_id}/messages", headers=b_headers)
    by_id = {m["id"]: m for m in resp.json()}
    assert by_id[message_id]["reaction"] is None


@pytest.mark.asyncio
async def test_react_in_foreign_chat_returns_404(client):
    """Un user străin de chat nu poate reacționa la mesaje → 404 (TZ 5.2)."""
    (a_headers, _), _ = await _matched_pair(client)
    chat_id = await _chat_id_for(client, a_headers)

    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "mesaj privat"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    message_id = resp.json()["id"]

    # User complet străin de chat.
    c_headers, _ = await _make_user(client, "c@example.com", "Carol")
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{message_id}/react",
        json={"reaction": "👍"},
        headers=c_headers,
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_chat_summary_has_compatibility(client):
    """ChatSummary.compatibility e un int în intervalul 0–100 (TZ 5.2)."""
    (a_headers, _), _ = await _matched_pair(client)

    resp = await client.get(f"{API}/chats/", headers=a_headers)
    assert resp.status_code == 200, resp.text
    chat = resp.json()[0]
    assert "compatibility" in chat
    compat = chat["compatibility"]
    assert isinstance(compat, int)
    assert 0 <= compat <= 100


# --- Teste unitare pe mask_contacts ------------------------------------------
def test_mask_phone_unit():
    """Un număr de telefon e ascuns; textul din jur rămâne."""
    out, masked = mask_contacts("sună la 069123456 te rog")
    assert masked is True
    assert "069123456" not in out
    assert MASK in out
    assert "te rog" in out


def test_mask_email_unit():
    """Un email e ascuns."""
    out, masked = mask_contacts("scrie pe ion.pop@gmail.com")
    assert masked is True
    assert "gmail.com" not in out
    assert MASK in out


def test_mask_handle_unit():
    """Un handle social `@nume` e ascuns."""
    out, masked = mask_contacts("instagram: @ionel.pop")
    assert masked is True
    assert "ionel.pop" not in out
    assert MASK in out


def test_mask_url_unit():
    """Un URL e ascuns."""
    out, masked = mask_contacts("vezi aici https://t.me/ionel")
    assert masked is True
    assert "t.me" not in out
    assert MASK in out


def test_normal_text_untouched():
    """Textul obișnuit rămâne neatins (fără false-positive)."""
    text = "Bună! Mi-a plăcut mult profilul tău, hai să vorbim."
    out, masked = mask_contacts(text)
    assert masked is False
    assert out == text
