"""Testul de umor din panou — `/api/v1/admin/humor/*`.

Comutatorul global (activ / inactiv), textul ecranului de introducere și glumele
(CRUD + reordonare). Protecția (`require_admin`) se aplică O SINGURĂ DATĂ, pe
`include_router` în `admin/__init__.py`.

ORDINEA RUTELOR: `/humor/questions/order` e declarată ÎNAINTEA rutelor
`/humor/questions/{question_id}`, ca „order" să nu fie citit ca uuid.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentAdmin
from app.db.session import get_db
from app.schemas.humor import (
    HumorQuestionIn,
    HumorQuestionOut,
    HumorQuestionUpdate,
    HumorReorderIn,
    HumorSettingsIn,
    HumorSettingsOut,
)
from app.services import humor_service
from app.services.admin_service import request_ip

router = APIRouter(tags=["admin"])

DbDep = Annotated[AsyncSession, Depends(get_db)]


@router.get("/humor/settings", response_model=HumorSettingsOut)
async def get_humor_settings(db: DbDep, admin: CurrentAdmin) -> HumorSettingsOut:
    """Starea testului (singleton, creat leneș cu valorile implicite)."""
    return await humor_service.admin_get_settings(db)


@router.put("/humor/settings", response_model=HumorSettingsOut)
async def update_humor_settings(
    data: HumorSettingsIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> HumorSettingsOut:
    """Pornește / oprește testul + textul de introducere (auditat).

    409 dacă se cere pornirea cu mai puțin de `min_active_questions` glume active.
    """
    return await humor_service.admin_update_settings(
        db, data, actor=admin, ip=request_ip(request)
    )


@router.get("/humor/questions", response_model=list[HumorQuestionOut])
async def list_humor_questions(db: DbDep, admin: CurrentAdmin) -> list[HumorQuestionOut]:
    """Toate glumele (inclusiv cele inactive), în ordinea testului."""
    return await humor_service.admin_list_questions(db)


@router.post(
    "/humor/questions",
    response_model=HumorQuestionOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_humor_question(
    data: HumorQuestionIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> HumorQuestionOut:
    """Adaugă o glumă la finalul testului (auditat)."""
    return await humor_service.admin_create_question(
        db, data, actor=admin, ip=request_ip(request)
    )


@router.put("/humor/questions/order", response_model=list[HumorQuestionOut])
async def reorder_humor_questions(
    data: HumorReorderIn, request: Request, db: DbDep, admin: CurrentAdmin
) -> list[HumorQuestionOut]:
    """Rescrie ordinea glumelor (lista completă de id-uri, auditat)."""
    return await humor_service.admin_reorder_questions(
        db, data.ids, actor=admin, ip=request_ip(request)
    )


@router.patch("/humor/questions/{question_id}", response_model=HumorQuestionOut)
async def update_humor_question(
    question_id: uuid.UUID,
    data: HumorQuestionUpdate,
    request: Request,
    db: DbDep,
    admin: CurrentAdmin,
) -> HumorQuestionOut:
    """Modifică o glumă (text, tip, activ/inactiv). Auditat."""
    return await humor_service.admin_update_question(
        db, question_id, data, actor=admin, ip=request_ip(request)
    )


@router.delete("/humor/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_humor_question(
    question_id: uuid.UUID, request: Request, db: DbDep, admin: CurrentAdmin
) -> None:
    """Șterge definitiv o glumă. Vectorii deja salvați nu sunt afectați."""
    await humor_service.admin_delete_question(
        db, question_id, actor=admin, ip=request_ip(request)
    )
