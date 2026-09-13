"""Rute publice de FIDELITATE + folosirea invitațiilor — prefix `/api/v1/loyalty`.

Toate cer un user autentificat (`get_current_user`), ca restul rutelor de produs.

CE NU EXISTĂ AICI, INTENȚIONAT: nicio rută prin care clientul să trimită un preț,
un procent sau id-ul unei trepte. Singurul lucru pe care îl trimite clientul e un
cod de invitație; restul se citește din baza de date (vezi `services/loyalty.py`).

`/invites/redeem` e declarată ÎNAINTEA oricărei rute parametrizate, ca să nu fie
„înghițită" de una.
"""
from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_current_user
from app.core.ratelimit import rate_limit
from app.db.session import get_db
from app.models.user import User
from app.schemas.loyalty import (
    LoyaltyStatusOut,
    RedeemIn,
    RedeemOut,
    TicketQuoteOut,
)
from app.services import loyalty

router = APIRouter()

DbDep = Annotated[AsyncSession, Depends(get_db)]
UserDep = Annotated[User, Depends(get_current_user)]

# Limitare de cereri pe folosirea unui cod (tiparul din `core/ratelimit.py`).
#
# DE CE TOCMAI AICI: un cod de invitație e singurul secret din acest modul, iar
# singura cale de a-l afla fără să-l fi primit e să încerci coduri în rafală.
# Entropia (~60 de biți) face ghicitul imposibil în teorie; limita de rată îl face
# imposibil și în practică, inclusiv dacă cineva scurtează cândva codul din config.
# Un om care a primit o invitație o introduce o dată, deci pragul nu deranjează
# pe nimeni legitim.
_redeem_rl = rate_limit("loyalty_redeem", "rate_limit_invite_redeem_per_min", 60)


@router.get("/me", response_model=LoyaltyStatusOut, tags=["loyalty"])
async def my_loyalty(db: DbDep, user: UserDep) -> LoyaltyStatusOut:
    """Treapta mea, câte ștampile am, ce reducere primesc și cât mai am până la
    următoarea treaptă (protejat)."""
    return await loyalty.get_status(db, user)


@router.post(
    "/invites/redeem",
    response_model=RedeemOut,
    tags=["loyalty"],
    dependencies=[Depends(_redeem_rl)],
)
async def redeem_invite(data: RedeemIn, db: DbDep, user: UserDep) -> RedeemOut:
    """Folosește un cod de invitație (protejat).

    404 cod inexistent · 409 revocată / expirată / epuizată · 403 treaptă
    insuficientă · 429 prea multe încercări. Retrimiterea aceluiași cod de către
    ACELAȘI user reușește idempotent, cu `consumed_new_use=false`.
    """
    return await loyalty.redeem_invite(db, user, data.code)


@router.get(
    "/events/{event_id}/ticket-quote",
    response_model=TicketQuoteOut,
    tags=["loyalty"],
)
async def ticket_quote(
    event_id: uuid.UUID, db: DbDep, user: UserDep
) -> TicketQuoteOut:
    """Cât plătesc EU pe biletul acestui eveniment, cu defalcarea reducerii.

    Prețul e calculat integral pe server, din ștampilele reale, promo-ul
    evenimentului și invitațiile efectiv folosite. 400 dacă evenimentul nu are
    preț, 404 dacă nu există.
    """
    return await loyalty.ticket_quote(db, user, event_id)
