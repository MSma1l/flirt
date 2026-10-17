"""Val 2 pe bilete: coduri stabile la sold-out, date de plată la `additional_information_required`,
filtre + numărători pentru cozile de admin, capacitatea în admin events, textul
notificării la anulare/respingere, corecția `tickets_sold`, singleton-ul de fidelitate.
"""
from __future__ import annotations

import asyncio
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.core.errors import CodedHTTPException, ErrorCode
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.event import Event
from app.models.loyalty import LoyaltySettings
from app.models.ticket_order import (
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
    STATUS_APPROVED,
    STATUS_AWAITING_PAYMENT,
    STATUS_CANCELLED,
    STATUS_PENDING_PAYMENT,
    STATUS_PROOF_SUBMITTED,
    STATUS_REJECTED,
    STATUS_UNDER_REVIEW,
    TICKET_ORDER_STATUSES,
    TicketOrder,
)
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import TicketRequestCreateIn
from app.services import loyalty
from app.services import ticket_order_service as T

API = "/api/v1"
PASSWORD = "Str0ng-Passw0rd!"
PROOF = "https://storage.example/ticket-proofs/x/proof.png"
BACKEND = Path(__file__).resolve().parents[1]

pytestmark = pytest.mark.asyncio


async def _user(db, email, *, admin=False) -> User:
    user = User(email=email, password_hash=hash_password(PASSWORD))
    if admin:
        user.role = ROLE_ADMIN
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _event(db, *, capacity=None, sold=0, title="Flirt W2") -> Event:
    event = Event(
        title=title,
        starts_at=datetime.now(timezone.utc) + timedelta(days=3),
        city="Chișinău",
        kind="party",
        ticket_price=100.0,
        ticket_currency="lei",
        ticket_capacity=capacity,
        tickets_sold=sold,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _request(db, user, event, qty=1):
    out = await T.create_request(
        db, user, event.id,
        TicketRequestCreateIn(full_name="Ana Pop", phone="+37360000000", ticket_quantity=qty),
    )
    return out.request.id


async def _login(client, user: User) -> dict:
    resp = await client.post(f"{API}/auth/login", json={"email": user.email, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _set_status(db, order_id, status_value):
    order = await db.get(TicketOrder, order_id)
    order.status = status_value
    await db.commit()


# --------------------------------------------------------------------------- #
# 1. Sold-out → 409 cu `code=tickets_sold_out`
# --------------------------------------------------------------------------- #
async def test_sold_out_conflicts_carry_stable_code(db_session):
    admin = await _user(db_session, "so2_admin@example.com", admin=True)
    a = await _user(db_session, "so2_a@example.com")
    b = await _user(db_session, "so2_b@example.com")
    c = await _user(db_session, "so2_c@example.com")
    event = await _event(db_session, capacity=1)
    oa = (await T.create_order(db_session, a, event.id)).order.id
    ob = (await T.create_order(db_session, b, event.id)).order.id
    await T.approve(db_session, admin, oa)

    # Aprobare peste capacitate.
    with pytest.raises(CodedHTTPException) as exc:
        await T.approve(db_session, admin, ob)
    assert exc.value.status_code == 409
    assert exc.value.code == ErrorCode.TICKETS_SOLD_OUT == "tickets_sold_out"
    # Comandă nouă / cerere nouă pe un eveniment epuizat.
    with pytest.raises(CodedHTTPException) as exc:
        await T.create_order(db_session, c, event.id)
    assert (exc.value.status_code, exc.value.code) == (409, "tickets_sold_out")
    with pytest.raises(CodedHTTPException) as exc:
        await _request(db_session, c, event)
    assert (exc.value.status_code, exc.value.code) == (409, "tickets_sold_out")


async def test_sold_out_code_reaches_the_api_body(client, db_session):
    buyer = await _user(db_session, "so2_api@example.com")
    event = await _event(db_session, capacity=1, sold=1)
    resp = await client.post(
        f"{API}/events/{event.id}/ticket-orders", headers=await _login(client, buyer)
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "tickets_sold_out"
    assert body["detail"]  # textul rămâne pentru clienții vechi


# --------------------------------------------------------------------------- #
# 2. GET /ticket-orders/{id}: date de plată și în `additional_information_required`
# --------------------------------------------------------------------------- #
async def test_direct_order_needing_info_returns_payment(client, db_session):
    buyer = await _user(db_session, "info_buyer@example.com")
    event = await _event(db_session)
    oid = (await T.create_order(db_session, buyer, event.id)).order.id
    await _set_status(db_session, oid, STATUS_ADDITIONAL_INFORMATION_REQUIRED)

    out = await T.get_mine(db_session, buyer, oid)
    assert out.payment is not None
    assert out.payment.reference == out.order.reference
    resp = await client.get(f"{API}/ticket-orders/{oid}", headers=await _login(client, buyer))
    assert resp.status_code == 200, resp.text
    assert resp.json()["payment"]["reference"] == out.order.reference

    # Aprobată → nimic de plătit.
    await _set_status(db_session, oid, STATUS_APPROVED)
    assert (await T.get_mine(db_session, buyer, oid)).payment is None


# --------------------------------------------------------------------------- #
# 3. Admin: filtre `event_id`, numărători, paginare pe cereri
# --------------------------------------------------------------------------- #
async def test_admin_orders_event_filter_and_counts(client, db_session):
    admin = await _user(db_session, "cnt_admin@example.com", admin=True)
    e1 = await _event(db_session, title="E1")
    e2 = await _event(db_session, title="E2")
    ids = []
    for i in range(3):
        buyer = await _user(db_session, f"cnt_{i}@example.com")
        ids.append((await T.create_order(db_session, buyer, e1.id)).order.id)
    other = await _user(db_session, "cnt_other@example.com")
    await T.create_order(db_session, other, e2.id)
    await T.approve(db_session, admin, ids[0])
    headers = await _login(client, admin)

    resp = await client.get(f"{API}/admin/ticket-orders?event_id={e1.id}", headers=headers)
    assert resp.status_code == 200, resp.text
    assert {o["id"] for o in resp.json()} == {str(i) for i in ids}
    # Combinat cu status + paginare pe cursor.
    resp = await client.get(
        f"{API}/admin/ticket-orders?event_id={e1.id}&status={STATUS_AWAITING_PAYMENT}&limit=1",
        headers=headers,
    )
    assert len(resp.json()) == 1 and resp.headers.get("X-Next-Cursor")
    resp2 = await client.get(
        f"{API}/admin/ticket-orders?event_id={e1.id}&status={STATUS_AWAITING_PAYMENT}"
        f"&limit=1&cursor={resp.headers['X-Next-Cursor']}",
        headers=headers,
    )
    assert len(resp2.json()) == 1 and "X-Next-Cursor" not in resp2.headers
    assert resp.json()[0]["id"] != resp2.json()[0]["id"]

    # Numărătorile: cheie pentru FIECARE stare, 0 implicit; nu sunt capturate ca id.
    resp = await client.get(f"{API}/admin/ticket-orders/counts?event_id={e1.id}", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["counts"]) == set(TICKET_ORDER_STATUSES)
    assert body["counts"][STATUS_APPROVED] == 1
    assert body["counts"][STATUS_AWAITING_PAYMENT] == 2
    assert body["counts"][STATUS_REJECTED] == 0
    assert body["total"] == 3
    resp = await client.get(f"{API}/admin/ticket-orders/counts", headers=headers)
    assert resp.json()["total"] == 4
    # Filtrul `q` (referința exactă) e respectat.
    ref = (await T.get_admin_order(db_session, ids[1])).reference
    resp = await client.get(f"{API}/admin/ticket-orders/counts?q={ref}", headers=headers)
    assert resp.json()["total"] >= 1
    resp = await client.get(f"{API}/admin/ticket-orders/counts?q=nu-exista", headers=headers)
    assert resp.json()["total"] == 0


async def test_admin_counts_require_admin(client, db_session):
    user = await _user(db_session, "cnt_plain@example.com")
    headers = await _login(client, user)
    for path in ("ticket-orders/counts", "ticket-requests/counts"):
        resp = await client.get(f"{API}/admin/{path}", headers=headers)
        assert resp.status_code == 403, (path, resp.text)
        resp = await client.get(f"{API}/admin/{path}")
        assert resp.status_code in (401, 403), (path, resp.text)


async def test_admin_requests_cursor_paging_status_list_and_counts(client, db_session):
    admin = await _user(db_session, "rq_admin@example.com", admin=True)
    e1 = await _event(db_session, title="R1")
    e2 = await _event(db_session, title="R2")
    rids = []
    for i in range(3):
        buyer = await _user(db_session, f"rq_{i}@example.com")
        rids.append(await _request(db_session, buyer, e1))
    other = await _user(db_session, "rq_other@example.com")
    await _request(db_session, other, e2)
    await _set_status(db_session, rids[0], STATUS_PROOF_SUBMITTED)
    await _set_status(db_session, rids[1], STATUS_UNDER_REVIEW)
    headers = await _login(client, admin)

    # Paginare pe cursor (fără duplicate, fără goluri).
    seen: list[str] = []
    cursor = None
    for _ in range(5):
        url = f"{API}/admin/ticket-requests?event_id={e1.id}&limit=2"
        if cursor:
            url += f"&cursor={cursor}"
        resp = await client.get(url, headers=headers)
        assert resp.status_code == 200, resp.text
        seen += [r["id"] for r in resp.json()]
        cursor = resp.headers.get("X-Next-Cursor")
        if not cursor:
            break
    assert sorted(seen) == sorted(str(r) for r in rids)
    assert len(seen) == len(set(seen))

    # `status` ca listă separată prin virgulă; o singură valoare merge în continuare.
    resp = await client.get(
        f"{API}/admin/ticket-requests?status={STATUS_PROOF_SUBMITTED},{STATUS_UNDER_REVIEW}",
        headers=headers,
    )
    assert {r["id"] for r in resp.json()} == {str(rids[0]), str(rids[1])}
    resp = await client.get(f"{API}/admin/ticket-requests?status={STATUS_UNDER_REVIEW}", headers=headers)
    assert [r["id"] for r in resp.json()] == [str(rids[1])]
    resp = await client.get(f"{API}/admin/ticket-requests?status=bogus", headers=headers)
    assert resp.status_code == 422
    resp = await client.get(f"{API}/admin/ticket-requests?cursor=%%%", headers=headers)
    assert resp.status_code == 422

    # Numărători: aceeași formă ca la comenzi; comenzile directe NU intră.
    await T.create_order(db_session, other, e1.id)
    resp = await client.get(f"{API}/admin/ticket-requests/counts?event_id={e1.id}", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body["counts"]) == set(TICKET_ORDER_STATUSES)
    assert body["counts"][STATUS_PENDING_PAYMENT] == 1
    assert body["counts"][STATUS_PROOF_SUBMITTED] == 1
    assert body["counts"][STATUS_UNDER_REVIEW] == 1
    assert body["counts"][STATUS_AWAITING_PAYMENT] == 0
    assert body["total"] == 3
    resp = await client.get(f"{API}/admin/ticket-requests/counts", headers=headers)
    assert resp.json()["total"] == 4


async def test_status_counts_is_a_single_query(db_session, engine):
    from sqlalchemy import event as sa_event

    await _event(db_session)
    statements: list[str] = []

    def _count(conn, cursor, statement, *args):
        statements.append(statement)

    sa_event.listen(engine.sync_engine, "before_cursor_execute", _count)
    try:
        await T.count_orders(db_session)
        await T.count_requests(db_session)
    finally:
        sa_event.remove(engine.sync_engine, "before_cursor_execute", _count)
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    assert len(selects) == 2
    assert all("GROUP BY" in s.upper() for s in selects)


# --------------------------------------------------------------------------- #
# 3d. Admin events: `ticket_capacity` + `tickets_sold`
# --------------------------------------------------------------------------- #
def _event_payload(**extra) -> dict:
    return {
        "title": "Cap Party",
        "starts_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
        "city": "Chișinău",
        "kind": "party",
        "ticket_price": 100,
        **extra,
    }


async def test_admin_event_capacity_roundtrip_and_guard(client, db_session):
    admin = await _user(db_session, "ev_admin@example.com", admin=True)
    headers = await _login(client, admin)

    resp = await client.post(f"{API}/admin/events", json=_event_payload(ticket_capacity=0), headers=headers)
    assert resp.status_code == 422
    resp = await client.post(f"{API}/admin/events", json=_event_payload(ticket_capacity=5), headers=headers)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["ticket_capacity"] == 5 and body["tickets_sold"] == 0
    eid = body["id"]

    # Fără capacitate în payload → rămâne neschimbată (editare parțială).
    resp = await client.put(f"{API}/admin/events/{eid}", json={"title": "Renamed"}, headers=headers)
    assert resp.status_code == 200 and resp.json()["ticket_capacity"] == 5

    event = await db_session.get(Event, eid)
    event.tickets_sold = 3
    await db_session.commit()

    resp = await client.put(f"{API}/admin/events/{eid}", json={"ticket_capacity": 2}, headers=headers)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "capacity_below_sold"
    resp = await client.put(f"{API}/admin/events/{eid}", json={"ticket_capacity": 3}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["ticket_capacity"] == 3 and resp.json()["tickets_sold"] == 3
    resp = await client.put(f"{API}/admin/events/{eid}", json={"ticket_capacity": None}, headers=headers)
    assert resp.status_code == 200 and resp.json()["ticket_capacity"] is None
    resp = await client.put(f"{API}/admin/events/{eid}", json={"ticket_capacity": 0}, headers=headers)
    assert resp.status_code == 422

    resp = await client.get(f"{API}/admin/events", headers=headers)
    listed = next(e for e in resp.json() if e["id"] == eid)
    assert listed["tickets_sold"] == 3 and listed["ticket_capacity"] is None
    # Eveniment fără capacitate în payload la creare → nelimitat.
    resp = await client.post(f"{API}/admin/events", json=_event_payload(), headers=headers)
    assert resp.status_code == 201 and resp.json()["ticket_capacity"] is None


# --------------------------------------------------------------------------- #
# 4. Textul notificării la decizia pe o cerere, fără comentariu
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "new_status, expected",
    [
        (STATUS_CANCELLED, "Cererea ta a fost anulată."),
        (STATUS_REJECTED, "Cererea ta a fost respinsă."),
        (STATUS_UNDER_REVIEW, "Cererea ta este în verificare."),
        (STATUS_ADDITIONAL_INFORMATION_REQUIRED, "Sunt necesare informații suplimentare pentru cererea ta."),
    ],
)
async def test_review_request_fallback_text_matches_status(db_session, monkeypatch, new_status, expected):
    sent: list[str] = []

    async def _fake_send(db, user_id, title, body, *a, **kw):
        sent.append(body)

    monkeypatch.setattr(T, "send_to_user", _fake_send)
    admin = await _user(db_session, f"txt_admin_{new_status}@example.com", admin=True)
    buyer = await _user(db_session, f"txt_buyer_{new_status}@example.com")
    rid = await _request(db_session, buyer, await _event(db_session))
    await T.review_request(db_session, admin, rid, new_status, None)
    assert sent[-1] == expected


async def test_review_request_comment_wins_and_approval_text_fixed(db_session, monkeypatch):
    sent: list[str] = []

    async def _fake_send(db, user_id, title, body, *a, **kw):
        sent.append(body)

    monkeypatch.setattr(T, "send_to_user", _fake_send)
    admin = await _user(db_session, "txt2_admin@example.com", admin=True)
    buyer = await _user(db_session, "txt2_buyer@example.com")
    event = await _event(db_session)
    rid = await _request(db_session, buyer, event)
    await T.review_request(db_session, admin, rid, STATUS_REJECTED, "Suma greșită.")
    assert sent[-1] == "Suma greșită."
    buyer2 = await _user(db_session, "txt2_buyer2@example.com")
    rid2 = await _request(db_session, buyer2, event)
    await T.submit_payment_proof(db_session, buyer2, rid2, PROOF)
    await T.review_request(db_session, admin, rid2, STATUS_APPROVED, "ignorat")
    assert sent[-1].startswith("Plata a fost confirmată.")


# --------------------------------------------------------------------------- #
# 5. Migrația de date `tickets_sold`
# --------------------------------------------------------------------------- #
def _load_migration():
    path = BACKEND / "alembic" / "versions" / "b8e1d4f7a2c3_recompute_tickets_sold.py"
    spec = importlib.util.spec_from_file_location("mig_b8e1d4f7a2c3", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_alembic_has_a_single_head_on_the_recompute_migration():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    # Un singur head; migrarea de recalculare rămâne în lanț (peste ea pot veni
    # migrări noi, ex. comutatorul global al vânzării online).
    assert len(heads) == 1, heads
    assert "b8e1d4f7a2c3" in {r.revision for r in script.walk_revisions()}
    assert _load_migration().down_revision == "a7d3f5c9b2e8"


async def test_recompute_tickets_sold_sql(db_session):
    admin = await _user(db_session, "mig_admin@example.com", admin=True)
    e1 = await _event(db_session, sold=0, title="M1")  # direct aprobat, necontorizat
    e2 = await _event(db_session, sold=7, title="M2")  # contor umflat, nimic aprobat
    e3 = await _event(db_session, sold=0, title="M3")  # cerere aprobată, qty 3 + respinsă
    a = await _user(db_session, "mig_a@example.com")
    b = await _user(db_session, "mig_b@example.com")
    oa = (await T.create_order(db_session, a, e1.id)).order.id
    rid = await _request(db_session, b, e3, qty=3)
    rid_rej = await _request(db_session, a, e3, qty=2)
    await _set_status(db_session, oa, STATUS_APPROVED)  # ca înainte de val: fără contor
    await _set_status(db_session, rid, STATUS_APPROVED)
    await _set_status(db_session, rid_rej, STATUS_REJECTED)
    await db_session.execute(text("UPDATE events SET tickets_sold = 0 WHERE id IN (:a, :c)"), {"a": e1.id, "c": e3.id})
    await db_session.commit()

    sql = _load_migration().RECOMPUTE_TICKETS_SOLD_SQL
    for _ in range(2):  # idempotentă
        await db_session.execute(text(sql))
        await db_session.commit()
        rows = dict(
            (await db_session.execute(
                select(Event.id, Event.tickets_sold).execution_options(populate_existing=True)
            )).all()
        )
        assert rows[e1.id] == 1
        assert rows[e2.id] == 0
        assert rows[e3.id] == 3
    assert admin  # adminul există doar ca fixture de context


# --------------------------------------------------------------------------- #
# 6. Singleton-ul de fidelitate: creare leneșă sigură la concurență, fără commit
# --------------------------------------------------------------------------- #
async def test_concurrent_lazy_loyalty_settings_creation_does_not_500(db_session):
    async def read():
        async with AsyncSessionLocal() as s:
            out = await loyalty.get_tiers(s)
            await s.commit()
            return out

    outs = await asyncio.gather(*(read() for _ in range(4)))
    assert len({o.max_total_discount_percent for o in outs}) == 1
    count = await db_session.scalar(select(text("count(*)")).select_from(LoyaltySettings))
    assert count == 1


async def test_lazy_loyalty_settings_does_not_commit_callers_transaction(db_session):
    async with AsyncSessionLocal() as s:
        row_id = (await loyalty._get_or_create_settings(s)).id
        await s.rollback()  # niciun commit intermediar → nimic persistat
    async with AsyncSessionLocal() as s:
        assert await s.get(LoyaltySettings, row_id) is None
