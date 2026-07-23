"""Scheme Pydantic v2 pentru CUMPĂRAREA de BILETE ONLINE la evenimente prin
transfer bancar cu verificare manuală de admin.

CONTRACT (consumat de aplicația mobilă ȘI de panoul de admin):
  * Public user  → TicketOrderOut, PaymentInstructions, TicketOrderCreateOut, DeclareIn
  * Admin        → AdminTicketOrderOut, RejectIn, PaymentSettingsIn, PaymentSettingsOut

Ca peste tot în `schemas/`, ieșirile enumeră EXPLICIT câmpurile expuse (fără
`from_attributes` peste modelul ORM întreg), iar intrările de text trec prin
validatorii defensivi (`safe_str` / `optional_safe_str`: trim, non-gol, plafon,
fără control chars / HTML).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.core.validators import optional_safe_str, safe_str

# Plafoane aliniate cu coloanele din `models/ticket_order.py`.
NOTE_MAX_LENGTH = 500
BANK_BENEFICIARY_MAX_LENGTH = 200
BANK_IBAN_MAX_LENGTH = 64
BANK_NAME_MAX_LENGTH = 200
INSTRUCTIONS_MAX_LENGTH = 2000


# --- Public: ieșiri -----------------------------------------------------------
class TicketOrderOut(BaseModel):
    """O comandă de bilet a userului.

    `ticket_code` e prezent DOAR când `status == 'approved'` (serviciul îl pune pe
    None în orice altă stare) — un bilet neverificat nu are cod valid.
    """

    id: uuid.UUID
    event_id: uuid.UUID
    event_title: str
    event_starts_at: datetime
    price: float
    currency: str
    reference: str
    status: str
    user_note: str | None = None
    admin_note: str | None = None
    ticket_code: str | None = None
    created_at: datetime
    decided_at: datetime | None = None


class PaymentInstructions(BaseModel):
    """Instrucțiunile de plată returnate la crearea unei comenzi (și la consultare
    cât timp comanda nu e plătită)."""

    beneficiary: str
    iban: str
    bank_name: str | None = None
    amount: float
    currency: str
    # Referința userului (`U-XXXXXXXX`) — de pus în comentariul transferului.
    reference: str
    # Comentariul structurat recomandat, ex. „Bilet {titlu} {dată} Ref:U-XXXXXXXX".
    comment_template: str
    instructions: str | None = None


class TicketOrderCreateOut(BaseModel):
    """Comanda + instrucțiunile de plată.

    La CREARE (`POST /events/{id}/ticket-orders`) `payment` e mereu prezent. La
    CONSULTARE (`GET /ticket-orders/{id}`) e prezent doar cât timp comanda e
    `awaiting_payment`; după declarare/decizie devine `null` (userul nu mai are ce
    plăti)."""

    order: TicketOrderOut
    payment: PaymentInstructions | None = None


# --- Public: intrări ----------------------------------------------------------
class DeclareIn(BaseModel):
    """Payload la `POST /ticket-orders/{id}/declare` — declararea plății."""

    note: optional_safe_str(NOTE_MAX_LENGTH) | None = None


# --- Admin --------------------------------------------------------------------
class TicketOrderUserOut(BaseModel):
    """Userul care a plasat comanda, așa cum îl vede adminul (email + referință)."""

    id: uuid.UUID
    email: str
    payment_ref: str


class TicketOrderEventOut(BaseModel):
    """Evenimentul comenzii, minimal, pentru coada de admin."""

    id: uuid.UUID
    title: str
    starts_at: datetime


class AdminTicketOrderOut(BaseModel):
    """O comandă în coada de admin, cu userul și evenimentul alăturate."""

    id: uuid.UUID
    user: TicketOrderUserOut
    event: TicketOrderEventOut
    price: float
    currency: str
    reference: str
    status: str
    user_note: str | None = None
    admin_note: str | None = None
    ticket_code: str | None = None
    created_at: datetime
    decided_at: datetime | None = None


class RejectIn(BaseModel):
    """Payload la `POST /admin/ticket-orders/{id}/reject`."""

    reason: optional_safe_str(NOTE_MAX_LENGTH) | None = None


class PaymentSettingsIn(BaseModel):
    """Payload la `PUT /admin/payment-settings` — datele bancare globale."""

    bank_beneficiary: safe_str(BANK_BENEFICIARY_MAX_LENGTH)
    bank_iban: safe_str(BANK_IBAN_MAX_LENGTH)
    bank_name: optional_safe_str(BANK_NAME_MAX_LENGTH) | None = None
    instructions: optional_safe_str(INSTRUCTIONS_MAX_LENGTH) | None = None


class PaymentSettingsOut(BaseModel):
    """Datele bancare globale (singleton)."""

    bank_beneficiary: str
    bank_iban: str
    bank_name: str | None = None
    instructions: str | None = None
    updated_at: datetime
