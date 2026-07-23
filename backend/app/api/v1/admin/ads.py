"""CRUD + setări pentru sistemul de reclame — `/api/v1/admin/ads*`.

Protecția (`require_admin`) se aplică O SINGURĂ DATĂ, pe `include_router` în
`admin/__init__.py` — nu rută cu rută (vezi comentariul de acolo).

ORDINEA RUTELOR CONTEAZĂ: `/ads/settings` e declarată ÎNAINTEA lui `/ads/{ad_id}`.
Altfel FastAPI ar potrivi „settings" ca valoare a lui `{ad_id}` și ar încerca să-l
convertească la `int` → 422 în loc să servească setările.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.ad import AdIn, AdOut, AdSettingsIn, AdSettingsOut, AdUpdate
from app.services import ad_service
from app.services.admin_service import request_ip

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/ads", response_model=list[AdOut])
async def list_ads(db: DbDep, admin: CurrentAdmin) -> list[AdOut]:
    """Toate reclamele (cele mai recente primele), inclusiv cele inactive."""
    return await ad_service.list_ads(db)


@router.post("/ads", response_model=AdOut, status_code=status.HTTP_201_CREATED)
async def create_ad(
    data: AdIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdOut:
    """Creează o reclamă nouă (auditat: `ad.create`)."""
    return await ad_service.create_ad(db, data, actor=admin, ip=request_ip(request))


# --- Setări globale (ÎNAINTE de rutele parametrizate /ads/{ad_id}) -------------
@router.get("/ads/settings", response_model=AdSettingsOut)
async def get_ad_settings(db: DbDep, admin: CurrentAdmin) -> AdSettingsOut:
    """Parametrii globali (singleton). Creat leneș cu defaults dacă lipsește."""
    return await ad_service.get_settings(db)


@router.put("/ads/settings", response_model=AdSettingsOut)
async def update_ad_settings(
    data: AdSettingsIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdSettingsOut:
    """Actualizează parametrii globali ai sistemului de reclame (auditat: `ad.settings.update`)."""
    return await ad_service.update_settings(
        db, data, actor=admin, ip=request_ip(request)
    )


# --- Rute parametrizate -------------------------------------------------------
@router.get("/ads/{ad_id}", response_model=AdOut)
async def get_ad(ad_id: int, db: DbDep, admin: CurrentAdmin) -> AdOut:
    """O reclamă după id (404 dacă nu există)."""
    return await ad_service.get_ad(db, ad_id)


@router.patch("/ads/{ad_id}", response_model=AdOut)
async def update_ad(
    ad_id: int, data: AdUpdate, request: Request, db: DbDep, admin: CurrentAdmin
) -> AdOut:
    """Editare PARȚIALĂ a unei reclame (422 dacă payload gol, 404 dacă lipsește; auditat: `ad.update`)."""
    return await ad_service.update_ad(
        db, ad_id, data, actor=admin, ip=request_ip(request)
    )


@router.delete("/ads/{ad_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ad(
    ad_id: int, request: Request, db: DbDep, admin: CurrentAdmin
) -> None:
    """Șterge o reclamă (404 dacă nu există; auditat: `ad.delete`)."""
    await ad_service.delete_ad(db, ad_id, actor=admin, ip=request_ip(request))
