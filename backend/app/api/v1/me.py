"""Drepturile persoanei vizate — montate sub /api/v1/me.

`GET /me/export`: copia datelor personale (acces + portabilitate, Legea nr.
195/2024 / GDPR art. 15 și 20), JSON descărcabil. Ștergerea contului există deja
la `POST /settings/account/delete` (perioadă de grație, apoi purjare automată).
"""
from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.db.session import get_db
from app.services.data_export import export_user_data

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]

EXPORT_FILENAME = "flirt-data-export.json"


@router.get("/export", summary="Descarcă datele mele (JSON)")
async def export_my_data(db: DbDep, user: CurrentUser) -> Response:
    data = await export_user_data(db, user)
    return Response(
        content=json.dumps(data, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{EXPORT_FILENAME}"',
            # Date personale: niciun cache intermediar.
            "Cache-Control": "no-store",
        },
    )
