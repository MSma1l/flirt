"""Regresii pentru cererile manuale: date, autorizare, capacitate și audit."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.security import hash_password
from app.models.admin import AdminAuditLog
from app.models.event import Event
from app.models.ticket_order import STATUS_APPROVED, STATUS_PENDING_PAYMENT, TicketOrder
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import TicketRequestCreateIn
from app.services import ticket_order_service as tickets

pytestmark = pytest.mark.asyncio


async def _user(db, email, admin=False):
    user = User(email=email, password_hash=hash_password("Str0ng-Passw0rd!"), role=ROLE_ADMIN if admin else "user")
    db.add(user); await db.commit(); await db.refresh(user)
    return user


async def _event(db, capacity=3):
    event = Event(title="Flirt Party", starts_at=datetime.now(timezone.utc) + timedelta(days=2), city="Chișinău", kind="party", ticket_price=100, ticket_currency="lei", ticket_capacity=capacity)
    db.add(event); await db.commit(); await db.refresh(event)
    return event


async def test_request_snapshots_contact_total_and_payment_description(db_session):
    user, event = await _user(db_session, "req@example.com"), await _event(db_session)
    out = await tickets.create_request(db_session, user, event.id, TicketRequestCreateIn(full_name="Ana Popescu", phone="+37360000000", ticket_quantity=2, client_message="Rezervare"))
    assert out.request.status == STATUS_PENDING_PAYMENT
    assert out.request.total_amount == 200
    assert out.request.email == user.email
    assert "Ana Popescu" in out.request.payment_description
    assert out.payment.amount == 200


async def test_proof_owner_isolation_and_approval_updates_capacity_audit(db_session):
    owner, other, admin, event = await _user(db_session, "owner_req@example.com"), await _user(db_session, "other_req@example.com"), await _user(db_session, "admin_req@example.com", True), await _event(db_session, 2)
    request = await tickets.create_request(db_session, owner, event.id, TicketRequestCreateIn(full_name="Owner", phone="1", ticket_quantity=2))
    with pytest.raises(HTTPException) as exc:
        await tickets.submit_payment_proof(db_session, other, request.request.id, "https://example.test/proof.png")
    assert exc.value.status_code == 404
    await tickets.submit_payment_proof(db_session, owner, request.request.id, "https://storage.example/ticket-proofs/a.png")
    approved = await tickets.review_request(db_session, admin, request.request.id, STATUS_APPROVED, "Confirmată")
    assert approved.status == STATUS_APPROVED
    await db_session.refresh(event)
    assert event.tickets_sold == 2
    audit = (await db_session.execute(select(AdminAuditLog).where(AdminAuditLog.target_id == request.request.id))).scalars().one()
    assert audit.meta["previous_status"] == "payment_proof_submitted"
    assert audit.meta["new_status"] == STATUS_APPROVED


async def test_approval_refuses_oversold_capacity(db_session):
    owner, admin, event = await _user(db_session, "capacity@example.com"), await _user(db_session, "capacity_admin@example.com", True), await _event(db_session, 1)
    # Simulate another already-confirmed sale after the request was created.
    request = await tickets.create_request(db_session, owner, event.id, TicketRequestCreateIn(full_name="Owner", phone="1", ticket_quantity=1))
    await tickets.submit_payment_proof(db_session, owner, request.request.id, "https://storage.example/ticket-proofs/a.png")
    event.tickets_sold = 1; await db_session.commit()
    with pytest.raises(HTTPException) as exc:
        await tickets.review_request(db_session, admin, request.request.id, STATUS_APPROVED, None)
    assert exc.value.status_code == 409
