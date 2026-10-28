"""Notificările botului Telegram (`tg_notify`): mesaj, like, super like, match, poveste.

Trimiterea e MOCK-uită la nivel de funcție (`telegram_bot.send_message`), deci nu
se atinge rețeaua. Notificările pleacă în fundal după răspunsul HTTP; testele
le așteaptă explicit cu `tg_notify.drain()`.

Redis lipsește în teste (`REDIS_URL=""`) → anti-spam-ul rulează pe rezerva din
proces; calea Redis e acoperită separat cu un client fals (`_FakeRedis`).
"""
import asyncio
import uuid
from pathlib import Path

import pytest
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.core.config import settings
from app.models.account import Block
from app.models.user import User
from app.services import auth_service, bot_texts, telegram_bot, tg_notify
from app.services.telegram_auth import TelegramUser
from tests.test_chat import API, _chat_id_for, _make_user, _matched_pair

BACKEND = Path(__file__).resolve().parent.parent
MINIAPP_URL = "https://miniapp.flrt.md/tg"
TG_A = 1001
TG_B = 1002


# --- Fixturi & helpers ----------------------------------------------------------
@pytest.fixture
def sent(monkeypatch):
    """Înregistrează fiecare `sendMessage`; răspunde OK ca Telegram."""
    calls: list[dict] = []

    async def fake_send(chat_id, text, reply_markup=None, parse_mode=None, disable_preview=False):
        calls.append(
            {"chat_id": chat_id, "text": text, "markup": reply_markup, "parse_mode": parse_mode}
        )
        return {"ok": True, "result": {"message_id": len(calls)}}

    monkeypatch.setattr(telegram_bot, "send_message", fake_send)
    monkeypatch.setattr(telegram_bot.settings, "telegram_miniapp_url", MINIAPP_URL)
    return calls


async def _link_tg(db, user_id: str, tg_id: int, lang: str | None = None) -> None:
    await db.execute(
        update(User)
        .where(User.id == uuid.UUID(user_id))
        .values(telegram_user_id=tg_id, telegram_language=lang)
    )
    await db.commit()


def _start_param(call: dict) -> str:
    url = call["markup"]["inline_keyboard"][0][0]["web_app"]["url"]
    return url.split("startapp=", 1)[1]


def _button_text(call: dict) -> str:
    return call["markup"]["inline_keyboard"][0][0]["text"]


async def _swipe(client, headers, target_id, action="like", message=None):
    body = {"target_user_id": target_id, "action": action}
    if message:
        body["message"] = message
    resp = await client.post(f"{API}/feed/swipe", json=body, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _send_text(client, headers, chat_id, body):
    resp = await client.post(
        f"{API}/chats/{chat_id}/messages", json={"body": body}, headers=headers
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _linked_pair(client, db_session, sent):
    """Pereche cu match, ambii legați de Telegram; golește notificările match-ului."""
    (a_headers, a_id), (b_headers, b_id) = await _matched_pair(client)
    await tg_notify.drain()
    await _link_tg(db_session, a_id, TG_A)
    await _link_tg(db_session, b_id, TG_B)
    tg_notify.reset_state()
    sent.clear()
    chat_id = await _chat_id_for(client, a_headers)
    return (a_headers, a_id), (b_headers, b_id), chat_id


class _FakeRedis:
    """Subsetul de `redis.asyncio` folosit de `tg_notify` (fără expirare reală)."""

    def __init__(self):
        self.data: dict[str, str] = {}

    async def set(self, key, value, ex=None, nx=False):
        if nx and key in self.data:
            return None
        self.data[key] = value
        return True

    async def incr(self, key):
        self.data[key] = str(int(self.data.get(key, 0)) + 1)
        return int(self.data[key])

    async def expire(self, key, ttl):
        return True

    async def exists(self, key):
        return int(key in self.data)

    def pipeline(self, transaction=True):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, redis):
        self.redis, self.ops = redis, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def get(self, key):
        self.ops.append(("get", key))

    def delete(self, key):
        self.ops.append(("delete", key))

    async def execute(self):
        out = []
        for op, key in self.ops:
            out.append(self.redis.data.get(key) if op == "get" else self.redis.data.pop(key, None))
        return out


# --- Mesaje ---------------------------------------------------------------------
async def test_mesaj_trimite_o_notificare_cu_buton_spre_chat(client, db_session, sent):
    (a_headers, _), _, chat_id = await _linked_pair(client, db_session, sent)

    await _send_text(client, a_headers, chat_id, "Salut! Mergem diseară?")
    await tg_notify.drain()

    assert len(sent) == 1
    call = sent[0]
    assert call["chat_id"] == TG_B
    assert call["parse_mode"] == "HTML"
    assert "<b>Alice</b>" in call["text"]
    assert "«Salut! Mergem diseară?»" in call["text"]
    assert _start_param(call) == f"chat_{chat_id}"
    assert _button_text(call) == bot_texts.button("ro", "notify_reply")
    assert telegram_bot.normalize_start_param(_start_param(call)) == f"chat_{chat_id}"


async def test_previzualizarea_e_mascata_escapata_si_scurtata(client, db_session, sent):
    (a_headers, _), _, chat_id = await _linked_pair(client, db_session, sent)

    # API-ul de chat refuză deja HTML-ul în mesaje; un `&` trece și trebuie escapat.
    body = "Tom & Jerry, sună-mă la +37369123456 " + "bla " * 60
    await _send_text(client, a_headers, chat_id, body)
    await tg_notify.drain()

    text = sent[0]["text"]
    assert "37369123456" not in text  # aceeași mascare ca în chat
    assert "Tom &amp; Jerry" in text
    quote = text.split("«", 1)[1].split("»", 1)[0]
    assert len(quote) < 120 and quote.endswith("…")
    # Escaparea e aplicată și oricărui text venit pe altă cale (ex. un nume).
    assert bot_texts.message_preview("ro", "text", "<b>x</b>") == "&lt;b&gt;x&lt;/b&gt;"
    assert "<b>&lt;i&gt;Ana</b>" in bot_texts.notify_story("ro", "<i>Ana")


async def test_atasament_apare_ca_eticheta(client, db_session, sent, monkeypatch, tmp_path):
    from app.services import storage
    from tests.conftest import PNG_1X1

    monkeypatch.setattr(storage.settings, "storage_provider", "local")
    monkeypatch.setattr(storage.settings, "storage_local_dir", str(tmp_path))
    monkeypatch.setattr(storage.settings, "storage_base_url", "https://api.flrt.md/media")
    (a_headers, _), _, chat_id = await _linked_pair(client, db_session, sent)

    resp = await client.post(
        f"{API}/chats/{chat_id}/attachments",
        files={"file": ("p.png", PNG_1X1, "image/png")},
        headers=a_headers,
    )
    assert resp.status_code == 201, resp.text
    await tg_notify.drain()

    assert len(sent) == 1
    assert "📷 Foto" in sent[0]["text"]


async def test_mesajele_sunt_strangulate_si_apoi_numarate(client, db_session, sent):
    (a_headers, _), _, chat_id = await _linked_pair(client, db_session, sent)

    for body in ("unu", "doi", "trei"):
        await _send_text(client, a_headers, chat_id, body)
    await tg_notify.drain()
    assert len(sent) == 1  # o singură notificare / chat / 3 minute

    tg_notify.reset_state()  # fereastra de 3 minute a expirat
    await _send_text(client, a_headers, chat_id, "patru")
    await tg_notify.drain()
    assert len(sent) == 2
    assert "«patru»" in sent[1]["text"]
    assert "și încă 3 mesaje" in sent[1]["text"]  # celelalte necitite


async def test_mesaj_deja_citit_nu_mai_notifica(client, db_session, sent, monkeypatch):
    (a_headers, _), (b_headers, _), chat_id = await _linked_pair(client, db_session, sent)
    gate = asyncio.Event()
    original = tg_notify._prepare

    async def slow_prepare(*args):
        await gate.wait()
        return await original(*args)

    monkeypatch.setattr(tg_notify, "_prepare", slow_prepare)
    await _send_text(client, a_headers, chat_id, "salut")
    # B are chatul deschis și îl citește înainte ca notificarea să plece.
    resp = await client.post(f"{API}/chats/{chat_id}/read", headers=b_headers)
    assert resp.status_code == 204
    gate.set()
    await tg_notify.drain()
    assert sent == []


# --- Like / super like ----------------------------------------------------------
async def test_like_notifica_tinta_cu_numele_si_buton_likes(client, db_session, sent):
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    result = await _swipe(client, a_headers, b_id)
    await tg_notify.drain()

    assert result["matched"] is False
    assert len(sent) == 1
    assert sent[0]["chat_id"] == TG_B
    assert "<b>Alice</b> te-a plăcut" in sent[0]["text"]
    assert _start_param(sent[0]) == "likes"


async def test_like_anonim_cand_lista_e_restrictionata(client, db_session, sent, monkeypatch):
    monkeypatch.setattr(tg_notify, "LIKE_REVEALS_NAME", False)
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id)
    await tg_notify.drain()

    assert len(sent) == 1
    assert "Alice" not in sent[0]["text"]
    assert "Cineva te-a plăcut" in sent[0]["text"]


async def test_dislike_si_re_like_identic_nu_notifica(client, db_session, sent):
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id, "dislike")
    await tg_notify.drain()
    assert sent == []
    await _swipe(client, a_headers, b_id, "like")
    await tg_notify.drain()
    tg_notify.reset_state()
    await _swipe(client, a_headers, b_id, "like")  # re-swipe identic: nicio trecere
    await tg_notify.drain()
    assert len(sent) == 1


async def _likers_to(client, target_id, n, offset=0):
    for i in range(n):
        headers, _ = await _make_user(client, f"l{offset + i}@example.com", f"Liker{offset + i}")
        await _swipe(client, headers, target_id)


async def test_like_urile_se_aduna_in_fereastra_de_15_minute(client, db_session, sent):
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _likers_to(client, b_id, 3)
    await tg_notify.drain()
    assert len(sent) == 1  # 1 / destinatar / 15 min

    tg_notify._local._data.pop(f"tgn:like:{b_id}")  # fereastra a expirat, contorul nu
    await _likers_to(client, b_id, 1, offset=3)
    await tg_notify.drain()
    assert len(sent) == 2
    assert "Ai primit <b>3</b> like-uri noi" in sent[1]["text"]
    assert "Liker" not in sent[1]["text"]


async def test_agregarea_like_urilor_si_prin_redis(client, db_session, sent, monkeypatch):
    fake = _FakeRedis()

    async def get_fake():
        return fake

    monkeypatch.setattr(telegram_bot, "_get_redis", get_fake)
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _likers_to(client, b_id, 2)
    await tg_notify.drain()
    assert len(sent) == 1
    assert fake.data[f"tgn:likec:{b_id}"] == "1"

    fake.data.pop(f"tgn:like:{b_id}")
    await _likers_to(client, b_id, 1, offset=2)
    await tg_notify.drain()
    assert len(sent) == 2
    assert "Ai primit <b>2</b> like-uri noi" in sent[1]["text"]
    assert tg_notify._local._data == {}  # nimic pe rezerva locală


async def test_redis_cazut_fail_open_cu_plafon_local(client, db_session, sent, monkeypatch):
    async def broken():
        raise ConnectionError("redis down")

    monkeypatch.setattr(telegram_bot, "_get_redis", broken)
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _likers_to(client, b_id, 2)
    await tg_notify.drain()
    assert len(sent) == 1  # a plecat (fail open), dar fereastra s-a aplicat local


async def test_super_like_mereu_dar_max_unul_pe_zi(client, db_session, sent):
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    assert len(sent) == 1
    assert "<b>Alice</b> ți-a dat SUPER LIKE" in sent[0]["text"]
    assert _start_param(sent[0]) == "likes"
    assert _button_text(sent[0]) == bot_texts.button("ro", "notify_see_profile")

    # Super like-ul NU intră în fereastra like-urilor obișnuite…
    await _swipe(client, a_headers, b_id, "dislike")
    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    assert len(sent) == 1  # …dar e plafonat la 1 / autor → destinatar / zi


# --- Match ----------------------------------------------------------------------
async def test_match_notifica_tinta_cu_buton_spre_chat(client, db_session, sent):
    a_headers, a_id = await _make_user(client, "a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, a_id, TG_A)
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id)  # like → B
    await tg_notify.drain()
    sent.clear()
    result = await _swipe(client, b_headers, a_id, message="Salut, Alice!")  # match
    await tg_notify.drain()

    assert result["matched"] is True
    assert len(sent) == 1  # doar match-ul, nu și like + mesaj
    call = sent[0]
    assert call["chat_id"] == TG_A
    assert "Aveți un match cu <b>Bob</b>" in call["text"]
    assert "«Salut, Alice!»" in call["text"]
    assert _start_param(call) == f"chat_{result['chat_id']}"


async def test_match_fara_mesaj_invita_la_primul_salut(client, db_session, sent):
    a_headers, a_id = await _make_user(client, "a@example.com", "Alice")
    b_headers, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, a_id, TG_A)

    await _swipe(client, a_headers, b_id)
    result = await _swipe(client, b_headers, a_id)
    await tg_notify.drain()

    assert len(sent) == 1
    assert _button_text(sent[0]) == bot_texts.button("ro", "notify_write_first")
    assert _start_param(sent[0]) == f"chat_{result['chat_id']}"

    sent.clear()
    await _swipe(client, b_headers, a_id)  # re-swipe pe un match existent
    await tg_notify.drain()
    assert sent == []


# --- Povești --------------------------------------------------------------------
async def _post_story(client, headers):
    me = await client.get(f"{API}/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    media_url = f"{settings.storage_base_url}/stories/{me.json()['id']}/{uuid.uuid4().hex}.jpg"
    resp = await client.post(
        f"{API}/stories/", json={"media_url": media_url}, headers=headers
    )
    assert resp.status_code == 201, resp.text


async def test_poveste_notifica_match_urile_o_data_la_6_ore(client, db_session, sent):
    (a_headers, a_id), _, _ = await _linked_pair(client, db_session, sent)

    await _post_story(client, a_headers)
    await _post_story(client, a_headers)
    await tg_notify.drain()

    assert len(sent) == 1
    assert sent[0]["chat_id"] == TG_B
    assert "<b>Alice</b> a pus o poveste nouă" in sent[0]["text"]
    assert _start_param(sent[0]) == f"stories_{a_id}"


# --- Cui NU se trimite ----------------------------------------------------------
async def test_preferinta_oprita_nu_trimite(client, db_session, sent):
    (a_headers, _), (b_headers, _), chat_id = await _linked_pair(client, db_session, sent)
    resp = await client.put(
        f"{API}/notifications/telegram", json={"messages": False}, headers=b_headers
    )
    assert resp.status_code == 200

    await _send_text(client, a_headers, chat_id, "salut")
    await _post_story(client, a_headers)  # poveștile rămân pornite
    await tg_notify.drain()

    assert len(sent) == 1 and "poveste" in sent[0]["text"]


async def test_fara_telegram_user_id_nu_trimite(client, db_session, sent):
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")

    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    assert sent == []


async def test_blocat_nu_trimite(client, db_session, sent):
    (a_headers, a_id), (_, b_id), chat_id = await _linked_pair(client, db_session, sent)
    db_session.add(Block(blocker_id=uuid.UUID(b_id), blocked_id=uuid.UUID(a_id)))
    await db_session.commit()

    await _post_story(client, a_headers)  # match-ul rămâne, dar B l-a blocat pe A
    tg_notify.notify_message(
        chat_id=uuid.UUID(chat_id), sender_id=uuid.UUID(a_id),
        recipient_id=uuid.UUID(b_id), kind="text", body="hei",
    )
    tg_notify.notify_like(actor_id=uuid.UUID(a_id), recipient_id=uuid.UUID(b_id), is_super=True)
    await tg_notify.drain()
    assert sent == []


async def test_autorul_banat_sau_actiune_proprie_nu_trimite(client, db_session, sent):
    (_, a_id), (_, b_id), chat_id = await _linked_pair(client, db_session, sent)

    tg_notify.notify_like(actor_id=uuid.UUID(b_id), recipient_id=uuid.UUID(b_id), is_super=True)
    tg_notify.notify_match(
        actor_id=uuid.UUID(b_id), recipient_id=uuid.UUID(b_id), chat_id=uuid.UUID(chat_id)
    )
    await tg_notify.drain()
    assert sent == []

    await db_session.execute(
        update(User).where(User.id == uuid.UUID(a_id)).values(banned_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    tg_notify.notify_match(
        actor_id=uuid.UUID(a_id), recipient_id=uuid.UUID(b_id), chat_id=uuid.UUID(chat_id)
    )
    await tg_notify.drain()
    assert sent == []


async def test_limba_destinatarului(client, db_session, sent):
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B, lang="ru")

    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    assert "SUPER LIKE от <b>Alice</b>" in sent[0]["text"]
    assert _button_text(sent[0]) == bot_texts.button("ru", "notify_see_profile")


async def test_loginul_telegram_retine_limba(db_session):
    await auth_service.login_with_telegram(
        db_session, TelegramUser(id=777, first_name="Ivan", language_code="uk-UA")
    )
    lang = await db_session.scalar(
        select(User.telegram_language).where(User.telegram_user_id == 777)
    )
    assert lang == "ru"


# --- Eșecurile Telegram nu strică cererea ---------------------------------------
async def test_telegram_cazut_nu_strica_cererile(client, db_session, sent, monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("telegram a explodat")

    monkeypatch.setattr(telegram_bot, "send_message", boom)
    (a_headers, _), (_, b_id), chat_id = await _linked_pair(client, db_session, sent)

    await _send_text(client, a_headers, chat_id, "salut")
    await _post_story(client, a_headers)
    c_headers, _ = await _make_user(client, "c@example.com", "Cora")
    await _swipe(client, c_headers, b_id, "super_like")
    await tg_notify.drain()  # excepțiile au fost înghițite și logate


async def test_cererea_nu_asteapta_telegramul(client, db_session, sent, monkeypatch):
    gate = asyncio.Event()

    async def slow_send(*args, **kwargs):
        await gate.wait()
        return {"ok": True}

    monkeypatch.setattr(telegram_bot, "send_message", slow_send)
    (a_headers, _), _, chat_id = await _linked_pair(client, db_session, sent)

    await asyncio.wait_for(_send_text(client, a_headers, chat_id, "salut"), timeout=5)
    assert tg_notify._pending  # notificarea încă așteaptă Telegramul
    gate.set()
    await tg_notify.drain()


async def test_403_nu_se_reincearca_si_e_tinut_minte(client, db_session, sent, monkeypatch):
    calls = []

    async def forbidden(chat_id, text, **kwargs):
        calls.append(chat_id)
        return {"ok": False, "error_code": 403, "description": "Forbidden: bot was blocked by the user"}

    monkeypatch.setattr(telegram_bot, "send_message", forbidden)
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    c_headers, _ = await _make_user(client, "c@example.com", "Cora")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    await _swipe(client, c_headers, b_id, "super_like")
    await tg_notify.drain()
    assert calls == [TG_B]  # al doilea super like nici nu mai încearcă


async def test_429_se_pierde_fara_reincercare(client, db_session, sent, monkeypatch):
    calls = []

    async def flood(chat_id, text, **kwargs):
        calls.append(chat_id)
        return {"ok": False, "error_code": 429, "description": "Too Many Requests"}

    monkeypatch.setattr(telegram_bot, "send_message", flood)
    a_headers, _ = await _make_user(client, "a@example.com", "Alice")
    _, b_id = await _make_user(client, "b@example.com", "Bob")
    await _link_tg(db_session, b_id, TG_B)

    await _swipe(client, a_headers, b_id, "super_like")
    await tg_notify.drain()
    assert calls == [TG_B]
    assert not tg_notify._local.exists(f"tgn:forbidden:{TG_B}")


# --- Setări: GET / PUT /notifications/telegram ----------------------------------
async def test_setari_implicit_toate_pornite_si_update_partial(client):
    headers, _ = await _make_user(client, "a@example.com", "Alice")
    url = f"{API}/notifications/telegram"

    resp = await client.get(url, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"messages": True, "likes": True, "stories": True, "matches": True}

    resp = await client.put(url, json={"likes": False, "stories": False}, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"messages": True, "likes": False, "stories": False, "matches": True}

    resp = await client.put(url, json={}, headers=headers)
    assert resp.json()["likes"] is False
    assert (await client.get(url, headers=headers)).json()["stories"] is False


@pytest.mark.parametrize(
    "body",
    [{"sms": True}, {"likes": "false"}, {"likes": 0}, {"likes": None}, ["likes"]],
)
async def test_setari_422_pe_date_invalide(client, body):
    headers, _ = await _make_user(client, "a@example.com", "Alice")
    resp = await client.put(f"{API}/notifications/telegram", json=body, headers=headers)
    assert resp.status_code == 422, resp.text


async def test_setari_cer_autentificare(client):
    assert (await client.get(f"{API}/notifications/telegram")).status_code == 401
    resp = await client.put(f"{API}/notifications/telegram", json={"likes": False})
    assert resp.status_code == 401


# --- Migrare & texte ------------------------------------------------------------
def test_migrarea_are_un_singur_head():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1
    chain = {r.revision for r in script.walk_revisions("base", heads[0])}
    assert "d3f8a1c5e2b9" in chain
    assert script.get_revision("d3f8a1c5e2b9").down_revision == "c9e2f6a4d1b7"


_BUTTON_KEYS = (
    "notify_reply", "notify_see_likes", "notify_see_profile",
    "notify_write_first", "notify_see_story",
)


@pytest.mark.parametrize("lang", bot_texts.LANGS)
def test_sabloanele_exista_in_toate_limbile_si_incap(lang):
    long_name = "X" * 500
    long_body = "y" * 5000
    texts = [
        bot_texts.notify_message(lang, long_name, "text", long_body, 99),
        bot_texts.notify_message(lang, "Ana", "voice", "", 0),
        bot_texts.notify_like(lang, long_name),
        bot_texts.notify_like(lang, None),
        bot_texts.notify_like(lang, None, 21),
        bot_texts.notify_super_like(lang, long_name),
        bot_texts.notify_match(lang, long_name),
        bot_texts.notify_match(lang, long_name, "text", long_body),
        bot_texts.notify_story(lang, long_name),
        bot_texts.notify_story(lang, None),
    ]
    for text in texts:
        assert text and len(text) <= 400 < 4096
        assert "X" * (bot_texts.NOTIFY_NAME_MAX + 1) not in text
    for key in _BUTTON_KEYS:
        assert 0 < len(bot_texts.button(lang, key)) <= 24
    assert set(bot_texts.BUTTONS[lang]) == set(bot_texts.BUTTONS["ro"])
    for kind in ("image", "video", "voice"):
        assert bot_texts.attachment_label(lang, kind)


def test_parametrii_de_start_trec_validarea():
    some_id = uuid.uuid4()
    for param in (
        tg_notify.start_chat(some_id),
        tg_notify.start_stories(some_id),
        tg_notify.START_LIKES,
        tg_notify.START_FEED,
    ):
        assert telegram_bot.normalize_start_param(param) == param


def test_pluralul_romanesc_si_rusesc():
    assert "1 like nou" not in bot_texts.notify_like("ro", None, 2)
    assert "<b>2</b> like-uri noi" in bot_texts.notify_like("ro", None, 2)
    assert "<b>20</b> de like-uri noi" in bot_texts.notify_like("ro", None, 20)
    assert "<b>5</b> новых лайков" in bot_texts.notify_like("ru", None, 5)
    assert "<b>3</b> новых лайка" in bot_texts.notify_like("ru", None, 3)
    assert "<b>21</b> новый лайк" in bot_texts.notify_like("ru", None, 21)
