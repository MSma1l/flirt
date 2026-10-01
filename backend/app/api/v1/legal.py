"""Documente legale versionate + consimțăminte — montate sub /api/v1/legal.

Diferit de `app/api/legal.py` (paginile HTML publice `/legal/*`, pentru
recenzenții magazinelor): aici e API-ul pe care îl randează aplicațiile, cu
versiune, ca textul să poată fi actualizat fără rebuild și consimțământul să
fie cerut din nou la o versiune nouă.

NU blocăm alte rute pe server dacă lipsește consimțământul (aplicația nativă
publicată nu cunoaște fluxul) — clientul citește `consent_required` din
`/auth/me` sau `/legal/consent-status`. Excepție: verificarea facială (date
biometrice) cere consimțământ explicit `sensitive_data` (vezi profiles.py).
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.ratelimit import client_ip
from app.db.session import get_db
from app.schemas.legal import (
    ConsentIn,
    ConsentStatusOut,
    ConsentWithdrawIn,
    LegalDocumentOut,
)
from app.services import legal_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/documents/{doc}", response_model=LegalDocumentOut)
async def get_document(
    doc: Literal["privacy", "terms", "consent"],
    lang: Annotated[str | None, Query(max_length=16)] = None,
) -> dict:
    """Documentul legal în limba cerută (ro implicit). PUBLIC — fără autentificare."""
    return legal_service.render_document(doc, lang)


@router.get("/consent-status", response_model=ConsentStatusOut)
async def get_consent_status(db: DbDep, user: CurrentUser) -> dict:
    """Versiunile curente, ce a acceptat userul și dacă trebuie să accepte din nou."""
    return await legal_service.consent_status(db, user)


@router.post("/consent", response_model=ConsentStatusOut)
async def accept(data: ConsentIn, request: Request, db: DbDep, user: CurrentUser) -> dict:
    """Consemnează acceptarea (cu IP și user-agent, ca dovadă)."""
    return await legal_service.record_consent(
        db,
        user,
        list(data.documents),
        data.versions,
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@router.post("/consent/withdraw", response_model=ConsentStatusOut)
async def withdraw(data: ConsentWithdrawIn, db: DbDep, user: CurrentUser) -> dict:
    """Retrage consimțăminte OPȚIONALE (`sensitive_data`)."""
    return await legal_service.withdraw_consent(db, user, list(data.documents))
