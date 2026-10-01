"""Dovada plății pe comenzile DIRECTE + detaliul/schimbarea de stare de admin.

Acoperă:
  * upload chitanță (PNG / PDF) pe o comandă `awaiting_payment` → `payment_declared`,
    cu `payment_method` și `payment_declared_at`; tip greșit → 422; străin → 404;
    comandă aprobată → 409
  * `declare` (aplicația nativă) funcționează în continuare
  * admin: detaliu cu `payment_proof_uploaded/kind` + `allowed_statuses`, filtru pe stare
  * tranziții manuale: valide (cu audit), aceeași stare / nepermise → 409,
    `approved` emite biletul, `rejected` pune nota pentru user
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.models.admin import AdminAuditLog
from app.models.event import Event
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

pytestmark = pytest.mark.asyncio

# PNG valid minim (1x1) + un PDF minim.
PNG_BYTES = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)
PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


async def _register(client, email: str) -> dict:
    resp = await client.post(f"{API}/auth/register", json={"email": email, "password": PASSWORD})
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str) -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


async def _event(db) -> Event:
    event = Event(
        title="Party Chitanță",
        starts_at=datetime.now(timezone.utc) + timedelta(days=5),
        city="Chișinău", kind="party", ticket_price=120.0, ticket_currency="lei",
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _order(client, db, email: str) -> tuple[dict, str]:
    buyer = await _register(client, email)
    event = await _event(db)
    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    assert resp.status_code == 201, resp.text
    return buyer, resp.json()["order"]["id"]


def _file(name: str, content: bytes, ctype: str) -> dict:
    return {"file": (name, io.BytesIO(content), ctype)}


async def test_upload_png_proof_moves_order_to_declared(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof1@example.com")
    resp = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("chitanta.png", PNG_BYTES, "image/png"),
        data={"method": "mia"},
        headers=buyer,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "payment_declared"
    assert body["payment_proof_uploaded"] is True
    assert body["payment_method"] == "mia"
    assert body["payment_declared_at"] is not None

    # O dovadă nouă (PDF) o înlocuiește pe cea veche, cât timp e în verificare.
    again = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("chitanta.pdf", PDF_BYTES, "application/pdf"),
        headers=buyer,
    )
    assert again.status_code == 200, again.text

    admin = await _make_admin(client, db_session, "proofadmin1@example.com")
    detail = await client.get(f"{ADMIN}/ticket-orders/{order_id}", headers=admin)
    assert detail.status_code == 200, detail.text
    d = detail.json()
    assert d["payment_proof_uploaded"] is True
    assert d["payment_proof_kind"] == "pdf"
    assert d["payment_method"] == "mia"
    assert d["is_request"] is False
    assert "approved" in d["allowed_statuses"]


async def test_upload_rejects_bad_type_foreign_and_decided(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof2@example.com")
    bad = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("x.txt", b"hello", "text/plain"), headers=buyer,
    )
    assert bad.status_code == 422, bad.text
    fake_pdf = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("x.pdf", b"not a pdf", "application/pdf"), headers=buyer,
    )
    assert fake_pdf.status_code == 422, fake_pdf.text

    stranger = await _register(client, "proof2b@example.com")
    foreign = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("c.png", PNG_BYTES, "image/png"), headers=stranger,
    )
    assert foreign.status_code == 404, foreign.text

    admin = await _make_admin(client, db_session, "proofadmin2@example.com")
    ok = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert ok.status_code == 200, ok.text
    late = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("c.png", PNG_BYTES, "image/png"), headers=buyer,
    )
    assert late.status_code == 409, late.text


async def test_declare_still_works_for_native_app(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof3@example.com")
    resp = await client.post(f"{API}/ticket-orders/{order_id}/declare", json={}, headers=buyer)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "payment_declared"
    assert resp.json()["payment_proof_uploaded"] is False


async def _audit_count(db, action: str) -> int:
    return await db.scalar(select(func.count()).select_from(AdminAuditLog).where(AdminAuditLog.action == action))


async def test_admin_status_transitions(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof4@example.com")
    admin = await _make_admin(client, db_session, "proofadmin4@example.com")
    url = f"{ADMIN}/ticket-orders/{order_id}/status"

    same = await client.post(url, json={"status": "awaiting_payment"}, headers=admin)
    assert same.status_code == 409, same.text

    info = await client.post(
        url, json={"status": "additional_information_required", "note": "Chitanța nu se citește."},
        headers=admin,
    )
    assert info.status_code == 200, info.text
    assert info.json()["status"] == "additional_information_required"
    assert info.json()["admin_note"] == "Chitanța nu se citește."
    assert await _audit_count(db_session, "ticket_order.status") == 1

    # Userul poate reîncărca dovada din „necesită informații".
    up = await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("c.png", PNG_BYTES, "image/png"), headers=buyer,
    )
    assert up.status_code == 200 and up.json()["status"] == "payment_declared", up.text

    rejected = await client.post(url, json={"status": "rejected", "note": "Suma greșită."}, headers=admin)
    assert rejected.status_code == 200, rejected.text
    assert await _audit_count(db_session, "ticket_order.reject") == 1
    # Din `rejected` nu se poate aproba direct (trebuie redeschisă întâi).
    bad = await client.post(url, json={"status": "approved"}, headers=admin)
    assert bad.status_code == 409, bad.text
    assert "Tranziție nepermisă" in bad.json()["detail"]

    reopened = await client.post(url, json={"status": "payment_declared"}, headers=admin)
    assert reopened.status_code == 200, reopened.text
    approved = await client.post(url, json={"status": "approved"}, headers=admin)
    assert approved.status_code == 200, approved.text
    assert approved.json()["ticket_code"]
    assert approved.json()["allowed_statuses"] == ["cancelled"]
    assert await _audit_count(db_session, "ticket_order.approve") == 1

    mine = await client.get(f"{API}/ticket-orders/{order_id}", headers=buyer)
    assert mine.json()["order"]["ticket_code"]

    cancelled = await client.post(url, json={"status": "cancelled"}, headers=admin)
    assert cancelled.status_code == 200, cancelled.text
    final = await client.post(url, json={"status": "approved"}, headers=admin)
    assert final.status_code == 409, final.text

    unknown = await client.post(url, json={"status": "bogus"}, headers=admin)
    assert unknown.status_code == 422, unknown.text


async def test_admin_list_status_filter(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof5@example.com")
    _, other_id = await _order(client, db_session, "proof5b@example.com")
    await client.post(
        f"{API}/ticket-orders/{order_id}/payment-proof",
        files=_file("c.png", PNG_BYTES, "image/png"), headers=buyer,
    )
    admin = await _make_admin(client, db_session, "proofadmin5@example.com")
    to_verify = await client.get(f"{ADMIN}/ticket-orders?status=payment_declared", headers=admin)
    assert to_verify.status_code == 200, to_verify.text
    ids = [o["id"] for o in to_verify.json()]
    assert order_id in ids and other_id not in ids
    # Fără filtru: cea de verificat e prima.
    everything = await client.get(f"{ADMIN}/ticket-orders", headers=admin)
    assert everything.json()[0]["id"] == order_id
    bad = await client.get(f"{ADMIN}/ticket-orders?status=nope", headers=admin)
    assert bad.status_code == 422


async def test_admin_proof_and_status_routes_require_admin(client, db_session):
    buyer, order_id = await _order(client, db_session, "proof6@example.com")
    for method, path, kwargs in (
        ("get", f"{ADMIN}/ticket-orders/{order_id}", {}),
        ("get", f"{ADMIN}/ticket-orders/{order_id}/payment-proof", {}),
        ("post", f"{ADMIN}/ticket-orders/{order_id}/status", {"json": {"status": "approved"}}),
    ):
        resp = await getattr(client, method)(path, headers=buyer, **kwargs)
        assert resp.status_code == 403, f"{path}: {resp.status_code}"
    admin = await _make_admin(client, db_session, "proofadmin6@example.com")
    # Fără dovadă → 404.
    missing = await client.get(f"{ADMIN}/ticket-orders/{order_id}/payment-proof", headers=admin)
    assert missing.status_code == 404
