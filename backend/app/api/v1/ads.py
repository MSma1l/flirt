"""Rute publice pentru reclame — `/api/v1/ads*` (utilizator autentificat).

Aceeași dependență de auth ca restul rutelor de app (`get_current_user`): doar un
utilizator logat cere config-ul și următoarea reclamă.

  * GET  /ads/config             → parametrii de afișare (enabled / la câte swipe-uri / durata max).
  * GET  /ads/next               → creativul de afișat acum (targetat pe user + în fereastra de
                                    programare), cu durata deja plafonată. `204` dacă sistemul e
                                    dezactivat sau nu rămâne nicio reclamă eligibilă.
  * POST /ads/{ad_id}/impression → contor brut de afișări (+1), `204`. `404` dacă ad-ul lipsește.
  * POST /ads/{ad_id}/click      → contor brut de click-uri (+1), `204`. `404` dacă ad-ul lipsește.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.ad import AdConfigOut, AdNextOut
from app.services import ad_service

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]


@router.get("/config", response_model=AdConfigOut)
async def ads_config(db: DbDep, user: UserDep) -> AdConfigOut:
    """Configul de afișare a reclamelor (singleton, creat leneș cu defaults)."""
    return await ad_service.get_config(db)


@router.get(
    "/next",
    response_model=AdNextOut,
    responses={204: {"description": "Reclame dezactivate sau niciuna activă."}},
)
async def ads_next(db: DbDep, user: UserDep):
    """Următoarea reclamă de afișat (aleasă aleator, ponderat, targetată pe user), sau 204."""
    ad = await ad_service.get_next(db, user)
    if ad is None:
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return ad


@router.post(
    "/{ad_id}/impression",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"description": "Reclamă inexistentă."}},
)
async def ads_impression(ad_id: int, db: DbDep, user: UserDep) -> Response:
    """Marchează o AFIȘARE a reclamei (contor brut, +1 atomic). 404 dacă nu există."""
    await ad_service.track_impression(db, ad_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{ad_id}/click",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={404: {"description": "Reclamă inexistentă."}},
)
async def ads_click(ad_id: int, db: DbDep, user: UserDep) -> Response:
    """Marchează un CLICK pe reclamă (contor brut, +1 atomic). 404 dacă nu există."""
    await ad_service.track_click(db, ad_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
