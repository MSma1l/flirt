"""Teste pentru plata prin MIA Plăți Instant (număr de telefon) în setările de plată.

Acoperă:
  * normalizarea numărului moldovenesc la `+373XXXXXXXX` (unit)
  * PUT /admin/payment-settings: doar MIA (fără IBAN) e valid; nicio metodă → 422;
    telefon invalid → 422; IBAN fără beneficiar → 422
  * `payment_methods` ordonat (mia înaintea lui iban) în setări, comandă, cerere
  * GET /ticket-requests/{id} întoarce datele de plată cât timp așteaptă plata
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.models.event import Event
from app.models.user import ROLE_ADMIN, User
from app.schemas.ticket_order import PaymentSettingsIn, normalize_md_phone

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"


# --------------------------------------------------------------------------- #
# Unit: normalizare + validare
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "raw",
    ["069123456", "69123456", "+373 69 123 456", "+37369123456", "37369123456",
     "0037369123456", "069-123-456", "(069) 123 456"],
)
def test_normalize_md_phone_accepts(raw):
    assert normalize_md_phone(raw) == "+37369123456"


@pytest.mark.parametrize(
    "raw", ["", "12345", "+3736912345", "+373691234567", "+40712345678", "06912345a", "0691234567"]
)
def test_normalize_md_phone_rejects(raw):
    with pytest.raises(ValueError):
        normalize_md_phone(raw)


def test_settings_in_mia_only_is_valid():
    data = PaymentSettingsIn(mia_phone="069 123 456", mia_recipient_name="Ion P.")
    assert data.mia_phone == "+37369123456"
    assert data.bank_iban == "" and data.bank_beneficiary == ""


def test_settings_in_blank_strings_mean_unset():
    data = PaymentSettingsIn(
        bank_beneficiary="SRL Flirt", bank_iban="MD24AG000000000000000000",
        mia_phone="  ", mia_recipient_name="",
    )
    assert data.mia_phone is None and data.mia_recipient_name is None


@pytest.mark.parametrize(
    "payload",
    [
        {"bank_iban": "MD24AG000000000000000000"},  # IBAN fără beneficiar
        {"mia_phone": "12345"},  # telefon invalid
        {"mia_phone": "069123456", "bank_iban": "MD24AG000000000000000000"},  # IBAN fără beneficiar
    ],
)
def test_settings_in_rejects(payload):
    with pytest.raises(ValidationError):
        PaymentSettingsIn(**payload)


def test_settings_in_has_iban_flag():
    # „Cel puțin o metodă" se verifică în serviciu (vede și QR-ul salvat).
    assert PaymentSettingsIn().has_iban is False
    assert PaymentSettingsIn(bank_beneficiary="SRL", bank_iban="MD24AG0000").has_iban is True


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
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


async def _create_event(db, price: float = 100.0) -> Event:
    event = Event(
        title="Petrecere MIA",
        starts_at=datetime.now(timezone.utc) + timedelta(days=7),
        city="Chișinău", kind="party", ticket_price=price, ticket_currency="lei",
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


@pytest.mark.asyncio
async def test_put_settings_mia_only_and_order_payload(client, db_session):
    admin = await _make_admin(client, db_session, "mia_admin1@example.com")
    put = await client.put(
        f"{ADMIN}/payment-settings",
        json={"mia_phone": "+373 69 123 456", "mia_recipient_name": "Ion Popescu",
              "instructions": "Plătiți în 24h."},
        headers=admin,
    )
    assert put.status_code == 200, put.text
    body = put.json()
    assert body["mia_phone"] == "+37369123456"
    assert body["mia_recipient_name"] == "Ion Popescu"
    assert body["mia_enabled"] is True
    assert body["payment_methods"] == ["mia"]
    assert body["bank_iban"] == ""

    got = await client.get(f"{ADMIN}/payment-settings", headers=admin)
    assert got.json()["mia_phone"] == "+37369123456"

    buyer = await _register(client, "mia_buyer1@example.com")
    event = await _create_event(db_session)
    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    assert order.status_code in (200, 201), order.text
    payment = order.json()["payment"]
    assert payment["mia_phone"] == "+37369123456"
    assert payment["mia_recipient_name"] == "Ion Popescu"
    assert payment["payment_methods"] == ["mia"]
    assert payment["iban"] == ""  # clienții vechi primesc tot un string

    detail = await client.get(f"{API}/ticket-orders/{order.json()['order']['id']}", headers=buyer)
    assert detail.json()["payment"]["payment_methods"] == ["mia"]


@pytest.mark.asyncio
async def test_put_settings_without_any_method_422(client, db_session):
    admin = await _make_admin(client, db_session, "mia_admin2@example.com")
    for payload in (
        {},
        {"bank_beneficiary": "", "bank_iban": ""},
        {"mia_phone": "", "bank_beneficiary": "SRL Flirt", "bank_iban": ""},
        {"mia_phone": "123"},
    ):
        resp = await client.put(f"{ADMIN}/payment-settings", json=payload, headers=admin)
        assert resp.status_code == 422, (payload, resp.text)


@pytest.mark.asyncio
async def test_ticket_request_payment_both_methods_and_get(client, db_session):
    admin = await _make_admin(client, db_session, "mia_admin3@example.com")
    put = await client.put(
        f"{ADMIN}/payment-settings",
        json={"bank_beneficiary": "SRL Flirt", "bank_iban": "MD24AG000000000000000000",
              "bank_name": "MAIB", "mia_phone": "069123456"},
        headers=admin,
    )
    assert put.status_code == 200, put.text
    assert put.json()["payment_methods"] == ["mia", "iban"]
    assert put.json()["mia_recipient_name"] is None

    buyer = await _register(client, "mia_buyer3@example.com")
    event = await _create_event(db_session, price=150.0)
    created = await client.post(
        f"{API}/events/{event.id}/ticket-requests",
        json={"full_name": "Ana Popescu", "phone": "+37360000000", "ticket_quantity": 2},
        headers=buyer,
    )
    assert created.status_code == 201, created.text
    pay = created.json()["payment"]
    assert pay["payment_methods"] == ["mia", "iban"]
    assert pay["mia_phone"] == "+37369123456"
    assert pay["amount"] == 300.0
    assert pay["iban"] == "MD24AG000000000000000000"
    request_id = created.json()["request"]["id"]

    # Cererea existentă întoarsă din nou: suma rămâne totalul cererii.
    again = await client.post(
        f"{API}/events/{event.id}/ticket-requests",
        json={"full_name": "Ana Popescu", "phone": "+37360000000", "ticket_quantity": 2},
        headers=buyer,
    )
    assert again.json()["payment"]["amount"] == 300.0

    # GET pe o cerere care așteaptă plata → datele de plată sunt incluse.
    got = await client.get(f"{API}/ticket-requests/{request_id}", headers=buyer)
    assert got.status_code == 200, got.text
    gp = got.json()["payment"]
    assert gp["payment_methods"] == ["mia", "iban"]
    assert gp["amount"] == 300.0
    assert gp["comment_template"] == got.json()["payment_description"]

    # Lista NU include datele de plată (rămâne ușoară).
    mine = await client.get(f"{API}/ticket-requests/mine", headers=buyer)
    assert mine.json()[0]["payment"] is None


@pytest.mark.asyncio
async def test_order_detail_of_pending_request_has_payment(client, db_session):
    admin = await _make_admin(client, db_session, "mia_admin4@example.com")
    await client.put(f"{ADMIN}/payment-settings", json={"mia_phone": "69123456"}, headers=admin)
    buyer = await _register(client, "mia_buyer4@example.com")
    event = await _create_event(db_session, price=50.0)
    created = await client.post(
        f"{API}/events/{event.id}/ticket-requests",
        json={"full_name": "Ion Rusu", "phone": "+37360000001", "ticket_quantity": 3},
        headers=buyer,
    )
    request_id = created.json()["request"]["id"]
    detail = await client.get(f"{API}/ticket-orders/{request_id}", headers=buyer)
    assert detail.status_code == 200, detail.text
    pay = detail.json()["payment"]
    assert pay["payment_methods"] == ["mia"]
    assert pay["mia_phone"] == "+37369123456"
    assert pay["amount"] == 150.0


# --------------------------------------------------------------------------- #
# Codul QR MIA
# --------------------------------------------------------------------------- #
def _png_bytes(size=(64, 64)) -> bytes:
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, format="PNG")
    return out.getvalue()


def _jpeg_with_exif() -> bytes:
    import io

    from PIL import Image

    img = Image.new("RGB", (40, 40), "black")
    exif = Image.Exif()
    exif[0x010F] = "SecretCamera"  # Make
    out = io.BytesIO()
    img.save(out, format="JPEG", exif=exif.tobytes())
    return out.getvalue()


def test_clean_qr_image_strips_metadata():
    import io

    from PIL import Image

    from app.api.v1.admin.ticket_orders import clean_qr_image

    raw = _jpeg_with_exif()
    assert b"SecretCamera" in raw
    cleaned = clean_qr_image(raw)
    assert b"SecretCamera" not in cleaned
    with Image.open(io.BytesIO(cleaned)) as img:
        assert img.format == "PNG"
        assert not img.info.get("exif")


@pytest.mark.asyncio
async def test_mia_qr_upload_counts_as_mia_and_reaches_users(client, db_session):
    import io

    admin = await _make_admin(client, db_session, "mia_qr_admin@example.com")
    bad = await client.post(
        f"{ADMIN}/payment-settings/mia-qr",
        files={"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")},
        headers=admin,
    )
    assert bad.status_code == 422, bad.text

    up = await client.post(
        f"{ADMIN}/payment-settings/mia-qr",
        files={"file": ("qr.png", io.BytesIO(_png_bytes()), "image/png")},
        headers=admin,
    )
    assert up.status_code == 200, up.text
    body = up.json()
    assert body["mia_qr_url"].endswith(".png")
    assert "/payment-qr/" in body["mia_qr_url"]
    assert body["mia_enabled"] is True
    assert body["payment_methods"] == ["mia"]

    # Doar QR (fără telefon, fără IBAN) e o metodă validă și la PUT.
    put = await client.put(f"{ADMIN}/payment-settings", json={"instructions": "Scanați QR-ul."}, headers=admin)
    assert put.status_code == 200, put.text
    assert put.json()["mia_qr_url"] == body["mia_qr_url"]

    buyer = await _register(client, "mia_qr_buyer@example.com")
    event = await _create_event(db_session)
    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=buyer)
    pay = order.json()["payment"]
    assert pay["mia_qr_url"] == body["mia_qr_url"]
    assert pay["payment_methods"] == ["mia"]
    assert pay["mia_phone"] is None

    # QR-ul e singura metodă → nu se poate scoate.
    blocked = await client.delete(f"{ADMIN}/payment-settings/mia-qr", headers=admin)
    assert blocked.status_code == 409, blocked.text

    await client.put(f"{ADMIN}/payment-settings", json={"mia_phone": "069123456"}, headers=admin)
    removed = await client.delete(f"{ADMIN}/payment-settings/mia-qr", headers=admin)
    assert removed.status_code == 200, removed.text
    assert removed.json()["mia_qr_url"] is None
    assert removed.json()["payment_methods"] == ["mia"]  # rămâne telefonul


@pytest.mark.asyncio
async def test_mia_qr_too_large_and_admin_only(client, db_session):
    import io

    user = await _register(client, "mia_qr_user@example.com")
    forbidden = await client.post(
        f"{ADMIN}/payment-settings/mia-qr",
        files={"file": ("qr.png", io.BytesIO(_png_bytes()), "image/png")},
        headers=user,
    )
    assert forbidden.status_code == 403
    admin = await _make_admin(client, db_session, "mia_qr_admin2@example.com")
    big = b"\x89PNG\r\n\x1a\n" + b"0" * (5 * 1024 * 1024)
    too_large = await client.post(
        f"{ADMIN}/payment-settings/mia-qr",
        files={"file": ("qr.png", io.BytesIO(big), "image/png")},
        headers=admin,
    )
    assert too_large.status_code == 413, too_large.text
