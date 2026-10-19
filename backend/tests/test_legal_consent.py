"""Documente legale versionate + consimțăminte + export date (Legea nr. 195/2024).

Acoperă:
  - `GET /api/v1/legal/documents/{doc}`: public, 3 limbi, versiune, placeholdere
    randate din config sau marcate vizibil „[de completat]";
  - `GET /legal/consent-status`, `POST /legal/consent` (IP/UA consemnate, 409 la
    versiune expirată), `POST /legal/consent/withdraw` (doar opționale);
  - `consent_required` în `/auth/me` și re-solicitarea la o versiune nouă;
  - `GET /me/export` (JSON cu datele userului, fără secrete);
  - purjarea contului păstrează consimțămintele, dar șterge IP/UA.
"""
from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.consent import UserConsent
from app.services import legal_service
from app.services.legal_service import LEGAL_DOCUMENTS, LegalDocument
from tests.conftest import grant_consents
from tests.test_upload_security import API, _make_user

pytestmark = pytest.mark.asyncio


async def _register(client, email: str) -> dict:
    r = await client.post(
        f"{API}/auth/register", json={"email": email, "password": "Str0ng-Pass!"}
    )
    assert r.status_code in (200, 201), r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --- Documente -----------------------------------------------------------------
@pytest.mark.parametrize("doc", ["privacy", "terms", "consent"])
@pytest.mark.parametrize("lang", ["ro", "ru", "en"])
async def test_documentul_e_public_in_toate_limbile(client, doc, lang):
    r = await client.get(f"{API}/legal/documents/{doc}", params={"lang": lang})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["document"] == doc
    assert data["lang"] == lang
    assert data["version"] == LEGAL_DOCUMENTS[doc].version
    assert data["effective_date"] == LEGAL_DOCUMENTS[doc].effective_date.isoformat()
    assert data["title"] and data["content"].startswith("# ")
    # Niciun placeholder nerandat nu ajunge la client.
    assert "{{" not in data["content"]


async def test_limbile_difera_si_limba_necunoscuta_cade_pe_romana(client):
    ro = (await client.get(f"{API}/legal/documents/privacy?lang=ro")).json()
    ru = (await client.get(f"{API}/legal/documents/privacy?lang=ru")).json()
    en = (await client.get(f"{API}/legal/documents/privacy?lang=en")).json()
    assert len({ro["title"], ru["title"], en["title"]}) == 3
    xx = (await client.get(f"{API}/legal/documents/privacy?lang=de")).json()
    assert xx["lang"] == "ro" and xx["content"] == ro["content"]


async def test_document_necunoscut_404_sau_422(client):
    r = await client.get(f"{API}/legal/documents/cookies")
    assert r.status_code in (404, 422)


async def test_politica_acopera_legea_195_si_cnpdcp(client):
    content = (await client.get(f"{API}/legal/documents/privacy?lang=ro")).json()["content"]
    lower = content.lower()
    assert "195/2024" in content
    assert "datepersonale.md" in lower
    assert "18" in content
    assert f"{settings.account_deletion_grace_days}" in content


async def test_versiunea_2_a_politicii_si_acordului_cere_reacceptare():
    """Politica și Acordul v2.0 (19.10.2026) — schimbare de fond, deci versiune nouă.

    Termenii rămân 1.0, din 23.08.2026 (data aplicării Legii nr. 195/2024).
    """
    assert LEGAL_DOCUMENTS["privacy"].version == "2.0"
    assert LEGAL_DOCUMENTS["consent"].version == "2.0"
    assert LEGAL_DOCUMENTS["privacy"].effective_date.isoformat() == "2026-10-19"
    assert LEGAL_DOCUMENTS["consent"].effective_date.isoformat() == "2026-10-19"
    assert LEGAL_DOCUMENTS["terms"].effective_date.isoformat() == "2026-08-23"


@pytest.mark.parametrize("lang", ["ro", "ru", "en"])
async def test_politica_v2_contine_elementele_cerute_de_lege(client, lang):
    """Informațiile de la art. 12–14 (Legea 195/2024), în toate limbile."""
    data = (await client.get(f"{API}/legal/documents/privacy?lang={lang}")).json()
    content = data["content"]
    lower = content.lower()
    assert "195/2024" in content
    assert "367-369" in content  # Monitorul Oficial nr. 367-369 din 23.08.2024
    assert "23" in content and "2026" in content
    # CNPDCP: site, e-mail, adresă — plângerea (art. 74).
    assert "datepersonale.md" in lower
    assert "centru@datepersonale.md" in lower
    assert "48" in content and "MD-2004" in content
    # Breșe: 72 de ore (art. 33). Răspuns la cereri: o lună (+2).
    assert "72" in content
    # Termene din config (nu promitem altceva decât face codul).
    for value in (
        str(settings.account_deletion_grace_days),
        str(settings.log_retention_days),
        str(settings.rejected_payment_proof_retention_days),
    ):
        assert value in content
    # Tabele markdown (scop / temei / termen).
    assert "|---|" in content
    # Profilare + furnizorii reali.
    assert "openrouter" in lower
    assert "telegram" in lower
    assert data["version"] == "2.0"


@pytest.mark.parametrize("lang", ["ro", "ru", "en"])
async def test_acordul_v2_are_consimtaminte_separate(client, lang):
    data = (await client.get(f"{API}/legal/documents/consent?lang={lang}")).json()
    content = data["content"]
    assert data["version"] == "2.0"
    assert "195/2024" in content
    assert "{{" not in content
    # Cinci consimțăminte separate: general, date sensibile, AI, notificări, facial.
    headings = [line for line in content.splitlines() if line.startswith("## ")]
    numbered = [h for h in headings if h[3:4].isdigit()]
    assert len(numbered) >= 5
    assert "datepersonale.md" in content


async def test_data_intrarii_in_vigoare_e_randata_pe_limba(client):
    ro = (await client.get(f"{API}/legal/documents/privacy?lang=ro")).json()
    en = (await client.get(f"{API}/legal/documents/privacy?lang=en")).json()
    assert "19.10.2026" in ro["content"]
    assert "19 October 2026" in en["content"]


async def test_placeholderele_lipsa_sunt_marcate_vizibil(client, monkeypatch):
    for field in (
        "legal_operator_name",
        "operator_legal_name",
        "legal_operator_idno",
        "legal_operator_address",
        "legal_dpo_contact",
    ):
        monkeypatch.setattr(settings, field, "")
    data = (await client.get(f"{API}/legal/documents/privacy?lang=ro")).json()
    assert "[de completat]" in data["content"]
    assert "operator_name" in data["missing_placeholders"]
    assert "operator_idno" in data["missing_placeholders"]
    # Email-ul are adresa publică de rezervă → nu lipsește niciodată.
    assert "contact_email" not in data["missing_placeholders"]
    assert legal_service.DEFAULT_CONTACT_EMAIL in data["content"]
    en = (await client.get(f"{API}/legal/documents/privacy?lang=en")).json()
    assert "[to be completed]" in en["content"]


async def test_placeholderele_completate_apar_in_text(client, monkeypatch):
    monkeypatch.setattr(settings, "legal_operator_name", "Ion Popescu ÎI")
    monkeypatch.setattr(settings, "legal_operator_idno", "1012345678901")
    monkeypatch.setattr(settings, "legal_operator_address", "str. Exemplu 1, Chișinău")
    monkeypatch.setattr(settings, "legal_contact_email", "privacy@flrt.md")
    monkeypatch.setattr(settings, "legal_dpo_contact", "dpo@flrt.md")
    data = (await client.get(f"{API}/legal/documents/privacy?lang=ro")).json()
    for value in ("Ion Popescu ÎI", "1012345678901", "str. Exemplu 1", "privacy@flrt.md"):
        assert value in data["content"]
    assert data["missing_placeholders"] == []
    assert "[de completat]" not in data["content"]


# --- Consimțământ ---------------------------------------------------------------
async def test_cont_nou_cere_consimtamant(client):
    headers = await _register(client, "consent-new@example.com")
    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["consent_required"] is True
    st = (await client.get(f"{API}/legal/consent-status", headers=headers)).json()
    assert st["consent_required"] is True
    assert st["required_documents"] == ["terms", "privacy"]
    assert st["accepted"] == {"terms": None, "privacy": None, "sensitive_data": None}
    assert st["sensitive_data_consent"] is False


async def test_consent_status_cere_autentificare(client):
    r = await client.get(f"{API}/legal/consent-status")
    assert r.status_code == 401


async def test_acceptarea_inchide_poarta_si_consemneaza_ip_ua(client, db_session):
    headers = await _register(client, "consent-ok@example.com")
    st = (await client.get(f"{API}/legal/consent-status", headers=headers)).json()
    r = await client.post(
        f"{API}/legal/consent",
        json={"documents": ["terms", "privacy"], "versions": st["current_versions"]},
        headers={**headers, "User-Agent": "TelegramMiniApp/1.0", "X-Forwarded-For": "203.0.113.7"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["consent_required"] is False
    assert body["accepted"]["terms"]["version"] == st["current_versions"]["terms"]
    assert body["sensitive_data_consent"] is False  # opțional, nebifat

    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["consent_required"] is False

    rows = (
        await db_session.execute(
            select(UserConsent).where(UserConsent.user_id == uuid.UUID(me["id"]))
        )
    ).scalars().all()
    assert {r.document for r in rows} == {"terms", "privacy"}
    assert all(r.user_agent == "TelegramMiniApp/1.0" for r in rows)
    assert all(r.ip for r in rows)


async def test_doar_un_document_obligatoriu_nu_ajunge(client):
    headers = await _register(client, "consent-half@example.com")
    versions = legal_service.current_versions()
    r = await client.post(
        f"{API}/legal/consent",
        json={"documents": ["terms"], "versions": versions},
        headers=headers,
    )
    assert r.status_code == 200
    assert r.json()["consent_required"] is True


async def test_versiune_expirata_409(client):
    headers = await _register(client, "consent-stale@example.com")
    r = await client.post(
        f"{API}/legal/consent",
        json={"documents": ["terms", "privacy"], "versions": {"terms": "0.1", "privacy": "0.1"}},
        headers=headers,
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "legal_version_mismatch"


@pytest.mark.parametrize(
    "payload",
    [
        {"documents": [], "versions": {}},
        {"documents": ["cookies"], "versions": {}},
        {"documents": ["terms", "terms"], "versions": {"terms": "1.0"}},
    ],
)
async def test_corp_invalid_422(client, payload):
    headers = await _register(client, f"consent-bad-{uuid.uuid4().hex[:6]}@example.com")
    r = await client.post(f"{API}/legal/consent", json=payload, headers=headers)
    assert r.status_code == 422


async def test_versiune_noua_cere_din_nou_consimtamantul(client, monkeypatch):
    headers = await _register(client, "consent-bump@example.com")
    await grant_consents(client, headers, documents=("terms", "privacy"))
    assert (await client.get(f"{API}/auth/me", headers=headers)).json()["consent_required"] is False

    bumped = dict(LEGAL_DOCUMENTS)
    old = bumped["privacy"]
    bumped["privacy"] = LegalDocument("privacy", "2.0", old.effective_date)
    monkeypatch.setattr(legal_service, "LEGAL_DOCUMENTS", bumped)

    assert (await client.get(f"{API}/auth/me", headers=headers)).json()["consent_required"] is True
    await grant_consents(client, headers, documents=("privacy",))
    assert (await client.get(f"{API}/auth/me", headers=headers)).json()["consent_required"] is False


async def test_retragerea_consimtamantului_sensibil(client):
    headers = await _register(client, "consent-withdraw@example.com")
    st = await grant_consents(client, headers)
    assert st["sensitive_data_consent"] is True

    r = await client.post(
        f"{API}/legal/consent/withdraw", json={"documents": ["sensitive_data"]}, headers=headers
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sensitive_data_consent"] is False
    assert body["accepted"]["sensitive_data"]["withdrawn_at"] is not None
    # Obligatoriile rămân acceptate.
    assert body["consent_required"] is False


async def test_termenii_nu_se_retrag_ci_se_sterge_contul(client):
    headers = await _register(client, "consent-nowithdraw@example.com")
    await grant_consents(client, headers)
    r = await client.post(
        f"{API}/legal/consent/withdraw", json={"documents": ["privacy"]}, headers=headers
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "consent_not_withdrawable"


async def test_verificarea_faciala_cere_consimtamant_sensibil(client):
    headers = await _make_user(client, "consent-face@example.com")
    await grant_consents(client, headers, documents=("terms", "privacy"))
    r = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "sensitive_consent_required"

    await grant_consents(client, headers, documents=("sensitive_data",))
    r = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert r.status_code == 200, r.text

    # După retragere, din nou refuz.
    await client.post(
        f"{API}/legal/consent/withdraw", json={"documents": ["sensitive_data"]}, headers=headers
    )
    r = await client.post(f"{API}/profiles/verify-face", json={}, headers=headers)
    assert r.status_code == 403


# --- Export ---------------------------------------------------------------------
async def test_export_contine_datele_userului_fara_secrete(client):
    headers = await _make_user(client, "export@example.com")
    await grant_consents(client, headers)
    r = await client.get(f"{API}/me/export", headers=headers)
    assert r.status_code == 200, r.text
    assert "attachment" in r.headers["content-disposition"]
    assert r.headers["cache-control"] == "no-store"
    data = json.loads(r.content)
    assert data["account"]["email"] == "export@example.com"
    assert "password_hash" not in data["account"]
    assert data["profile"]["name"]
    assert {c["document"] for c in data["consents"]} == {"terms", "privacy", "sensitive_data"}
    for key in ("likes_sent", "matches", "messages_sent", "stories", "ticket_orders", "sessions"):
        assert isinstance(data[key], list)
    assert all("token_hash" not in s for s in data["sessions"])


async def test_export_cere_autentificare(client):
    assert (await client.get(f"{API}/me/export")).status_code == 401


# --- Purjare --------------------------------------------------------------------
async def test_purjarea_pastreaza_consimtamintele_fara_ip_ua(client, db_session):
    from app.services.account_service import purge_user_data

    headers = await _register(client, "consent-purge@example.com")
    await grant_consents(client, headers)
    user_id = uuid.UUID((await client.get(f"{API}/auth/me", headers=headers)).json()["id"])

    await purge_user_data(db_session, user_id)
    await db_session.commit()

    rows = (
        await db_session.execute(select(UserConsent).where(UserConsent.user_id == user_id))
    ).scalars().all()
    assert len(rows) == 3
    for row in rows:
        await db_session.refresh(row)
        assert row.ip is None and row.user_agent is None
