"""Metodele de login declarate indisponibile sunt ÎNCHISE în producție.

În modul `stub`, `/auth/google` și `/auth/apple` acceptau `stub:orice@x`, iar
`/auth/phone/*` codul fix `000000` — intrare fără Telegram și preluarea oricărui
cont `phone_*`. `/capabilities` le declara oprite, dar rutele răspundeau.
"""
import pytest

from app.core.config import settings

from tests.test_upload_security import API

pytestmark = pytest.mark.asyncio


@pytest.fixture
def productie_cu_stub(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "social_auth_mode", "stub")
    monkeypatch.setattr(settings, "otp_mode", "stub")


@pytest.mark.parametrize("provider", ["google", "apple"])
async def test_login_social_stub_refuzat_in_productie(client, productie_cu_stub, provider):
    r = await client.post(f"{API}/auth/{provider}", json={"id_token": "stub:atacator@x.md"})
    assert r.status_code == 503, r.text
    assert "access_token" not in r.text


async def test_otp_stub_refuzat_in_productie(client, productie_cu_stub):
    r = await client.post(f"{API}/auth/phone/request", json={"phone": "+37360000000"})
    assert r.status_code == 503, r.text
    r = await client.post(
        f"{API}/auth/phone/verify", json={"phone": "+37360000000", "code": "000000"}
    )
    assert r.status_code == 503, r.text
    assert "access_token" not in r.text


async def test_in_dezvoltare_stub_ramane_utilizabil(client, monkeypatch):
    """Garda e doar pentru producție — testele și dev-ul local folosesc stub-ul."""
    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "social_auth_mode", "stub")
    r = await client.post(f"{API}/auth/google", json={"id_token": "stub:dev@x.md"})
    assert r.status_code == 200, r.text


async def test_cumparare_stub_refuzata_in_productie(client, monkeypatch):
    """Billing `stub` în producție = premium gratuit la cerere. Închis."""
    from tests.test_upload_security import _make_user

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "billing_provider", "stub")
    headers = await _make_user(client, "cumparator@x.md")
    r = await client.post(
        f"{API}/subscriptions/purchase", json={"plan": "all_inclusive"}, headers=headers
    )
    assert r.status_code == 503, r.text
