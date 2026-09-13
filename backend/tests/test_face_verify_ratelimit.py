"""Verificarea facială are prag de cereri.

De ce contează: în modul real, fiecare apel cheamă un serviciu extern CU PLATĂ.
Fără prag, un singur cont poate genera cost nelimitat. Regula trebuie să existe
ÎNAINTE de a porni providerul real, nu după prima factură.

Pragul e pe oră, nu pe minut: un utilizator reîncearcă firesc de câteva ori când
selfie-ul iese prost, dar nu de zeci de ori pe zi.
"""
import pytest

from app.core import ratelimit
from app.core.config import settings

from tests.test_upload_security import API, _make_user


@pytest.mark.asyncio
async def test_verify_face_are_prag_de_cereri(client, monkeypatch):
    """A treia cerere, cu pragul pus pe 2, primește 429."""
    headers = await _make_user(client, "face-rl@example.com")

    monkeypatch.setattr(settings, "rate_limit_face_verify_per_hour", 2)
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(ratelimit, "_under_pytest", lambda: False)

    coduri = [
        (await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)).status_code
        for _ in range(3)
    ]

    assert coduri[-1] == 429, f"fara prag, serviciul extern se cheama nelimitat: {coduri}"
    assert 429 not in coduri[:2], f"pragul nu are voie sa loveasca sub limita: {coduri}"
