"""Tipuri de bilet (până la 4 prețuri per eveniment).

Acoperă: salvarea din admin (validare, ordine, preț minim, diff pe id, ștergere
blocată de comenzi active, plafon sub vândute), expunerea publică (`sold_out`),
comanda directă și cererea manuală cu tip (preț din tip, reduceri peste el,
alegere obligatorie la mai multe tipuri, schimbarea tipului înainte de plată),
capacitatea per tip la aprobare / eliberarea ei la anulare și compatibilitatea
cu evenimentele cu preț unic.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.models.event import Event, EventTicketTier
from app.models.ticket_order import TicketOrder
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

pytestmark = pytest.mark.asyncio


async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str = "tiers_admin@example.com") -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


def _payload(**extra) -> dict:
    return {
        "title": "Tier Party",
        "starts_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
        "city": "Chișinău",
        "kind": "party",
        "ticket_currency": "lei",
        **extra,
    }


TIERS = [
    {"name": "Early bird", "price": 100, "capacity": 1, "description": "Primele bilete"},
    {"name": "Standard", "price": 150},
    {"name": "VIP", "price": 300, "capacity": 10},
]


async def _create_tiered_event(client, admin: dict, tiers=None) -> dict:
    resp = await client.post(
        f"{ADMIN}/events", json=_payload(ticket_tiers=tiers or TIERS), headers=admin
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _tier_id(body: dict, name: str) -> str:
    return next(t["id"] for t in body["ticket_tiers"] if t["name"] == name)


# --------------------------------------------------------------------------- #
# Admin: salvare + validare
# --------------------------------------------------------------------------- #
async def test_admin_creates_tiers_in_order_with_min_price(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)

    assert [t["name"] for t in body["ticket_tiers"]] == ["Early bird", "Standard", "VIP"]
    assert [t["position"] for t in body["ticket_tiers"]] == [0, 1, 2]
    assert body["ticket_tiers"][0]["capacity"] == 1
    assert body["ticket_tiers"][0]["description"] == "Primele bilete"
    assert body["ticket_tiers"][1]["capacity"] is None
    assert all(t["sold"] == 0 for t in body["ticket_tiers"])
    # `ticket_price` = prețul minim („de la"), pentru clienții vechi.
    assert body["ticket_price"] == 100

    user = await _register(client, "viewer@example.com")
    resp = await client.get(f"{API}/events/{body['id']}", headers=user)
    assert resp.status_code == 200, resp.text
    public = resp.json()
    assert [t["name"] for t in public["ticket_tiers"]] == ["Early bird", "Standard", "VIP"]
    assert all(t["sold_out"] is False for t in public["ticket_tiers"])
    assert "sold" not in public["ticket_tiers"][0]
    assert public["ticket_sales_open"] is True


@pytest.mark.parametrize(
    "tiers",
    [
        [{"name": f"T{i}", "price": 10} for i in range(5)],  # peste 4
        [{"name": "VIP", "price": 10}, {"name": "vip", "price": 20}],  # nume duplicat
        [{"name": "VIP", "price": -1}],  # preț negativ
        [{"name": "   ", "price": 10}],  # nume gol
        [{"name": "X" * 61, "price": 10}],  # nume prea lung
        [{"name": "VIP", "price": 10, "capacity": 0}],  # capacitate < 1
        [{"name": "<script>", "price": 10}],  # HTML
    ],
)
async def test_admin_tier_validation(client, db_session, tiers):
    admin = await _make_admin(client, db_session)
    resp = await client.post(f"{ADMIN}/events", json=_payload(ticket_tiers=tiers), headers=admin)
    assert resp.status_code == 422, resp.text


async def test_legacy_single_price_payload_becomes_default_tier(client, db_session):
    admin = await _make_admin(client, db_session)
    resp = await client.post(f"{ADMIN}/events", json=_payload(ticket_price=120), headers=admin)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["ticket_price"] == 120
    assert [(t["name"], t["price"]) for t in body["ticket_tiers"]] == [("Standard", 120)]
    tier_id = body["ticket_tiers"][0]["id"]

    # Prețul unic schimbat de un client vechi → același tip, preț nou.
    resp = await client.put(f"{ADMIN}/events/{body['id']}", json={"ticket_price": 90}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert [(t["id"], t["price"]) for t in resp.json()["ticket_tiers"]] == [(tier_id, 90)]
    assert resp.json()["ticket_price"] == 90

    # Prețul scos → fără vânzare online.
    resp = await client.put(f"{ADMIN}/events/{body['id']}", json={"ticket_price": None}, headers=admin)
    assert resp.status_code == 200, resp.text
    assert resp.json()["ticket_tiers"] == [] and resp.json()["ticket_price"] is None


async def test_legacy_price_on_multi_tier_event_is_refused(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    resp = await client.put(f"{ADMIN}/events/{body['id']}", json={"ticket_price": 50}, headers=admin)
    assert resp.status_code == 422, resp.text


async def test_admin_update_diffs_by_id_and_guards(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    eid = body["id"]
    early, standard, vip = (t["id"] for t in body["ticket_tiers"])

    # Reordonare + redenumire + tip nou: id-urile existente se păstrează.
    tiers = [
        {"id": vip, "name": "VIP Lounge", "price": 350, "capacity": 10},
        {"id": standard, "name": "Standard", "price": 150},
        {"id": early, "name": "Early bird", "price": 100, "capacity": 1},
        {"name": "La intrare", "price": 200},
    ]
    resp = await client.put(f"{ADMIN}/events/{eid}", json={"ticket_tiers": tiers}, headers=admin)
    assert resp.status_code == 200, resp.text
    out = resp.json()["ticket_tiers"]
    assert [t["name"] for t in out] == ["VIP Lounge", "Standard", "Early bird", "La intrare"]
    assert [t["id"] for t in out[:3]] == [vip, standard, early]

    # Un tip cu comandă activă nu se poate șterge; plafonul nu coboară sub vândute.
    user = await _register(client, "buyer@example.com")
    resp = await client.post(
        f"{API}/events/{eid}/ticket-orders", json={"ticket_tier_id": vip}, headers=user
    )
    assert resp.status_code == 201, resp.text
    order_id = resp.json()["order"]["id"]
    without_vip = [t for t in tiers[1:3]]
    resp = await client.put(f"{ADMIN}/events/{eid}", json={"ticket_tiers": without_vip}, headers=admin)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "ticket_tier_in_use"

    resp = await client.post(f"{ADMIN}/ticket-orders/{order_id}/approve", headers=admin)
    assert resp.status_code == 200, resp.text
    # Plafon egal cu biletele vândute (1) → permis.
    lowered = [{**tiers[0], "capacity": 1}, *tiers[1:]]
    resp = await client.put(f"{ADMIN}/events/{eid}", json={"ticket_tiers": lowered}, headers=admin)
    assert resp.status_code == 200, resp.text

    tier = await db_session.get(EventTicketTier, vip)
    await db_session.refresh(tier)
    tier.sold = 3
    await db_session.commit()
    lowered = [{**tiers[0], "capacity": 2}, *tiers[1:]]
    resp = await client.put(f"{ADMIN}/events/{eid}", json={"ticket_tiers": lowered}, headers=admin)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "capacity_below_sold"

    # Un id străin → 422.
    bogus = [{"id": "00000000-0000-0000-0000-000000000001", "name": "X", "price": 1}]
    resp = await client.put(f"{ADMIN}/events/{eid}", json={"ticket_tiers": bogus}, headers=admin)
    assert resp.status_code == 422, resp.text


# --------------------------------------------------------------------------- #
# Comandă directă
# --------------------------------------------------------------------------- #
async def test_order_requires_tier_on_multi_tier_event(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    user = await _register(client, "u@example.com")

    resp = await client.post(f"{API}/events/{body['id']}/ticket-orders", headers=user)
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "ticket_tier_required"

    resp = await client.post(
        f"{API}/events/{body['id']}/ticket-orders",
        json={"ticket_tier_id": "00000000-0000-0000-0000-000000000001"},
        headers=user,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "ticket_tier_invalid"

    vip = await _tier_id(body, "VIP")
    resp = await client.post(
        f"{API}/events/{body['id']}/ticket-orders", json={"ticket_tier_id": vip}, headers=user
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()["order"]
    assert order["price"] == 300
    assert order["ticket_tier_id"] == vip and order["ticket_tier_name"] == "VIP"
    assert resp.json()["payment"]["amount"] == 300

    # Adminul vede tipul cumpărat în coadă.
    resp = await client.get(f"{ADMIN}/ticket-orders", headers=admin)
    assert resp.status_code == 200, resp.text
    row = next(o for o in resp.json() if o["id"] == order["id"])
    assert row["ticket_tier_name"] == "VIP"


async def test_promo_discount_applies_on_top_of_tier_price(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    resp = await client.put(
        f"{ADMIN}/events/{body['id']}", json={"promo_discount_percent": 10}, headers=admin
    )
    assert resp.status_code == 200, resp.text
    user = await _register(client, "promo@example.com")
    vip = await _tier_id(body, "VIP")

    resp = await client.get(
        f"{API}/loyalty/events/{body['id']}/ticket-quote",
        params={"ticket_tier_id": vip},
        headers=user,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["base_price"] == 300 and resp.json()["final_price"] == 270
    assert resp.json()["ticket_tier_id"] == vip

    resp = await client.post(
        f"{API}/events/{body['id']}/ticket-orders", json={"ticket_tier_id": vip}, headers=user
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["order"]["price"] == 270


async def test_single_tier_event_needs_no_choice(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin, tiers=[{"name": "General", "price": 80}])
    user = await _register(client, "single@example.com")
    resp = await client.post(f"{API}/events/{body['id']}/ticket-orders", headers=user)
    assert resp.status_code == 201, resp.text
    assert resp.json()["order"]["price"] == 80
    assert resp.json()["order"]["ticket_tier_name"] == "General"


async def test_legacy_event_without_tiers_still_sells(client, db_session):
    event = Event(
        title="Old", starts_at=datetime.now(timezone.utc) + timedelta(days=3),
        city="Chișinău", kind="party", ticket_price=70.0, ticket_currency="lei",
    )
    db_session.add(event)
    await db_session.commit()
    user = await _register(client, "legacy@example.com")
    resp = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=user)
    assert resp.status_code == 201, resp.text
    assert resp.json()["order"]["price"] == 70
    assert resp.json()["order"]["ticket_tier_id"] is None
    # Un tip trimis la un eveniment fără tipuri → 422.
    other = await _register(client, "legacy2@example.com")
    resp = await client.post(
        f"{API}/events/{event.id}/ticket-orders",
        json={"ticket_tier_id": "00000000-0000-0000-0000-000000000001"},
        headers=other,
    )
    assert resp.status_code == 422, resp.text


async def test_switching_tier_before_payment_updates_same_order(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    user = await _register(client, "switch@example.com")
    vip, standard = await _tier_id(body, "VIP"), await _tier_id(body, "Standard")

    first = await client.post(
        f"{API}/events/{body['id']}/ticket-orders", json={"ticket_tier_id": vip}, headers=user
    )
    second = await client.post(
        f"{API}/events/{body['id']}/ticket-orders", json={"ticket_tier_id": standard}, headers=user
    )
    assert second.status_code == 201, second.text
    assert second.json()["order"]["id"] == first.json()["order"]["id"]
    assert second.json()["order"]["price"] == 150
    assert second.json()["order"]["ticket_tier_name"] == "Standard"
    assert second.json()["payment"]["amount"] == 150

    # Fără alegere, comanda existentă se întoarce neschimbată.
    third = await client.post(f"{API}/events/{body['id']}/ticket-orders", headers=user)
    assert third.status_code == 201, third.text
    assert third.json()["order"]["ticket_tier_name"] == "Standard"


async def test_tier_capacity_enforced_and_released(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    eid = body["id"]
    early = await _tier_id(body, "Early bird")

    a = await _register(client, "a@example.com")
    b = await _register(client, "b@example.com")
    order_a = (await client.post(
        f"{API}/events/{eid}/ticket-orders", json={"ticket_tier_id": early}, headers=a
    )).json()["order"]["id"]
    order_b = (await client.post(
        f"{API}/events/{eid}/ticket-orders", json={"ticket_tier_id": early}, headers=b
    )).json()["order"]["id"]

    resp = await client.post(f"{ADMIN}/ticket-orders/{order_a}/approve", headers=admin)
    assert resp.status_code == 200, resp.text
    # Plafonul tipului (1) e atins: a doua aprobare pe același tip → 409.
    resp = await client.post(f"{ADMIN}/ticket-orders/{order_b}/approve", headers=admin)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "tickets_sold_out"

    tier = await db_session.get(EventTicketTier, early)
    await db_session.refresh(tier)
    assert tier.sold == 1
    event = await db_session.get(Event, eid)
    await db_session.refresh(event)
    assert event.tickets_sold == 1

    # Public: tipul e epuizat, restul nu; vânzarea rămâne deschisă.
    c = await _register(client, "c@example.com")
    public = (await client.get(f"{API}/events/{eid}", headers=c)).json()
    sold_out = {t["name"]: t["sold_out"] for t in public["ticket_tiers"]}
    assert sold_out == {"Early bird": True, "Standard": False, "VIP": False}
    assert public["ticket_sales_open"] is True
    resp = await client.post(
        f"{API}/events/{eid}/ticket-orders", json={"ticket_tier_id": early}, headers=c
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "tickets_sold_out"

    # Anularea biletului emis eliberează locul tipului.
    resp = await client.post(
        f"{ADMIN}/ticket-orders/{order_a}/status", json={"status": "cancelled"}, headers=admin
    )
    assert resp.status_code == 200, resp.text
    await db_session.refresh(tier)
    assert tier.sold == 0
    resp = await client.post(f"{ADMIN}/ticket-orders/{order_b}/approve", headers=admin)
    assert resp.status_code == 200, resp.text


async def test_all_tiers_sold_out_closes_sales(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(
        client, admin, tiers=[{"name": "A", "price": 10, "capacity": 1}, {"name": "B", "price": 20, "capacity": 1}]
    )
    for tier in await db_session.scalars(
        select(EventTicketTier).where(EventTicketTier.event_id == body["id"])
    ):
        tier.sold = 1
    await db_session.commit()
    user = await _register(client, "late@example.com")
    public = (await client.get(f"{API}/events/{body['id']}", headers=user)).json()
    assert public["ticket_sales_open"] is False
    assert all(t["sold_out"] for t in public["ticket_tiers"])


# --------------------------------------------------------------------------- #
# Cerere manuală (cantitate × prețul tipului)
# --------------------------------------------------------------------------- #
async def test_ticket_request_uses_tier_price_and_capacity(client, db_session):
    admin = await _make_admin(client, db_session)
    body = await _create_tiered_event(client, admin)
    vip = await _tier_id(body, "VIP")
    user = await _register(client, "req@example.com")

    payload = {"full_name": "Ana Pop", "phone": "+37360000000", "ticket_quantity": 2}
    resp = await client.post(f"{API}/events/{body['id']}/ticket-requests", json=payload, headers=user)
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "ticket_tier_required"

    resp = await client.post(
        f"{API}/events/{body['id']}/ticket-requests",
        json={**payload, "ticket_tier_id": vip},
        headers=user,
    )
    assert resp.status_code == 201, resp.text
    req = resp.json()["request"]
    assert req["ticket_price"] == 300 and req["total_amount"] == 600
    assert req["ticket_tier_name"] == "VIP"
    assert resp.json()["payment"]["amount"] == 600

    order = await db_session.get(TicketOrder, req["id"])
    order.payment_proof_url = "https://example.com/proof.jpg"
    await db_session.commit()
    resp = await client.post(
        f"{ADMIN}/ticket-requests/{req['id']}/review", json={"status": "approved"}, headers=admin
    )
    assert resp.status_code == 200, resp.text
    tier = await db_session.get(EventTicketTier, vip)
    await db_session.refresh(tier)
    assert tier.sold == 2
