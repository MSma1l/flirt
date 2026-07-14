"""Teste RED care DEMONSTREAZĂ bug-uri confirmate în zona
profil/anketă/upload/moderare/subscriptions (vânătoare de bug-uri).

Fiecare test aici este ROȘU pe codul actual: afirmă comportamentul CORECT
(cel așteptat), pe care implementarea de azi NU îl are. NU reparăm nimic —
doar demonstrăm.
"""
from datetime import date

import pytest

from app.core.config import settings
from app.services import billing

API = "/api/v1"
_ADULT_YEAR = date.today().year - 25
_PASSWORD = "Str0ng-Passw0rd!"


def _extract_token(payload: dict) -> str | None:
    if isinstance(payload, dict):
        for key in ("access_token", "accessToken", "token"):
            if isinstance(payload.get(key), str):
                return payload[key]
    return None


async def _register(client, email: str, password: str = _PASSWORD) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": password}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {_extract_token(resp.json())}"}


async def _me_id(client, headers: dict) -> str:
    resp = await client.get(f"{API}/auth/me", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def _anketa(name: str, photos: list[str] | None = None) -> dict:
    return {
        "name": name,
        "birth_date": date(_ADULT_YEAR, 1, 1).isoformat(),
        "gender": "male",
        "height_cm": 180,
        "city": "Chișinău",
        "nationality": "Moldovean",
        "languages": ["ru", "ro"],
        "about": f"Salut, sunt {name}.",
        "dating_statuses": ["serious"],
        "interests": ["sport", "travel"],
        "photos": photos or [],
    }


async def _make_user(client, email: str, name: str) -> tuple[dict, str]:
    headers = await _register(client, email)
    resp = await client.put(f"{API}/profiles/me", json=_anketa(name), headers=headers)
    assert resp.status_code == 200, resp.text
    return headers, await _me_id(client, headers)


# ---------------------------------------------------------------------------
# BUG 1 (HIGH) — /subscriptions/purchase ignoră complet receipt-ul.
# PurchaseIn are DOAR {plan}, iar ruta cheamă billing.purchase(db, user, data.plan)
# fără receipt. Cu BILLING_PROVIDER=app_store, orice achiziție dă 402, chiar dacă
# clientul TRIMITE un receipt valid — el nu ajunge niciodată la validare.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_app_store_purchase_with_valid_receipt_succeeds(client, monkeypatch):
    """Un receipt App Store valid trimis de client trebuie să activeze planul.

    RED azi: receipt-ul nu e nici în schemă, nici pasat de rută → 402.
    """
    monkeypatch.setattr(settings, "billing_provider", "app_store")

    # Validator fals: acceptă DOAR dacă receipt-ul e prezent (fără rețea reală).
    async def fake_verify(receipt):
        if not receipt:
            raise billing._payment_required("Lipsește receipt-ul App Store.")

    monkeypatch.setattr(billing, "_verify_app_store", fake_verify)

    headers = await _register(client, "buyer@example.com")
    resp = await client.post(
        f"{API}/subscriptions/purchase",
        json={"plan": "premium", "receipt": "valid-apple-receipt"},
        headers=headers,
    )
    # Așteptat: 200 (receipt valid → activare). Realitate: 402 (receipt pierdut).
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "active"


# ---------------------------------------------------------------------------
# BUG 2 (MEDIU-RIDICAT) — „auto-ban"-ul de la moderare NU banează contul.
# _auto_ban setează doar UserSettings.profile_hidden=True; nu atinge User.banned_at.
# Docstring-urile din model spun explicit că banned_at înseamnă „login refuzat +
# token invalidat". Cum nu e setat, contul mass-raportat se poate loga în
# continuare și își poate folosi token-ul existent (chat etc.).
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_autoban_actually_bans_the_account(client):
    """La atingerea pragului, contul raportat trebuie să fie efectiv banat.

    RED azi: banned_at rămâne NULL → login 200 și /me 200.
    """
    threshold = settings.report_autoban_threshold
    target_headers, target_id = await _make_user(
        client, "target@example.com", "Target"
    )

    for i in range(threshold):
        rep_headers = await _register(client, f"reporter{i}@example.com")
        resp = await client.post(
            f"{API}/reports/",
            json={"reported_user_id": target_id, "category": "offensive"},
            headers=rep_headers,
        )
        assert resp.status_code == 201, resp.text
    # Pragul e atins: rapoartele sunt marcate auto_banned.
    assert resp.json()["status"] == "auto_banned"

    # 1) Token-ul existent al contului banat NU ar mai trebui să meargă.
    me = await client.get(f"{API}/auth/me", headers=target_headers)
    assert me.status_code == 403, (
        f"Contul auto-banat încă poate folosi token-ul (status {me.status_code})."
    )

    # 2) Nici login-ul cu parola nu ar mai trebui să reușească.
    login = await client.post(
        f"{API}/auth/login",
        json={"email": "target@example.com", "password": _PASSWORD},
    )
    assert login.status_code == 403, (
        f"Contul auto-banat încă se poate loga (status {login.status_code})."
    )


# ---------------------------------------------------------------------------
# BUG 3 (MEDIU) — anketa acceptă URL-uri de poze din NAMESPACE-ul altui profil.
# PUT /profiles/me validează doar https + host permis, NU și prefixul
# photos/{profile_id_propriu}/. Astfel un user își poate seta ca poze de profil
# obiecte din bucket care aparțin altui profil (photos/{alt_id}/...), spre
# deosebire de POST/DELETE /photos care impun prefixul propriu (inconsistență).
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_anketa_rejects_foreign_photo_namespace(client):
    """Anketa nu ar trebui să accepte poze din prefixul altui profil.

    RED azi: acceptă orice cheie photos/... de pe host-ul propriu (200).
    """
    victim_profile_ns = "00000000-0000-0000-0000-000000000000"
    foreign_url = f"{settings.storage_base_url}/photos/{victim_profile_ns}/secret.jpg"

    headers = await _register(client, "attacker@example.com")
    resp = await client.put(
        f"{API}/profiles/me",
        json=_anketa("Attacker", photos=[foreign_url]),
        headers=headers,
    )
    # Așteptat: 422 (poză în afara namespace-ului propriu). Realitate: 200.
    assert resp.status_code == 422, (
        f"Anketa a acceptat o poză din namespace străin (status {resp.status_code})."
    )
