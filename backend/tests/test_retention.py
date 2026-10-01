"""Retenția datelor: purjarea contului (fișiere + comenzi anonimizate) și
ștergerea periodică a dovezilor de plată (app/services/retention_service.py)."""
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.core.config import settings
from app.core.logging import anonymize_ip
from app.core.security import hash_password
from app.models.chat import Chat, Message
from app.models.event import Event
from app.models.profile import Profile
from app.models.story import Story
from app.models.swipe import Match
from app.models.ticket_order import (
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_REJECTED,
    TicketOrder,
)
from app.models.user import User
from app.services import account_service, legal_service, retention_service

BASE = "https://media.test"


class _FakeStorage:
    def __init__(self):
        self.deleted: list[str] = []

    async def delete(self, url: str) -> None:
        self.deleted.append(url)


@pytest.fixture
def storage(monkeypatch):
    fake = _FakeStorage()
    monkeypatch.setattr(retention_service, "get_storage", lambda: fake)
    return fake


async def _user(db, email):
    u = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"))
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def _event(db):
    e = Event(title="Party", city="Chișinău", kind="party",
              starts_at=datetime.now(timezone.utc) + timedelta(days=3),
              ticket_price=100.0, ticket_currency="lei")
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return e


def _order(user, event, status, proof, **kw):
    return TicketOrder(
        user_id=user.id, event_id=event.id, price=100.0, total_amount=200.0,
        ticket_quantity=2, currency="lei", reference="U-ABCDEF12", status=status,
        full_name="Ana Popescu", phone="+37369000000", email="ana@example.com",
        client_message="salut", user_note="am plătit", admin_note="ok Ana",
        payment_description="Bilet Party – Ana Popescu", payment_proof_url=proof, **kw,
    )


@pytest.mark.asyncio
async def test_purge_deletes_media_and_anonymizes_orders(db_session, storage):
    db = db_session
    ana = await _user(db, "ana-ret@example.com")
    bob = await _user(db, "bob-ret@example.com")
    event = await _event(db)

    db.add(Profile(user_id=ana.id, name="Ana", birth_date=date(1995, 1, 1),
                   gender="female", height_cm=165, city="Chișinău", languages=["ro"],
                   dating_statuses=["serious"],
                   photos=[f"{BASE}/photos/p/1.jpg", f"{BASE}/photos/p/2.jpg"]))
    db.add(Story(user_id=ana.id, media_url=f"{BASE}/stories/a/s.jpg",
                 expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    match = Match(user_a_id=ana.id, user_b_id=bob.id)
    db.add(match)
    await db.flush()
    chat = Chat(match_id=match.id, user_a_id=ana.id, user_b_id=bob.id)
    db.add(chat)
    await db.flush()
    db.add(Message(chat_id=chat.id, sender_id=ana.id, body="", kind="image",
                   attachment_url=f"{BASE}/chat-media/c/a.jpg"))
    db.add(Message(chat_id=chat.id, sender_id=bob.id, body="", kind="voice",
                   attachment_url=f"{BASE}/chat-media/c/b.m4a"))
    db.add(Message(chat_id=chat.id, sender_id=bob.id, body="hei"))
    approved = _order(ana, event, STATUS_APPROVED, f"{BASE}/ticket-proofs/o1/x.jpg",
                      ticket_code="CODE-1")
    rejected = _order(ana, event, STATUS_REJECTED, f"{BASE}/ticket-proofs/o2/y.jpg")
    other = _order(bob, event, STATUS_APPROVED, f"{BASE}/ticket-proofs/o3/z.jpg")
    db.add_all([approved, rejected, other])
    await db.commit()

    ana_id, event_id = ana.id, event.id
    approved_id, rejected_id, other_id = approved.id, rejected.id, other.id
    await account_service.purge_user_data(db, ana_id)
    await db.commit()

    assert set(storage.deleted) == {
        f"{BASE}/photos/p/1.jpg", f"{BASE}/photos/p/2.jpg",
        f"{BASE}/stories/a/s.jpg",
        f"{BASE}/chat-media/c/a.jpg", f"{BASE}/chat-media/c/b.m4a",
        f"{BASE}/ticket-proofs/o2/y.jpg",  # respinsă → nu e document contabil
    }
    assert (await db.execute(select(Message))).scalars().all() == []

    db.expire_all()
    a = await db.get(TicketOrder, approved_id)
    for field in ("full_name", "phone", "email", "client_message", "user_note",
                  "admin_note", "payment_description"):
        assert getattr(a, field) is None, field
    # Evidența contabilă rămâne.
    assert (a.total_amount, a.currency, a.reference, a.status, a.event_id, a.ticket_code) == (
        200.0, "lei", "U-ABCDEF12", STATUS_APPROVED, event_id, "CODE-1")
    assert a.payment_proof_url == f"{BASE}/ticket-proofs/o1/x.jpg"  # termen contabil
    assert a.user_id == ana_id  # spre rândul `users` anonimizat (tombstone)
    r = await db.get(TicketOrder, rejected_id)
    assert r.payment_proof_url is None and r.full_name is None
    # Comenzile altui user rămân neatinse.
    o = await db.get(TicketOrder, other_id)
    assert o.full_name == "Ana Popescu" and o.payment_proof_url

    # Idempotent.
    storage.deleted.clear()
    await account_service.purge_user_data(db, ana_id)
    await db.commit()
    assert storage.deleted == []


@pytest.mark.asyncio
async def test_periodic_proof_retention(db_session, storage):
    db = db_session
    u = await _user(db, "ret-periodic@example.com")
    event = await _event(db)
    now = datetime.now(timezone.utc)
    old = _order(u, event, STATUS_APPROVED, f"{BASE}/ticket-proofs/old/a.jpg")
    fresh = _order(u, event, STATUS_APPROVED, f"{BASE}/ticket-proofs/new/b.jpg")
    rej_old = _order(u, event, STATUS_REJECTED, f"{BASE}/ticket-proofs/rj/c.jpg",
                     decided_at=now - timedelta(days=settings.rejected_payment_proof_retention_days + 1))
    rej_new = _order(u, event, STATUS_REJECTED, f"{BASE}/ticket-proofs/rn/d.jpg",
                     decided_at=now - timedelta(days=1))
    canc_old = _order(u, event, STATUS_CANCELLED, f"{BASE}/ticket-proofs/co/e.jpg")
    db.add_all([old, fresh, rej_old, rej_new, canc_old])
    await db.commit()
    await db.execute(update(TicketOrder).where(TicketOrder.id == old.id).values(
        created_at=now - timedelta(days=settings.payment_proof_retention_days + 1)))
    await db.execute(update(TicketOrder).where(TicketOrder.id == canc_old.id).values(
        updated_at=now - timedelta(days=settings.rejected_payment_proof_retention_days + 1)))
    await db.commit()

    old_id, fresh_id, rej_new_id = old.id, fresh.id, rej_new.id
    n = await retention_service.purge_expired_payment_proofs(db, now=now)

    assert n == 3
    assert set(storage.deleted) == {
        f"{BASE}/ticket-proofs/old/a.jpg", f"{BASE}/ticket-proofs/rj/c.jpg",
        f"{BASE}/ticket-proofs/co/e.jpg"}
    db.expire_all()
    assert (await db.get(TicketOrder, old_id)).payment_proof_url is None
    assert (await db.get(TicketOrder, old_id)).total_amount == 200.0  # rândul rămâne
    assert (await db.get(TicketOrder, fresh_id)).payment_proof_url
    assert (await db.get(TicketOrder, rej_new_id)).payment_proof_url
    # A doua trecere nu mai are nimic de făcut.
    assert await retention_service.purge_expired_payment_proofs(db, now=now) == 0


@pytest.mark.asyncio
async def test_delete_files_survives_storage_errors(monkeypatch):
    class Boom:
        calls = 0

        async def delete(self, url):
            Boom.calls += 1
            if url.endswith("bad"):
                raise RuntimeError("s3 down")

    monkeypatch.setattr(retention_service, "get_storage", lambda: Boom())
    assert await retention_service.delete_files(["x/bad", "x/good"]) == 1
    assert Boom.calls == 2


def test_anonymize_ip():
    assert anonymize_ip("81.180.75.123") == "81.180.75.0"
    assert anonymize_ip("2a02:2f0e:1234:5678::1") == "2a02:2f0e:1234::"
    assert anonymize_ip("anonymous") == "anonymous"


def test_policy_states_configured_retention():
    for lang in ("ro", "ru", "en"):
        text = legal_service.render_document("privacy", lang)["content"]
        assert "{{" not in text
        assert str(settings.rejected_payment_proof_retention_days) in text
        assert str(settings.log_retention_days) in text
        assert "287/2017" in text
