"""Serverul spune clientului ce funcții merg CU ADEVĂRAT.

De ce există ruta asta. Trei integrări au voie să rămână în mod de dezvoltare în
producție, pentru că funcțiile lor nu se mai folosesc în Telegram Mini App. Dar
relaxarea e sigură DOAR dacă aplicația află că funcția nu e disponibilă și o
ascunde, în loc să o arate și să servească un rezultat fals.

Cazul extrem e verificarea facială: în mod de dezvoltare acordă insigna „profil
verificat" oricui, fără să compare nimic.
"""
import pytest

from app.core.config import settings

from tests.test_upload_security import API, _make_user

pytestmark = pytest.mark.asyncio


async def test_capabilities_spune_adevarul(client, monkeypatch):
    """Ce raportează ruta trebuie să urmeze providerul efectiv configurat."""
    monkeypatch.setattr(settings, "face_verify_provider", "stub")
    r = await client.get(f"{API}/capabilities")
    assert r.status_code == 200, r.text
    assert r.json()["face_verification"] is False

    monkeypatch.setattr(settings, "face_verify_provider", "rekognition")
    r = await client.get(f"{API}/capabilities")
    assert r.json()["face_verification"] is True


async def test_capabilities_nu_scurge_detalii_de_infrastructura(client):
    """Doar da sau nu, pe funcții de produs. Niciun nume de furnizor, nicio cheie."""
    r = await client.get(f"{API}/capabilities")
    corp = r.json()

    assert all(isinstance(v, bool) for v in corp.values()), corp
    text = str(corp).lower()
    for scurgere in ("rekognition", "openrouter", "twilio", "stub", "aws", "s3", "key"):
        assert scurgere not in text, f"'{scurgere}' nu are ce cauta in raspuns: {corp}"


async def test_verificarea_faciala_refuza_in_productie_cu_provider_de_dezvoltare(
    client, monkeypatch
):
    """Refuz explicit, NU insignă falsă.

    Scenariul de eșec pe care îl apără: producția rulează cu providerul în mod de
    dezvoltare, ruta raspunde 200 cu `verified: true`, iar oricine apasă primește
    o insignă de încredere fără ca nimic să fi fost verificat.
    """
    headers = await _make_user(client, "cap-verify@example.com")

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "face_verify_provider", "stub")

    r = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert r.status_code == 503, (
        f"in productie cu provider de dezvoltare trebuie REFUZ, nu insigna: {r.text}"
    )


async def test_verificarea_faciala_merge_in_dezvoltare(client, monkeypatch):
    """În dezvoltare fluxul rămâne testabil — refuzul e strict o regulă de producție."""
    headers = await _make_user(client, "cap-verify-dev@example.com")

    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "face_verify_provider", "stub")

    r = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert r.status_code == 200, r.text
