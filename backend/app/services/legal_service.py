"""Documente legale versionate + evidența consimțămintelor (Legea nr. 195/2024).

DOCUMENTELE
-----------
Textele stau în `app/legal_content/{doc}.{lang}.md` (română = versiunea de
referință; rusă și engleză = traduceri). Sunt servite de
`GET /api/v1/legal/documents/{doc}?lang=` și randate de clienți (Mini App,
aplicația nativă) — un text se poate corecta fără rebuild de aplicații.

VERSIUNI
--------
`LEGAL_DOCUMENTS` de mai jos e SINGURA sursă a versiunilor. La o modificare
de FOND a unui text se mărește versiunea: toți utilizatorii care au acceptat
versiunea veche primesc `consent_required=true` și sunt rugați să accepte din nou.
O corectură de formă (typo) NU schimbă versiunea.

PLACEHOLDERE
------------
`{{operator_name}}` etc. se înlocuiesc cu valorile din `settings.legal_*`. Un
câmp gol devine un marcaj VIZIBIL („[de completat]") și apare în
`missing_placeholders` — nu inventăm date juridice.
"""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timezone
from functools import lru_cache
from pathlib import Path

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.consent import (
    CONSENT_DOCUMENTS,
    CONSENT_PRIVACY,
    CONSENT_SENSITIVE,
    CONSENT_TERMS,
    UserConsent,
)
from app.models.user import User

CONTENT_DIR = Path(__file__).resolve().parent.parent / "legal_content"

LANGS = ("ro", "ru", "en")
DEFAULT_LANG = "ro"

# Adresa publică de suport, folosită când `LEGAL_CONTACT_EMAIL` nu e setat.
DEFAULT_CONTACT_EMAIL = "support@flrt.md"


@dataclass(frozen=True)
class LegalDocument:
    key: str
    version: str
    effective_date: date


# Data intrării în vigoare a Legii nr. 195/2024 = data de la care se aplică textele.
_EFFECTIVE = date(2026, 8, 23)

LEGAL_DOCUMENTS: dict[str, LegalDocument] = {
    "privacy": LegalDocument("privacy", "1.0", _EFFECTIVE),
    "terms": LegalDocument("terms", "1.0", _EFFECTIVE),
    "consent": LegalDocument("consent", "1.0", _EFFECTIVE),
}

# Consimțământ → documentul a cărui versiune o acceptă userul.
CONSENT_TO_DOCUMENT = {
    CONSENT_TERMS: "terms",
    CONSENT_PRIVACY: "privacy",
    CONSENT_SENSITIVE: "consent",
}
# Obligatorii pentru folosirea serviciului. `sensitive_data` e OPȚIONAL
# (doar pentru verificarea facială) și poate fi retras oricând.
REQUIRED_CONSENTS = (CONSENT_TERMS, CONSENT_PRIVACY)
WITHDRAWABLE_CONSENTS = (CONSENT_SENSITIVE,)

_MISSING_MARK = {
    "ro": "[de completat]",
    "ru": "[подлежит заполнению]",
    "en": "[to be completed]",
}

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def current_version(consent: str) -> str:
    return LEGAL_DOCUMENTS[CONSENT_TO_DOCUMENT[consent]].version


def current_versions() -> dict[str, str]:
    return {c: current_version(c) for c in CONSENT_DOCUMENTS}


def _years(days: int) -> str:
    """1825 → "5"; o valoare care nu e ani întregi → cu o zecimală (ex. "5.5")."""
    years = days / 365
    return str(int(years)) if days % 365 == 0 else f"{years:.1f}"


def _placeholder_values() -> dict[str, str]:
    """Valorile din config. Șir gol = lipsește (se marchează vizibil)."""
    return {
        "operator_name": (
            settings.legal_operator_name.strip() or settings.operator_legal_name.strip()
        ),
        "operator_idno": settings.legal_operator_idno.strip(),
        "operator_address": settings.legal_operator_address.strip(),
        "contact_email": settings.legal_contact_email.strip() or DEFAULT_CONTACT_EMAIL,
        "dpo_contact": settings.legal_dpo_contact.strip(),
        "grace_days": str(settings.account_deletion_grace_days),
        "backup_days": "14",
        # Termenele de retenție (app/services/retention_service.py + cron-ul de
        # jurnale). Textul politicii le citește DIN CONFIG, ca să nu poată
        # promite altceva decât face codul.
        "proof_retention_years": _years(settings.payment_proof_retention_days),
        "rejected_proof_days": str(settings.rejected_payment_proof_retention_days),
        "log_retention_days": str(settings.log_retention_days),
    }


@lru_cache(maxsize=32)
def _raw_content(doc: str, lang: str) -> str:
    return (CONTENT_DIR / f"{doc}.{lang}.md").read_text(encoding="utf-8")


def normalize_lang(lang: str | None) -> str:
    code = (lang or "").strip().lower()[:2]
    return code if code in LANGS else DEFAULT_LANG


def render_document(doc: str, lang: str | None) -> dict:
    """Documentul `doc` în limba cerută, cu placeholderele înlocuite."""
    meta = LEGAL_DOCUMENTS.get(doc)
    if meta is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Document necunoscut")
    lang = normalize_lang(lang)
    values = _placeholder_values()
    values["version"] = meta.version
    values["effective_date"] = (
        meta.effective_date.strftime("%d.%m.%Y")
        if lang != "en"
        else meta.effective_date.strftime("%d %B %Y").lstrip("0")
    )
    missing: list[str] = []

    def _sub(match: re.Match) -> str:
        name = match.group(1)
        value = values.get(name, "")
        if not value:
            if name not in missing:
                missing.append(name)
            return _MISSING_MARK[lang]
        return value

    content = _PLACEHOLDER_RE.sub(_sub, _raw_content(doc, lang))
    title = next(
        (line[2:].strip() for line in content.splitlines() if line.startswith("# ")),
        doc,
    )
    return {
        "document": doc,
        "lang": lang,
        "version": meta.version,
        "effective_date": meta.effective_date,
        "title": title,
        "content": content,
        "missing_placeholders": missing,
    }


# --- Consimțăminte ------------------------------------------------------------
async def _latest_by_document(
    db: AsyncSession, user_id: uuid.UUID
) -> dict[str, UserConsent]:
    rows = (
        await db.execute(
            select(UserConsent)
            .where(UserConsent.user_id == user_id)
            .order_by(UserConsent.accepted_at.desc(), UserConsent.created_at.desc())
        )
    ).scalars().all()
    latest: dict[str, UserConsent] = {}
    for row in rows:
        latest.setdefault(row.document, row)
    return latest


def _is_valid(row: UserConsent | None, consent: str) -> bool:
    return (
        row is not None
        and row.withdrawn_at is None
        and row.version == current_version(consent)
    )


async def consent_required(db: AsyncSession, user: User) -> bool:
    """True dacă userul NU a acceptat versiunea curentă a unui document obligatoriu."""
    latest = await _latest_by_document(db, user.id)
    return not all(_is_valid(latest.get(c), c) for c in REQUIRED_CONSENTS)


async def has_sensitive_consent(db: AsyncSession, user: User) -> bool:
    latest = await _latest_by_document(db, user.id)
    return _is_valid(latest.get(CONSENT_SENSITIVE), CONSENT_SENSITIVE)


async def consent_status(db: AsyncSession, user: User) -> dict:
    latest = await _latest_by_document(db, user.id)
    accepted = {
        c: (
            {
                "version": row.version,
                "accepted_at": row.accepted_at,
                "withdrawn_at": row.withdrawn_at,
            }
            if (row := latest.get(c)) is not None
            else None
        )
        for c in CONSENT_DOCUMENTS
    }
    return {
        "consent_required": not all(
            _is_valid(latest.get(c), c) for c in REQUIRED_CONSENTS
        ),
        "required_documents": list(REQUIRED_CONSENTS),
        "current_versions": current_versions(),
        "accepted": accepted,
        "sensitive_data_consent": _is_valid(
            latest.get(CONSENT_SENSITIVE), CONSENT_SENSITIVE
        ),
    }


async def record_consent(
    db: AsyncSession,
    user: User,
    documents: list[str],
    versions: dict[str, str],
    *,
    ip: str | None,
    user_agent: str | None,
) -> dict:
    """Înregistrează acceptarea documentelor la versiunile CURENTE.

    Clientul trimite versiunea pe care a AFIȘAT-O. Dacă între timp textul s-a
    schimbat, refuzăm (409): nu putem consemna acceptarea unui text pe care
    userul nu l-a văzut.
    """
    stale = [
        d for d in documents if versions.get(d) != current_version(d)
    ]
    if stale:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "legal_version_mismatch",
                "documents": stale,
                "current_versions": current_versions(),
            },
        )
    now = datetime.now(timezone.utc)
    for doc in documents:
        db.add(
            UserConsent(
                user_id=user.id,
                document=doc,
                version=current_version(doc),
                accepted_at=now,
                ip=(ip or None) and ip[:64],
                user_agent=(user_agent or None) and user_agent[:512],
            )
        )
    await db.commit()
    return await consent_status(db, user)


async def withdraw_consent(db: AsyncSession, user: User, documents: list[str]) -> dict:
    """Retrage consimțămintele opționale. Cele obligatorii = ștergerea contului."""
    not_allowed = [d for d in documents if d not in WITHDRAWABLE_CONSENTS]
    if not_allowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "consent_not_withdrawable",
                "documents": not_allowed,
                "message": (
                    "Termenii și Politica de confidențialitate sunt necesare pentru "
                    "furnizarea serviciului; pentru a renunța, ștergeți contul."
                ),
            },
        )
    latest = await _latest_by_document(db, user.id)
    now = datetime.now(timezone.utc)
    for doc in documents:
        row = latest.get(doc)
        if row is not None and row.withdrawn_at is None:
            row.withdrawn_at = now
    await db.commit()
    return await consent_status(db, user)
