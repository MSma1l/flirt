"""Teste RED care DEMONSTREAZĂ bug-uri confirmate în zona
profil/anketă/upload/moderare/subscriptions (vânătoare de bug-uri).

Fiecare test aici este ROȘU pe codul actual: afirmă comportamentul CORECT
(cel așteptat), pe care implementarea de azi NU îl are. NU reparăm nimic —
doar demonstrăm.
"""
from datetime import date, datetime, timedelta, timezone

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


async def _make_credible(db, email: str, target_id) -> None:
    """Raportor CREDIBIL pentru auto-ascundere: cont vechi de ≥ 3 zile, profil
    completat și o interacțiune reală cu ținta (aici: un swipe pe ea)."""
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.models.swipe import Like
    from app.models.user import User

    user = (await db.execute(select(User).where(User.email == email))).scalar_one()
    user.created_at = datetime.now(timezone.utc) - timedelta(days=10)
    user.profile_completed = True
    db.add(Like(from_user_id=user.id, to_user_id=_uuid.UUID(str(target_id)), is_like=False))
    await db.commit()


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

    # Validator fals: acceptă DOAR dacă receipt-ul e prezent (fără crypto/rețea
    # reală). Semnătura oglindește noul `_verify_app_store(receipt, plan)`, care
    # întoarce un `VerifiedPurchase` dovedit — nu mai e vechiul verifyReceipt.
    async def fake_verify(receipt, plan):
        if not receipt:
            raise billing._payment_required("Lipsește receipt-ul App Store.")
        return billing.VerifiedPurchase(
            provider="app_store",
            transaction_id=f"txn-{receipt}",
            original_transaction_id=f"orig-{receipt}",
            product_id=f"eu.flirt.app.{plan}.monthly",
            plan=plan,
            environment="Sandbox",
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )

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
# BUG 2 — inițial: „auto-ban"-ul nu bana contul. Fixul a dus la extrema opusă:
# trei conturi proaspete puteau bana DEFINITIV pe oricine (inclusiv un admin).
# Decizia finală: la prag, profilul e doar ASCUNS în așteptarea review-ului uman;
# banul (login refuzat, sesiuni revocate) rămâne o decizie a moderatorului.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_autohide_hides_but_does_not_ban_the_account(client, db_session):
    """La prag, contul raportat e ascuns din feed, dar NU banat / delogat."""
    threshold = settings.report_autoban_threshold
    target_headers, target_id = await _make_user(
        client, "target@example.com", "Target"
    )

    for i in range(threshold):
        rep_headers = await _register(client, f"reporter{i}@example.com")
        await _make_credible(db_session, f"reporter{i}@example.com", target_id)
        resp = await client.post(
            f"{API}/reports/",
            json={"reported_user_id": target_id, "category": "offensive"},
            headers=rep_headers,
        )
        assert resp.status_code == 201, resp.text
    # Pragul e atins: rapoartele sunt marcate (acțiune automată aplicată).
    assert resp.json()["status"] == "auto_banned"

    # Token-ul existent merge în continuare, iar login-ul reușește.
    me = await client.get(f"{API}/auth/me", headers=target_headers)
    assert me.status_code == 200, me.text
    login = await client.post(
        f"{API}/auth/login",
        json={"email": "target@example.com", "password": _PASSWORD},
    )
    assert login.status_code == 200, login.text

    # Dar profilul e ascuns în așteptarea review-ului.
    from sqlalchemy import select

    from app.models.account import UserSettings
    from app.models.user import User

    target = (
        await db_session.execute(select(User).where(User.email == "target@example.com"))
    ).scalar_one()
    await db_session.refresh(target)
    assert target.banned_at is None
    us = (
        await db_session.execute(
            select(UserSettings).where(UserSettings.user_id == target.id)
        )
    ).scalar_one()
    assert us.profile_hidden is True


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
