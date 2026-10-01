"""Scheme pentru SCANAREA biletelor la intrare (`/api/v1/admin/tickets/*`)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# Lungimea maximă acceptată pentru textul scanat/tastat. Codurile reale au 32 de
# caractere; lăsăm loc pentru un URL sau spații/cratime tastate de om.
SCAN_CODE_MAX_LENGTH = 512

ScanResult = Literal[
    "admitted",
    "already_admitted",
    "wrong_event",
    "not_paid",
    "cancelled",
    "event_over",
    "not_found",
]


class TicketScanIn(BaseModel):
    """Payload la `POST /admin/tickets/scan`.

    `code` = conținutul QR-ului SAU codul tastat de om (normalizat de serviciu:
    fără spații/cratime, litere mici).
    """

    code: str = Field(min_length=1, max_length=SCAN_CODE_MAX_LENGTH)
    event_id: uuid.UUID


class ScannedTicketOut(BaseModel):
    """Ce vede staff-ul pe cardul de rezultat (fără date sensibile)."""

    # 'event_ticket' (comandă plătită la un eveniment) | 'flirt_party' (biletul
    # one-time Flirt Party al userului).
    ticket_type: Literal["event_ticket", "flirt_party"]
    first_name: str | None = None
    age: int | None = None
    photo_url: str | None = None
    # Evenimentul BILETULUI (la `wrong_event` diferă de cel scanat).
    event_id: uuid.UUID | None = None
    event_title: str | None = None
    starts_at: datetime | None = None
    # Câte persoane intră pe acest bilet (o cerere poate avea mai multe bilete).
    ticket_quantity: int = 1
    admitted_at: datetime | None = None
    admitted_by_email: str | None = None


class TicketScanOut(BaseModel):
    result: ScanResult
    ticket: ScannedTicketOut | None = None


class ScanStatsOut(BaseModel):
    """Contorul live de la intrare: câți au intrat din câți au bilet."""

    event_id: uuid.UUID
    # Persoane cu bilet plătit/aprobat (suma `ticket_quantity`).
    sold: int
    # Persoane intrate: bilete de eveniment + bilete Flirt Party scanate aici.
    admitted: int
    # Din `admitted`, câte au intrat cu biletul Flirt Party.
    flirt_party_admitted: int


class AdmissionOut(BaseModel):
    """Un rând din lista intrărilor recente la un eveniment."""

    ticket_type: Literal["event_ticket", "flirt_party"]
    first_name: str | None = None
    age: int | None = None
    photo_url: str | None = None
    ticket_quantity: int = 1
    admitted_at: datetime
    admitted_by_email: str | None = None
