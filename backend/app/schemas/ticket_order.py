"""Scheme Pydantic v2 pentru CUMPĂRAREA de BILETE ONLINE la evenimente prin
transfer bancar (IBAN) sau MIA Plăți Instant (după telefon), cu verificare
manuală de admin.

CONTRACT (consumat de aplicația mobilă ȘI de panoul de admin):
  * Public user  → TicketOrderOut, PaymentInstructions, TicketOrderCreateOut, DeclareIn
  * Admin        → AdminTicketOrderOut, RejectIn, PaymentSettingsIn, PaymentSettingsOut

Ca peste tot în `schemas/`, ieșirile enumeră EXPLICIT câmpurile expuse (fără
`from_attributes` peste modelul ORM întreg), iar intrările de text trec prin
validatorii defensivi (`safe_str` / `optional_safe_str`: trim, non-gol, plafon,
fără control chars / HTML).
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.validators import optional_safe_str, safe_str

# Plafoane aliniate cu coloanele din `models/ticket_order.py`.
NOTE_MAX_LENGTH = 500
BANK_BENEFICIARY_MAX_LENGTH = 200
BANK_IBAN_MAX_LENGTH = 64
BANK_NAME_MAX_LENGTH = 200
INSTRUCTIONS_MAX_LENGTH = 2000
MIA_RECIPIENT_NAME_MAX_LENGTH = 200

# Metodele de plată, în ORDINEA în care le arătăm userului (MIA întâi — instant).
PAYMENT_METHOD_MIA = "mia"
PAYMENT_METHOD_IBAN = "iban"

# Separatori tolerați la introducerea numărului: spațiu, cratimă, punct, paranteze.
_PHONE_SEPARATORS_RE = re.compile(r"[\s\-.()]")
_MD_LOCAL_RE = re.compile(r"^\d{8}$")


def normalize_md_phone(raw: str) -> str:
    """Normalizează un număr moldovenesc la `+373XXXXXXXX` (8 cifre după prefix).

    Acceptă: `069123456`, `69123456`, `+373 69 123 456`, `37369123456`,
    `0037369123456`. Orice altceva → `ValueError` (Pydantic îl face 422).
    """
    v = _PHONE_SEPARATORS_RE.sub("", raw)
    if v.startswith("+373"):
        local = v[4:]
    elif v.startswith("00373"):
        local = v[5:]
    elif v.startswith("373") and len(v) == 11:
        local = v[3:]
    elif v.startswith("0") and len(v) == 9:
        local = v[1:]
    else:
        local = v
    if not _MD_LOCAL_RE.match(local):
        raise ValueError(
            "Număr de telefon invalid: format așteptat +373 urmat de 8 cifre."
        )
    return f"+373{local}"


def payment_methods_for(
    mia_phone: str | None, bank_iban: str | None, mia_qr_url: str | None = None
) -> list[str]:
    """Metodele configurate, în ordine (`mia` înaintea lui `iban`).

    MIA e configurat dacă există un telefon SAU un cod QR."""
    methods: list[str] = []
    if mia_phone or mia_qr_url:
        methods.append(PAYMENT_METHOD_MIA)
    if bank_iban:
        methods.append(PAYMENT_METHOD_IBAN)
    return methods


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
    # Aditiv: starea BILETULUI (≠ `status`, care e starea comenzii/plății):
    # valid | admitted | used | expired | cancelled; None cât timp plata nu e
    # decisă (încă nu există bilet). Vezi `ticket_lifecycle`.
    ticket_status: str | None = None
    admitted_at: datetime | None = None
    # Aditiv: dovada plății (chitanța) — doar FAPTUL că există, nu URL-ul intern.
    payment_proof_uploaded: bool = False
    # `mia` | `iban` declarat de user la încărcarea dovezii; None = necunoscut.
    payment_method: str | None = None
    payment_declared_at: datetime | None = None


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
    # Aditiv — MIA Plăți Instant: plata din aplicația băncii după numărul de
    # telefon (`+373XXXXXXXX`). None = metoda nu e configurată.
    mia_phone: str | None = None
    # Numele pe care plătitorul îl vede confirmat în aplicația băncii.
    mia_recipient_name: str | None = None
    # Imaginea codului QR MIA (URL public, PNG fără metadate); None = fără QR.
    mia_qr_url: str | None = None
    # Metodele configurate, în ordinea de afișare: subset ordonat din
    # ["mia", "iban"]. Clienții vechi îl ignoră și citesc `iban` ca înainte.
    payment_methods: list[str] = Field(default_factory=list)


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


# --- Cereri de bilete (contract nou, transfer manual) -----------------------
class TicketRequestCreateIn(BaseModel):
    full_name: safe_str(200)
    phone: safe_str(40)
    email: EmailStr | None = None
    ticket_quantity: int = Field(ge=1, le=20)
    client_message: optional_safe_str(NOTE_MAX_LENGTH) | None = None


class TicketRequestOut(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    event_title: str
    event_starts_at: datetime
    event_venue: str | None = None
    full_name: str | None = None
    phone: str | None = None
    email: str | None = None
    ticket_quantity: int
    ticket_price: float
    total_amount: float
    currency: str
    payment_description: str | None = None
    payment_proof_uploaded: bool = False
    status: str
    client_message: str | None = None
    admin_comment: str | None = None
    created_at: datetime
    reviewed_at: datetime | None = None
    # Aditiv: codul biletului (QR) — DOAR pe cererile aprobate — și starea lui.
    ticket_code: str | None = None
    ticket_status: str | None = None
    admitted_at: datetime | None = None
    # Aditiv: datele de plată — DOAR la `GET /ticket-requests/{id}` cât timp
    # cererea mai așteaptă plata (altfel și în liste: null).
    payment: PaymentInstructions | None = None


class TicketRequestCreateOut(BaseModel):
    request: TicketRequestOut
    payment: PaymentInstructions


class TicketRequestReviewIn(BaseModel):
    status: str = Field(pattern="^(approved|rejected|under_review|additional_information_required|cancelled)$")
    admin_comment: optional_safe_str(NOTE_MAX_LENGTH) | None = None


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
    ticket_status: str | None = None
    admitted_at: datetime | None = None
    # Aditiv — detaliul comenzii în panoul de admin.
    payment_proof_uploaded: bool = False
    # `image` | `pdf` | None — cum se afișează dovada (o citești prin
    # `GET /admin/ticket-orders/{id}/payment-proof`).
    payment_proof_kind: str | None = None
    payment_method: str | None = None
    payment_declared_at: datetime | None = None
    # True = cerere manuală (are nume/telefon), cu propriul set de stări.
    is_request: bool = False
    ticket_quantity: int = 1
    total_amount: float | None = None
    # Stările în care adminul o poate muta acum (`POST .../status`); [] = finală.
    allowed_statuses: list[str] = Field(default_factory=list)


class AdminStatusChangeIn(BaseModel):
    """Payload la `POST /admin/ticket-orders/{id}/status` — schimbare manuală de stare.

    Tranzițiile permise sunt validate în serviciu (409 cu mesaj clar altfel);
    `note` ajunge la user (ca motiv / cerere de informații) și în audit.
    """

    status: str = Field(
        pattern="^(awaiting_payment|payment_declared|approved|rejected|cancelled|"
        "additional_information_required|under_review)$"
    )
    note: optional_safe_str(NOTE_MAX_LENGTH) | None = None

    @field_validator("note", mode="before")
    @classmethod
    def _blank_note_to_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v


class RejectIn(BaseModel):
    """Payload la `POST /admin/ticket-orders/{id}/reject`."""

    reason: optional_safe_str(NOTE_MAX_LENGTH) | None = None


class PaymentSettingsIn(BaseModel):
    """Payload la `PUT /admin/payment-settings` — datele de plată globale.

    Cel puțin O metodă e obligatorie: MIA (`mia_phone` sau un QR deja încărcat)
    sau IBAN (`bank_beneficiary` + `bank_iban`) — verificat în serviciu, care
    vede și QR-ul salvat (422 altfel). Dacă se dă un IBAN, beneficiarul e
    obligatoriu. QR-ul NU trece prin PUT: are rutele lui (`/mia-qr`).
    """

    # min_length=0: pot fi goale când plata merge doar prin MIA (vezi validatorul).
    bank_beneficiary: safe_str(BANK_BENEFICIARY_MAX_LENGTH, min_length=0) = ""
    bank_iban: safe_str(BANK_IBAN_MAX_LENGTH, min_length=0) = ""
    bank_name: optional_safe_str(BANK_NAME_MAX_LENGTH) | None = None
    instructions: optional_safe_str(INSTRUCTIONS_MAX_LENGTH) | None = None
    # MIA Plăți Instant — normalizat la `+373XXXXXXXX`; ""/None = dezactivat.
    mia_phone: str | None = None
    mia_recipient_name: optional_safe_str(MIA_RECIPIENT_NAME_MAX_LENGTH) | None = None

    @field_validator("mia_phone", "mia_recipient_name", mode="before")
    @classmethod
    def _blank_to_none(cls, v: object) -> object:
        # Formularul de admin trimite "" pentru un câmp golit → „nesetat".
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("mia_phone")
    @classmethod
    def _normalize_mia_phone(cls, v: str | None) -> str | None:
        return None if v is None else normalize_md_phone(v)

    @model_validator(mode="after")
    def _iban_needs_beneficiary(self) -> "PaymentSettingsIn":
        if self.bank_iban and not self.bank_beneficiary:
            raise ValueError("Beneficiarul e obligatoriu când se completează IBAN-ul.")
        return self

    @property
    def has_iban(self) -> bool:
        return bool(self.bank_beneficiary and self.bank_iban)


class PaymentSettingsOut(BaseModel):
    """Datele bancare globale (singleton)."""

    bank_beneficiary: str
    bank_iban: str
    bank_name: str | None = None
    instructions: str | None = None
    updated_at: datetime
    # Aditiv — MIA Plăți Instant.
    mia_phone: str | None = None
    mia_recipient_name: str | None = None
    mia_qr_url: str | None = None
    # Derivat: True ⇔ `mia_phone` SAU `mia_qr_url` e setat.
    mia_enabled: bool = False
    payment_methods: list[str] = Field(default_factory=list)
