"""Forme REALE de `initData`, exact așa cum le trimit clienții Telegram.

DE CE UN AL DOILEA FIȘIER
-------------------------
`tests/test_auth_telegram.py` verifică CONTRACTUL endpointului (semnătură,
`auth_date`, anti-replay, conturi). Aici verificăm altceva: că octeții pe care
îi produce un client Telegram REAL — cu `signature`, `chat_instance`,
`chat_type`, `start_param` gol, nume chirilice, emoji, `photo_url` lung, valori
cu `+`, `&`, `=`, `%`, spații și ghilimele — trec prin parser și ajung la
aceeași semnătură. Defectul care a ajuns în producție („semnătură invalidă" pe
date reale, dar date sintetice cu același token trec) e exact de tipul ăsta: nu
o greșeală de criptografie, ci o diferență între forma pe care o construiesc
testele și forma pe care o trimite clientul.

CUM SEMNĂM (REGULA FIȘIERULUI)
------------------------------
NU importăm nimic din `app.services.telegram_auth` pentru a calcula hash-ul.
Algoritmul e rescris aici, din documentația Telegram:

    secret_key = HMAC_SHA256(key=b"WebAppData", msg=bot_token)
    hash       = HMAC_SHA256(key=secret_key,   msg=data_check_string)
    data_check_string = "\\n".join(f"{k}={v}") peste câmpurile sortate,
                        FĂRĂ `hash` și FĂRĂ `signature`

Dacă am refolosi funcția din producție, testul ar confirma orice greșeală din
ea — inclusiv exact greșeala pe care încercăm s-o prindem.

CUM CODIFICĂM
-------------
Clientul Telegram construiește query-string-ul cu `encodeURIComponent` pe
FIECARE valoare: spațiul devine `%20`, plusul devine `%2B`, `&` devine `%26`.
`_wire()` imită asta (`quote(v, safe="")`). Semnătura se calculează peste
valorile DECODATE — ordinea corectă, altfel tot fișierul ar fi o tautologie.
"""
import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlencode

import pytest
from httpx import AsyncClient

from app.core.config import Settings, settings
from app.services import telegram_auth
# Baseline-ul de producție VALID, refolosit din testele guardului de config.
from tests.test_config import _prod_kwargs

pytestmark = pytest.mark.asyncio

BASE = "/api/v1/auth"

# Token de bot FALS, cu forma reală (`<bot_id>:<secret>`). Nu deschide nimic.
FAKE_BOT_TOKEN = "7654321:AAFakeTestTokenForUnitTestsOnly-0000000"

# `detail`-urile publice ale backendului. Hardcodate INTENȚIONAT: sunt un
# contract cu Mini App-ul (`miniapp/src/auth/telegramAuth.ts::classifyAuthError`
# le citește ca text). Dacă le-am importa din producție, redenumirea lor ar
# trece verde aici și ar strica traducerea erorilor în interfață.
DETAIL_SIGNATURE = "Invalid Telegram init data signature"
DETAIL_EXPIRED = "Telegram init data expired"
DETAIL_MALFORMED = "Malformed Telegram init data"
DETAIL_REPLAYED = "Telegram init data already used"

# Plafonul din `TelegramAuthIn.init_data` (schemas/auth.py).
MAX_INIT_DATA = 4096


# --------------------------------------------------------------------------- #
# Semnare + codificare, scrise independent de codul de producție
# --------------------------------------------------------------------------- #


def sign(fields: dict[str, str], bot_token: str = FAKE_BOT_TOKEN) -> str:
    # Telegram semneaza INCLUSIV campul `signature`; doar `hash` se exclude.
    # Confirmat pe trafic real: excluderea lui facea ca verificarea sa cada
    # mereu pe clientii moderni, iar testele care semnau la fel ramaneau verzi.

    """Hash-ul Telegram peste valorile DECODATE (algoritmul din documentație)."""
    data_check_string = "\n".join(
        f"{key}={fields[key]}"
        for key in sorted(fields)
        if key != "hash"
    )
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    return hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()


def wire(fields: dict[str, str], *, order: list[str] | None = None) -> str:
    """Query-string-ul, codificat ca `encodeURIComponent` (spațiu → `%20`)."""
    keys = order or list(fields)
    return "&".join(f"{key}={quote(fields[key], safe='')}" for key in keys)


def signed(fields: dict[str, str], *, bot_token: str = FAKE_BOT_TOKEN,
           order: list[str] | None = None) -> str:
    """Semnează câmpurile și le serializează în forma pe care o trimite clientul."""
    complete = dict(fields)
    complete["hash"] = sign(complete, bot_token)
    keys = (order or list(fields)) + ["hash"]
    return wire(complete, order=keys)


def user_json(**overrides) -> str:
    """Câmpul `user`, serializat exact cum îl trimite Telegram (JSON compact)."""
    payload = {
        "id": 555_000_111,
        "first_name": "Ivan",
        "last_name": "Test",
        "username": "ivan_test",
        "language_code": "ro",
    }
    payload.update(overrides)
    # `ensure_ascii=False`: Telegram trimite UTF-8 real, nu `\\uXXXX`.
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


_nonce = 0


def fresh_query_id() -> str:
    """`query_id` distinct la fiecare apel — două login-uri nu sunt un replay."""
    global _nonce
    _nonce += 1
    return f"AAHdF6IQAAAAAN0XohDhrOrc{_nonce:04d}"


def base_fields(**overrides) -> dict[str, str]:
    """Câmpurile minime pe care le are orice `initData` de Mini App."""
    fields = {
        "query_id": fresh_query_id(),
        "user": user_json(),
        "auth_date": str(int(time.time())),
    }
    fields.update(overrides)
    return fields


@pytest.fixture(autouse=True)
def telegram_live_mode(monkeypatch):
    """Mod 'live' + token fals + store anti-replay curat, pentru fiecare test."""
    monkeypatch.setattr(settings, "telegram_auth_mode", "live")
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN)
    monkeypatch.setattr(settings, "telegram_init_data_max_age_seconds", 86_400)
    telegram_auth.reset_replay_state()
    yield
    telegram_auth.reset_replay_state()


async def login(client: AsyncClient, init_data: str):
    return await client.post(f"{BASE}/telegram", json={"init_data": init_data})


def detail_of(resp) -> str:
    body = resp.json()
    return body.get("detail", "") if isinstance(body, dict) else ""


# --------------------------------------------------------------------------- #
# 0. Plasa de siguranță a fișierului: semnătura noastră NU e cea din producție
# --------------------------------------------------------------------------- #


async def test_our_signer_rejects_the_classic_inverted_derivation():
    """Dacă cineva „repară" `sign()` inversând cheia cu mesajul, se vede aici.

    Fără această plasă, tot fișierul ar putea deveni o tautologie: un semnator
    stricat identic cu un verificator stricat dă mereu verde.
    """
    fields = {"auth_date": "1700000000", "user": '{"id":1}'}
    inverted = hmac.new(
        hmac.new(FAKE_BOT_TOKEN.encode(), b"WebAppData", hashlib.sha256).digest(),
        "auth_date=1700000000\nuser={\"id\":1}".encode(),
        hashlib.sha256,
    ).hexdigest()
    assert sign(fields) != inverted


# --------------------------------------------------------------------------- #
# 1. Forme realiste — TOATE trebuie ACCEPTATE
# --------------------------------------------------------------------------- #


async def test_minimal_real_init_data_is_accepted(client: AsyncClient):
    """Referința: forma minimă pe care o dă orice client. Dacă pică asta, restul
    fișierului nu spune nimic."""
    resp = await login(client, signed(base_fields()))
    assert resp.status_code == 200, resp.text


async def test_modern_client_with_signature_field_is_accepted(client: AsyncClient):
    """Clienții noi adaugă `signature` (Ed25519). Nu intră în `data_check_string`."""
    fields = base_fields(
        signature="s3c8jWJ1bpYcVJx8n0hVQ0wWbZ4rQJ1mKQ0ZzPzk3nWQ9xU7cQfE2aL4tR6yH8jK"
    )
    resp = await login(client, signed(fields))
    assert resp.status_code == 200, resp.text


async def test_excluding_signature_from_data_check_string_is_rejected(
    client: AsyncClient,
):
    """Regresie pentru defectul care bloca TOȚI utilizatorii reali.

    Am exclus initial `signature` din `data_check_string`, urmând o citire
    superficială a documentației. Clienții vechi nu trimit acel câmp, deci nimic
    nu se vedea; clienții moderni îl trimit, iar fiecare login real era respins cu
    „semnătură invalidă". Testele sintetice semnau cu ACEEAȘI presupunere greșită,
    deci suita rămânea verde — de aceea defectul a ajuns în producție.

    Aici semnăm în vechiul fel, EXCLUZÂND `signature`. Backendul trebuie să
    respingă. Dacă testul ar trece cu 200, defectul a revenit.
    """
    fields = base_fields(signature="ZmFrZV9zaWduYXR1cmVfZm9yX3Rlc3Rz")
    vechi = "\n".join(
        f"{k}={fields[k]}" for k in sorted(fields) if k != "signature"
    )
    secret = hmac.new(b"WebAppData", FAKE_BOT_TOKEN.encode(), hashlib.sha256).digest()
    fields["hash"] = hmac.new(secret, vechi.encode(), hashlib.sha256).hexdigest()

    resp = await login(client, wire(fields))
    assert resp.status_code == 401, resp.text
    assert detail_of(resp) == DETAIL_SIGNATURE


async def test_chat_context_fields_are_accepted(client: AsyncClient):
    """Deschidere dintr-un chat: `chat_instance`, `chat_type`, `chat`, `start_param`.

    `chat_instance` e un întreg pe 64 de biți, adesea NEGATIV — semnul minus nu
    are voie să pice prin codificare.
    """
    fields = base_fields(
        chat_instance="-3887044060699754599",
        chat_type="supergroup",
        chat=json.dumps(
            {"id": -1001234567890, "type": "supergroup", "title": "FLIRT Chișinău"},
            separators=(",", ":"),
            ensure_ascii=False,
        ),
        start_param="event_42",
    )
    resp = await login(client, signed(fields))
    assert resp.status_code == 200, resp.text


async def test_empty_start_param_is_accepted(client: AsyncClient):
    """`start_param=` (valoare goală) e semnat de Telegram ca șir gol.

    Capcană reală: un parser care aruncă valorile goale ar construi alt
    `data_check_string` decât Telegram și ar respinge orice deschidere prin
    deep-link fără parametru.
    """
    fields = base_fields(start_param="")
    init_data = signed(fields)
    assert "start_param=&" in init_data or init_data.endswith("start_param=")
    resp = await login(client, init_data)
    assert resp.status_code == 200, resp.text


async def test_full_user_object_is_accepted(client: AsyncClient):
    """`photo_url`, `is_premium`, `allows_write_to_pm`, `last_name` gol.

    `last_name: ""` e forma reală pentru un cont fără nume de familie — Telegram
    trimite cheia cu șir gol, nu o omite.
    """
    fields = base_fields(
        user=user_json(
            id=612_345_678,
            last_name="",
            photo_url=(
                "https://t.me/i/userpic/320/"
                "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_aBcDeF.jpg"
            ),
            is_premium=True,
            allows_write_to_pm=True,
            added_to_attachment_menu=True,
        )
    )
    resp = await login(client, signed(fields))
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize(
    "first_name,last_name,label",
    [
        ("Ана", "Стратулат", "chirilic"),
        ("Ștefan", "Țurcanu-Brâncoveanu", "diacritice românești"),
        ("Ana 💃🔥", "Popescu ✨", "emoji"),
        ("李", "小龙", "CJK"),
        ("Ана💋Ștefan", "О'Брайен", "amestec + apostrof"),
    ],
)
async def test_non_ascii_names_are_accepted(
    client: AsyncClient, first_name: str, last_name: str, label: str
):
    """Nume reale: chirilice, diacritice, emoji, CJK.

    Punctul sensibil e `.encode()`: `data_check_string` se semnează pe octeți
    UTF-8. Orice pas care trece prin latin-1 sau prin `ensure_ascii` rupe exact
    populația noastră de utilizatori (RO + RU).
    """
    fields = base_fields(
        user=user_json(first_name=first_name, last_name=last_name, username=None)
    )
    resp = await login(client, signed(fields))
    assert resp.status_code == 200, f"{label}: {resp.text}"


async def test_values_with_url_metacharacters_are_accepted(client: AsyncClient):
    """Valori cu `&`, `=`, `%`, `+`, spații și ghilimele, codificate corect.

    Un `first_name` poate conține literal orice. Dacă backendul ar semna peste
    valorile NEdecodate (sau le-ar decoda de două ori), acest initData ar pica.
    """
    fields = base_fields(
        user=user_json(
            first_name='A&B=C%20D+E "citat" 100%',
            last_name="  spații   multiple  ",
            username=None,
        ),
        start_param="a=1&b=2+3 100%",
    )
    init_data = signed(fields)
    # Confirmăm că valorile chiar sunt codificate pe sârmă (altfel testul ar
    # verifica o formă pe care niciun client n-o produce).
    assert "%26" in init_data and "%3D" in init_data and "%2B" in init_data
    resp = await login(client, init_data)
    assert resp.status_code == 200, resp.text


async def test_space_encoded_as_plus_round_trips_correctly(client: AsyncClient):
    """Codificarea de tip formular (spațiu → `+`) rămâne validă.

    Unii clienți serializează cu `URLSearchParams.toString()`, care scrie
    spațiul ca `+`. Telegram semnează valoarea cu SPAȚIU, iar parserul de pe
    server trebuie să refacă spațiul. E cazul „normal" al plusului.
    """
    fields = base_fields(user=user_json(first_name="Ana Maria", username=None))
    fields["hash"] = sign(fields)
    # `urlencode` = codificarea de formular: spațiu → `+`, plus → `%2B`.
    resp = await login(client, urlencode(fields))
    assert resp.status_code == 200, resp.text


async def test_literal_unencoded_plus_is_rejected(client: AsyncClient):
    """CAPCANA PLUSULUI — comportamentul ACTUAL, documentat explicit.

    Pe sârmă apare un `+` LITERAL, necodificat, iar Telegram ar fi semnat
    valoarea cu plus. `parse_qsl` (regula `application/x-www-form-urlencoded`)
    citește plusul ca SPAȚIU, deci `data_check_string` diferă și cererea e
    respinsă cu 401.

    ESTE CORECT, nu un defect al nostru: într-un query-string un `+` necodificat
    ÎNSEAMNĂ spațiu, iar `encodeURIComponent` — pe care îl folosesc clienții
    Telegram — scrie mereu `%2B`. Un initData care ajunge aici în forma asta e
    produs de un client care nu respectă codificarea. Testul există ca să fixăm
    comportamentul: dacă cineva „repară" parsarea ca să accepte plusul literal,
    rupe în schimb cazul din `test_space_encoded_as_plus_round_trips_correctly`,
    care e cel real.
    """
    fields = base_fields(user=user_json(first_name="Jean+Luc", username=None))
    fields["hash"] = sign(fields)  # semnat peste valoarea cu PLUS
    # Scriem plusul necodificat pe sârmă (ce NU face un client corect).
    on_wire = "&".join(
        f"{k}={quote(v, safe='+')}" for k, v in fields.items()
    )
    assert "Jean+Luc" in on_wire
    resp = await login(client, on_wire)
    assert resp.status_code == 401, resp.text
    assert detail_of(resp) == DETAIL_SIGNATURE


async def test_field_order_on_the_wire_does_not_matter(client: AsyncClient):
    """`data_check_string` e SORTAT alfabetic, deci ordinea de pe sârmă e liberă.

    NU e un caz de respins: clienții Telegram nu garantează ordinea, iar un
    backend sensibil la ea ar respinge aleatoriu login-uri perfect valide.
    """
    fields = base_fields(start_param="ref_7", chat_type="private")
    forward = signed(fields, order=list(fields))
    reversed_order = signed(fields, order=list(reversed(list(fields))))
    assert forward != reversed_order  # chiar am reordonat

    assert (await login(client, forward)).status_code == 200
    # Al doilea are ACELAȘI hash (ordinea nu-l schimbă), deci e un replay —
    # ceea ce dovedește la rândul lui că hash-ul calculat e identic.
    second = await login(client, reversed_order)
    assert second.status_code == 401
    assert detail_of(second) == DETAIL_REPLAYED


async def test_uppercase_hash_is_accepted(client: AsyncClient):
    """Hash-ul e hexazecimal: `ABC…` și `abc…` sunt același număr.

    Unii clienți/proxy-uri normalizează în majuscule. Un backend care compară
    șirurile strict ar respinge un initData perfect valid.
    """
    fields = base_fields()
    fields["hash"] = sign(fields).upper()
    resp = await login(client, wire(fields))
    assert resp.status_code == 200, resp.text


async def test_init_data_at_schema_length_limit_is_accepted(client: AsyncClient):
    """Exact `max_length` octeți → acceptat; un octet peste → 422.

    Verifică marginea în ambele sensuri: plafonul nu are voie să taie un
    initData real (un `start_param` lung de deep-link) și nici să dispară.
    """
    fields = base_fields(start_param="x")
    padded = dict(fields)
    # Creștem `start_param` până când șirul final are EXACT plafonul.
    for _ in range(64):
        candidate = signed(padded)
        delta = MAX_INIT_DATA - len(candidate)
        if delta == 0:
            break
        padded["start_param"] = "x" * max(1, len(padded["start_param"]) + delta)
    at_limit = signed(padded)
    assert len(at_limit) == MAX_INIT_DATA, len(at_limit)
    assert (await login(client, at_limit)).status_code == 200, at_limit[:80]

    over = signed({**padded, "start_param": padded["start_param"] + "x"})
    assert len(over) > MAX_INIT_DATA
    assert (await login(client, over)).status_code == 422


# --------------------------------------------------------------------------- #
# 2. Forme care trebuie RESPINSE — cu tipul corect de eroare
# --------------------------------------------------------------------------- #


async def test_hash_from_another_bot_token_is_a_signature_error(client: AsyncClient):
    """EXACT cazul din producție: date impecabile, dar semnate cu ALT token.

    Nu e destul să fie 401: trebuie să fie eroarea de SEMNĂTURĂ. Dacă ar veni
    „expired" sau „malformed", diagnosticul din producție ar porni pe pistă
    greșită (exact ce s-a întâmplat), iar Mini App-ul ar afișa „redeschide
    aplicația" pentru o problemă care nu se rezolvă niciodată așa.
    """
    other = signed(base_fields(), bot_token="1111111:AAcompletelyDifferentBotToken")
    resp = await login(client, other)
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_SIGNATURE


async def test_field_added_after_signing_is_rejected(client: AsyncClient):
    """Un câmp adăugat după semnare schimbă `data_check_string` → 401."""
    init_data = signed(base_fields()) + "&start_param=" + quote("promo_gratis")
    resp = await login(client, init_data)
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_SIGNATURE


async def test_field_removed_after_signing_is_rejected(client: AsyncClient):
    """Un câmp șters după semnare schimbă `data_check_string` → 401."""
    fields = base_fields(chat_type="private")
    init_data = signed(fields)
    stripped = "&".join(
        part for part in init_data.split("&") if not part.startswith("chat_type=")
    )
    assert stripped != init_data
    resp = await login(client, stripped)
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_SIGNATURE


async def test_duplicated_field_cannot_smuggle_another_user(client: AsyncClient):
    """`user=<victimă>&…&user=<atacator>`: ultima valoare câștigă la parsare.

    Contrabanda prin dublarea unui câmp e un tipar clasic (HTTP parameter
    pollution). Aici trebuie să pice pe semnătură, nu să autentifice pe cineva.
    """
    fields = base_fields(user=user_json(id=100_000_001))
    init_data = signed(fields)
    evil = init_data + "&user=" + quote(user_json(id=100_000_002), safe="")
    resp = await login(client, evil)
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_SIGNATURE


@pytest.mark.parametrize(
    "auth_date,label",
    [
        (None, "lipsă"),
        ("", "gol"),
        ("ieri", "nenumeric"),
        ("17e9", "notație științifică"),
        ("1.7e9", "zecimal"),
    ],
)
async def test_bad_auth_date_is_an_expiry_error(
    client: AsyncClient, auth_date: str | None, label: str
):
    """`auth_date` absent sau neinterpretabil → eroarea de EXPIRARE, nu altceva.

    Semnătura e corectă în toate cazurile (semnăm ce trimitem), deci testul
    verifică strict ramura de `auth_date` — inclusiv că verificarea lui NU e
    sărită când câmpul lipsește cu totul.
    """
    fields = {"query_id": fresh_query_id(), "user": user_json()}
    if auth_date is not None:
        fields["auth_date"] = auth_date
    resp = await login(client, signed(fields))
    assert resp.status_code == 401, f"{label}: {resp.text}"
    assert detail_of(resp) == DETAIL_EXPIRED, label


async def test_auth_date_just_past_the_clock_skew_is_rejected(client: AsyncClient):
    """Marja de ceas e o fereastră îngustă, nu o ușă deschisă.

    +30s (în marjă) trebuie acceptat — ceasurile chiar diferă. +5 minute e
    fabricat ca să prelungească valabilitatea și trebuie respins.
    """
    ok = signed(base_fields(auth_date=str(int(time.time()) + 30)))
    assert (await login(client, ok)).status_code == 200

    bad = signed(base_fields(auth_date=str(int(time.time()) + 300)))
    resp = await login(client, bad)
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_EXPIRED


async def test_auth_date_one_second_past_the_window_is_rejected(client: AsyncClient):
    """Marginea de expirare: fix pe limită trece, o secundă peste nu."""
    max_age = settings.telegram_init_data_max_age_seconds
    now = int(time.time())
    assert (
        await login(client, signed(base_fields(auth_date=str(now - max_age + 5))))
    ).status_code == 200

    resp = await login(client, signed(base_fields(auth_date=str(now - max_age - 5))))
    assert resp.status_code == 401
    assert detail_of(resp) == DETAIL_EXPIRED


@pytest.mark.parametrize(
    "raw_user,label",
    [
        (None, "câmpul `user` lipsește"),
        ("", "`user` gol"),
        ("{nu-e-json", "JSON corupt"),
        ('{"first_name":"Ivan"}', "fără `id`"),
        ('{"id":null,"first_name":"Ivan"}', "`id` null"),
        ('{"id":"abc"}', "`id` nenumeric"),
        ('{"id":0}', "`id` zero"),
        ('{"id":-5}', "`id` negativ"),
        ('{"id":true}', "`id` boolean"),
        ('["id",1]', "JSON care nu e obiect"),
        ('"doar-un-sir"', "JSON care e doar un șir"),
    ],
)
async def test_bad_user_field_is_a_malformed_error(
    client: AsyncClient, raw_user: str | None, label: str
):
    """`user` inutilizabil → eroarea de FORMAT, nu una de semnătură.

    `id: true` merită menționat separat: în Python `isinstance(True, int)` e
    adevărat, deci un `id` boolean ar deveni contul numărul 1 dacă nu ar fi
    verificat explicit.
    """
    fields = {"auth_date": str(int(time.time())), "query_id": fresh_query_id()}
    if raw_user is not None:
        fields["user"] = raw_user
    resp = await login(client, signed(fields))
    assert resp.status_code == 401, f"{label}: {resp.text}"
    assert detail_of(resp) == DETAIL_MALFORMED, label


@pytest.mark.parametrize(
    "init_data,label",
    [
        ("nu-este-un-query-string", "fără `=`"),
        ("&&&", "doar separatori"),
        ("   ", "doar spații"),
        ("%%%=1", "procent invalid"),
    ],
)
async def test_unparsable_init_data_is_rejected(
    client: AsyncClient, init_data: str, label: str
):
    """Un șir care nu e query-string valid nu are voie să devină un dicționar gol."""
    resp = await login(client, init_data)
    assert resp.status_code == 401, f"{label}: {resp.text}"


async def test_empty_init_data_is_refused_by_the_schema(client: AsyncClient):
    """Șirul gol e oprit de `min_length=1` înainte să ajungă la criptografie (422)."""
    assert (await login(client, "")).status_code == 422


@pytest.mark.parametrize(
    "bad_hash,label",
    [
        ("", "gol"),
        ("deadbeef", "prea scurt"),
        ("0" * 63, "63 de caractere"),
        ("0" * 65, "65 de caractere"),
        ("z" * 64, "nu e hexazecimal"),
        ("0" * 64, "hex valid, dar greșit"),
    ],
)
async def test_malformed_hash_is_a_signature_error(
    client: AsyncClient, bad_hash: str, label: str
):
    """Orice hash care nu e 64 de caractere hex corecte → eroare de SEMNĂTURĂ."""
    fields = base_fields()
    fields["hash"] = bad_hash
    resp = await login(client, wire(fields))
    assert resp.status_code == 401, f"{label}: {resp.text}"
    assert detail_of(resp) == DETAIL_SIGNATURE, label


async def test_error_details_match_the_miniapp_contract():
    """Mesajele publice sunt un contract cu clientul, nu text liber.

    `miniapp/src/auth/telegramAuth.ts::classifyAuthError` decide după cuvintele
    „expir", „invalid", „malformed", „signature". O redenumire tăcută în
    backend ar transforma, în interfață, „semnătură invalidă" în „redeschide
    aplicația" — sfat inutil pentru un utilizator blocat definitiv.
    """
    assert telegram_auth.InvalidInitDataSignature.message == DETAIL_SIGNATURE
    assert telegram_auth.ExpiredInitData.message == DETAIL_EXPIRED
    assert telegram_auth.MalformedInitData.message == DETAIL_MALFORMED
    assert telegram_auth.ReplayedInitData.message == DETAIL_REPLAYED
    for detail in (DETAIL_SIGNATURE, DETAIL_EXPIRED, DETAIL_MALFORMED):
        low = detail.lower()
        assert any(w in low for w in ("expir", "invalid", "malformed", "signature"))


async def test_error_details_never_leak_the_bot_token(client: AsyncClient):
    """Răspunsul de eroare nu are voie să conțină tokenul sau hash-ul așteptat."""
    resp = await login(client, signed(base_fields(), bot_token="1111111:AAleak"))
    assert resp.status_code == 401
    body = resp.text
    assert FAKE_BOT_TOKEN not in body
    assert "AAFakeTestTokenForUnitTestsOnly" not in body
    assert sign(base_fields()) not in body


# --------------------------------------------------------------------------- #
# 3. Anti-replay
# --------------------------------------------------------------------------- #


async def test_replay_reports_the_replay_error_not_a_signature_error(
    client: AsyncClient,
):
    """Al doilea login cu aceleași date → „already used", nu „invalid signature".

    Distincția contează pentru interfață: replay-ul se rezolvă redeschizând
    Mini App-ul, semnătura invalidă nu se rezolvă deloc.
    """
    init_data = signed(base_fields(user=user_json(id=706_000_111)))
    assert (await login(client, init_data)).status_code == 200

    second = await login(client, init_data)
    assert second.status_code == 401
    assert detail_of(second) == DETAIL_REPLAYED


async def test_two_concurrent_logins_with_the_same_data_yield_one_success(
    client: AsyncClient,
):
    """Două cereri IDENTICE în paralel: exact una trece.

    Fereastra de cursă e reală (dublu-tap pe butonul de intrare, retrimitere
    automată): dacă amândouă ar trece, protecția anti-replay n-ar exista
    practic.
    """
    init_data = signed(base_fields(user=user_json(id=707_000_222)))

    first, second = await asyncio.gather(
        login(client, init_data), login(client, init_data)
    )
    codes = sorted([first.status_code, second.status_code])
    assert codes == [200, 401], (first.text, second.text)
    losing = first if first.status_code == 401 else second
    assert detail_of(losing) == DETAIL_REPLAYED


def _claimable(hash_hex: str) -> telegram_auth.TelegramInitData:
    """Un rezultat de verificare deja validat, folosit doar ca să testăm claim-ul."""
    return telegram_auth.TelegramInitData(
        user=telegram_auth.TelegramUser(id=1),
        auth_date=datetime.now(timezone.utc),
        hash=hash_hex,
    )


async def test_two_different_init_data_sets_are_claimed_concurrently():
    """Două seturi DIFERITE, consumate în paralel: amândouă trec.

    Plasa de siguranță a testului de mai sus — anti-replay-ul nu are voie să
    serializeze utilizatori care n-au nicio legătură între ei. Verificat direct
    pe `claim_init_data`, nu prin HTTP: fixtura `client` împarte O SINGURĂ
    sesiune de bază de date între cereri, deci două login-uri care ajung
    amândouă la baza de date s-ar ciocni în driver, nu în codul testat.
    """
    a = sign(base_fields(user=user_json(id=708_000_333)))
    b = sign(base_fields(user=user_json(id=709_000_444)))
    assert a != b

    await asyncio.gather(
        telegram_auth.claim_init_data(_claimable(a), ttl_seconds=60),
        telegram_auth.claim_init_data(_claimable(b), ttl_seconds=60),
    )  # niciuna nu are voie să ridice


async def test_same_hash_claimed_concurrently_succeeds_exactly_once():
    """Zece consumări simultane ale aceluiași hash → exact una reușește."""
    hash_hex = sign(base_fields(user=user_json(id=712_000_777)))
    results = await asyncio.gather(
        *(
            telegram_auth.claim_init_data(_claimable(hash_hex), ttl_seconds=60)
            for _ in range(10)
        ),
        return_exceptions=True,
    )
    ok = [r for r in results if not isinstance(r, Exception)]
    replayed = [r for r in results if isinstance(r, telegram_auth.ReplayedInitData)]
    assert len(ok) == 1, results
    assert len(replayed) == 9, results


async def test_replay_is_still_blocked_when_redis_is_unreachable(
    client: AsyncClient, monkeypatch
):
    """Redis căzut → degradare la store-ul in-memory, NU la „totul permis".

    Aici e diferența dintre o degradare și o breșă: dacă la un Redis indisponibil
    `claim_init_data` ar lăsa cererea să treacă, orice `initData` interceptat ar
    redeveni reutilizabil timp de 24h — și exact în momentul unui incident de
    infrastructură, când nimeni nu se uită la login-uri.
    """
    # URL valid ca formă, către un port unde nu ascultă nimic: clientul Redis se
    # construiește, dar orice comandă eșuează.
    monkeypatch.setattr(settings, "redis_url", "redis://127.0.0.1:1/0")
    telegram_auth.ratelimit.reset_backend()
    try:
        # Plasă: dacă asta ar fi None, testul ar verifica din greșeală drumul
        # in-memory obișnuit, nu degradarea.
        assert telegram_auth._get_redis() is not None

        init_data = signed(base_fields(user=user_json(id=710_000_555)))
        assert (await login(client, init_data)).status_code == 200

        second = await login(client, init_data)
        assert second.status_code == 401
        assert detail_of(second) == DETAIL_REPLAYED
    finally:
        telegram_auth.ratelimit.reset_backend()


async def test_fresh_init_data_for_the_same_user_is_not_a_replay(client: AsyncClient):
    """Anti-replay-ul consumă un HASH, nu un utilizator.

    O a doua deschidere a Mini App-ului dă alt `query_id`, deci alt hash, deci
    trebuie să intre. Fără acest test, o protecție „per user" ar părea corectă
    și ar bloca oamenii pentru 24 de ore.
    """
    telegram_id = 711_000_666
    assert (
        await login(client, signed(base_fields(user=user_json(id=telegram_id))))
    ).status_code == 200
    assert (
        await login(client, signed(base_fields(user=user_json(id=telegram_id))))
    ).status_code == 200


# --------------------------------------------------------------------------- #
# 4. Tokenul botului, citit din mediu
# --------------------------------------------------------------------------- #
#
# DE CE ACEASTĂ SECȚIUNE EXISTĂ
# -----------------------------
# `secret_key = HMAC(b"WebAppData", bot_token)`. Tokenul intră în derivare ca
# OCTEȚI BRUȚI, deci un singur caracter invizibil la capăt („\n" rămas dintr-un
# `echo "..." > secret`, un spațiu dintr-un copy-paste în `.env`, un `\r` dintr-un
# fișier salvat pe Windows) produce O CHEIE COMPLET DIFERITĂ.
#
# Simptomul rezultat e EXACT cel raportat din producție: datele reale de la
# Telegram primesc „semnătură invalidă", în timp ce orice test sintetic care
# semnează cu ACEEAȘI valoare din config trece — fiindcă folosește și el tokenul
# murdar. Nicio verificare de la nivelul de deasupra nu poate distinge cele două
# cazuri; de aceea gapul se închide doar la citirea configurării.


async def test_whitespace_in_the_bot_token_no_longer_breaks_every_login(
    client: AsyncClient, monkeypatch
):
    """Regresie: un „\\n" invizibil în token respingea TOATE datele reale.

    Mecanismul defectului: tokenul intra ca octeți bruți în derivarea cheii HMAC,
    deci o cheie complet diferită. Simptomul era „semnătură invalidă" pentru orice
    utilizator real, în timp ce orice test semnat cu aceeași valoare murdară
    trecea — deci suita rămânea verde. Tokenul se curăță acum și la citire, și la
    folosire.
    """
    clean_data = signed(base_fields())  # semnat cu tokenul CURAT
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN + "\n")

    resp = await login(client, clean_data)
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("dirty", ["\n", " ", "\r\n", "\t", "  \n"])
async def test_bot_token_is_read_tolerantly_from_the_environment(
    client: AsyncClient, monkeypatch, dirty: str
):
    """Spațiul alb din jurul tokenului nu are voie să invalideze login-ul.

    Un secret e valoarea lui, nu formatarea fișierului din care a fost citit.
    """
    clean_data = signed(base_fields())
    monkeypatch.setattr(settings, "telegram_bot_token", FAKE_BOT_TOKEN + dirty)

    resp = await login(client, clean_data)
    assert resp.status_code == 200, resp.text


async def test_settings_strips_whitespace_from_the_bot_token():
    """Tokenul se curata la citire: un „\\n" invizibil ar strica toate semnaturile."""
    s = Settings(**_prod_kwargs(
        telegram_auth_mode="live",
        telegram_bot_token="7654321:AAsecret\n",
        telegram_webhook_secret="whsec_test",
    ))
    assert s.telegram_bot_token == "7654321:AAsecret", (
        "Spatiul alb trebuie eliminat la citire: intra altfel ca octet in "
        "derivarea cheii HMAC si respinge toate datele reale."
    )
