"""Comutatorul GLOBAL al vânzării online de bilete (`PaymentSettings.online_sales_enabled`).

Modul separat (nu în `ticket_order_service`) ca să-l poată folosi și
`event_service` / `loyalty` fără import circular (`ticket_order_service`
importă deja `loyalty`).

CITIRE: o singură coloană, fără lock și fără commit — se citește O DATĂ pe
cerere (lista de evenimente nu face N+1). Rândul singleton lipsă = vânzare
PORNITĂ (valoarea implicită a coloanei); NU îl creăm leneș pe căile publice,
asta rămâne treaba endpoint-urilor de admin. Nu există cache: comutarea are
efect imediat la următoarea cerere.
"""
from __future__ import annotations

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CodedHTTPException, ErrorCode
from app.models.ticket_order import PAYMENT_SETTINGS_ID, PaymentSettings

# Mesaj pentru oameni; contractul pentru clienți e `code`.
ONLINE_SALES_DISABLED_DETAIL = (
    "Vânzarea online de bilete este suspendată temporar. "
    "Încearcă mai târziu sau cumpără biletul la intrare."
)


async def is_online_sales_enabled(db: AsyncSession) -> bool:
    """True dacă vânzarea online e pornită global (implicit True)."""
    value = await db.scalar(
        select(PaymentSettings.online_sales_enabled).where(
            PaymentSettings.id == PAYMENT_SETTINGS_ID
        )
    )
    return True if value is None else bool(value)


def ensure_online_sales_enabled(enabled: bool) -> None:
    """409 `online_sales_disabled` cât timp comutatorul global e oprit.

    Se aplică DOAR la ce ar porni o vânzare NOUĂ (comandă, cerere, cotație).
    Comenzile existente (dovada plății, aprobarea, scanarea) nu trec pe aici.
    """
    if not enabled:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ONLINE_SALES_DISABLED_DETAIL,
            code=ErrorCode.ONLINE_SALES_DISABLED,
        )
