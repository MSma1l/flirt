"""BUG HUNT — zona feed/swipe/match/chat/compatibility/geo (agent dedicat).

Aceste teste DEMONSTREAZA bug-uri (sunt ROSII intentionat). NU repara nimic —
fiecare test descrie comportamentul CORECT asteptat, iar esecul lui dovedeste
ca implementarea actuala nu il respecta.

Atentie SPECIALA: mascarea contactelor (TZ 5.5 anti-ocolire) — mai multe cai de
OCOLIRE care lasa datele de contact vizibile.
"""
from datetime import date

import pytest

from app.services.contact_masker import MASK, mask_contacts
from tests.conftest import upload_photo

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25
_PASSWORD = "Str0ng-Passw0rd!"


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": _PASSWORD}
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
        "city": "Chisinau",
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
    # Un profil fără poze nu apare în feedul nimănui (principiu al
    # aplicației) — anketa singură nu e de ajuns. Al doilea pas, exact ca în
    # aplicația reală: PUT /profiles/me, apoi POST /profiles/photos.
    await upload_photo(client, headers)
    return headers, await _me_id(client, headers)


# =============================================================================
# BUG #1 — Ocolire mascare EMAIL prin obfuscare "(at)" / "(dot)" (TZ 5.5)
# Gravitate: MARE. Cerinta TZ 5.5 e explicit anti-ocolire; "email cu (at)" e
# tocmai tehnica clasica de a schimba adresa fara ca filtrul s-o vada.
# =============================================================================
def test_bug_email_at_dot_parens_obfuscation_leaks():
    """`ion(at)gmail(dot)com` trece NEMASCAT -> adresa e complet lizibila."""
    masked, changed = mask_contacts("scrie-mi ion(at)gmail(dot)com")
    # CORECT: ar trebui mascat (ceva s-a schimbat) si domeniul sa dispara.
    assert changed is True
    assert "gmail" not in masked.lower()


def test_bug_email_spelled_at_dot_leaks():
    """`vasile at mail dot ru` (scris in litere) trece NEMASCAT."""
    masked, changed = mask_contacts("mailul meu e vasile at mail dot ru")
    assert changed is True


def test_bug_email_bracket_obfuscation_leaks():
    """`vasile [at] mail [dot] ru` (paranteze drepte) trece NEMASCAT."""
    masked, changed = mask_contacts("vasile [at] mail [dot] ru")
    assert changed is True


# =============================================================================
# BUG #2 — Ocolire mascare MESSENGER: nick pur alfabetic (fara cifra/underscore)
# Gravitate: MARE. Docstring-ul din regex promite ca se mascheaza si nick-urile
# cu PUNCT, dar clasa declansatoare e doar `[_\d]`. Un username de Telegram
# format din litere (foarte frecvent) scapa nemascat — schimb de contact la liber.
# =============================================================================
def test_bug_messenger_plain_alpha_nick_leaks():
    """`telegram ionpopescu` lasa nick-ul VIZIBIL (nicio cifra -> neprins)."""
    masked, changed = mask_contacts("gaseste-ma pe telegram ionpopescu")
    assert changed is True
    assert "ionpopescu" not in masked


def test_bug_messenger_dotted_nick_leaks():
    """`telegram ion.popescu` — docstring-ul zice ca PUNCTUL declanseaza, dar nu."""
    masked, changed = mask_contacts("scrie pe telegram ion.popescu")
    assert changed is True
    assert "ion.popescu" not in masked


# =============================================================================
# BUG #3 — Ocolire mascare DOMENIU prin spatii in jurul punctului
# Gravitate: MEDIE. `gmail . com` (cu spatii) nu e prins de BARE_DOMAIN_RE.
# =============================================================================
def test_bug_spaced_domain_leaks():
    """`gmail . com` (spatii in jurul punctului) trece NEMASCAT."""
    masked, changed = mask_contacts("intra pe gmail . com si scrie-mi")
    assert changed is True


# =============================================================================
# BUG #4 — FALS POZITIV messenger: cuvant normal mascat din greseala
# Gravitate: MEDIE (corectitudine). Cheia "wa"/"tg"/"insta" fara granita de
# cuvant + nick declansat de orice cifra transforma text organic in "wa****",
# stricand conversatii legitime.
# =============================================================================
def test_bug_normal_word_overmasked_as_messenger():
    """`want2go` (cuvant normal cu cifra) NU trebuie mascat, dar devine `wa****`."""
    masked, changed = mask_contacts("want2go la mare weekend-ul asta")
    assert changed is False, f"Text organic mascat gresit: {masked!r}"
    assert MASK not in masked


# =============================================================================
# BUG #5 — Stored XSS prin `reaction`: campul NU e sanitizat ca body-ul mesajului
# Gravitate: MARE. `MessageIn.body` trece prin `safe_str` (respinge marcaje HTML,
# anti-XSS stocat), dar `ReactionIn.reaction` e un simplu `str` cu doar max_length,
# fara `no_html`. Un payload `<img src=x onerror=...>` (<=16 car.) se persista si
# se serveste in `MessageOut.reaction` catre celalalt client — exact vectorul
# pe care sanitizarea body-ului il inchide.
# =============================================================================
async def _match_and_open_chat(client) -> tuple[dict, dict, str, str]:
    """A si B fac match reciproc; intoarce (a_headers, b_headers, chat_id, msg_id)."""
    a_headers, a_id = await _make_user(client, "xss_a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "xss_b@example.com", "Bob")

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
    assert resp.status_code == 200, resp.text
    chat_id = resp.json()["chat_id"]
    assert chat_id

    # A trimite un mesaj in chat.
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages",
        json={"body": "salut"},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    msg_id = resp.json()["id"]
    return a_headers, b_headers, chat_id, msg_id


@pytest.mark.asyncio
async def test_bug_reaction_allows_stored_html_xss(client):
    """Reactia cu marcaj HTML ar trebui respinsa (ca body-ul), dar e acceptata."""
    a_headers, b_headers, chat_id, msg_id = await _match_and_open_chat(client)

    payload = "<img src=x>"  # 11 caractere, sub max_length=16
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages/{msg_id}/react",
        json={"reaction": payload},
        headers=b_headers,
    )
    # CORECT: 422 (marcaj HTML respins, ca la body). Realitate: 200 + stocat.
    assert resp.status_code == 422, (
        f"Reactia HTML a fost acceptata (status {resp.status_code}): "
        f"{resp.text} — stored XSS prin campul reaction."
    )
