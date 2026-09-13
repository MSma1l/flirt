"""Scheme Pydantic v2 pentru FIDELITATE (trepte Flirt Passport) și INVITAȚII.

CONTRACT (consumat de aplicația mobilă ȘI de panoul de admin):
  * Public user → LoyaltyStatusOut, TicketQuoteOut, RedeemIn, RedeemOut
  * Admin       → InviteIn, AdminInviteOut, TiersIn, TiersOut

REGULA CARE NU SE NEGOCIAZĂ: clientul NU trimite niciodată un preț și niciun
procent de reducere. `RedeemIn` conține un singur câmp — codul. Prețul final se
calculează exclusiv pe server, din ștampilele REALE ale userului, promo-ul
evenimentului și invitațiile efectiv folosite (vezi `services/loyalty.py`).

Ca peste tot în `schemas/`, ieșirile enumeră EXPLICIT câmpurile expuse, iar
intrările de text trec prin validatorii defensivi (`safe_str` / `optional_safe_str`).
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.core.validators import optional_safe_str, safe_str

# Plafoane aliniate cu coloanele din `models/loyalty.py`.
CODE_MAX_LENGTH = 64
NOTE_MAX_LENGTH = 500
TIER_CODE_MAX_LENGTH = 32
TIER_NAME_MAX_LENGTH = 64
# Plafon defensiv pentru numărul de trepte configurabile: un panou nu are de ce
# să trimită o listă de mii de trepte (ar fi doar un vector de umflat un JSON).
TIERS_MAX = 10
STAMPS_MAX = 10_000


# --- Trepte (configurare) -----------------------------------------------------
class TierOut(BaseModel):
    """O treaptă de fidelitate: de la câte ștampile începe și ce reducere dă."""

    code: str
    name: str
    min_stamps: int
    discount_percent: int


class TierIn(BaseModel):
    """O treaptă trimisă de admin la reconfigurare."""

    code: safe_str(TIER_CODE_MAX_LENGTH)
    name: safe_str(TIER_NAME_MAX_LENGTH)
    min_stamps: int = Field(ge=1, le=STAMPS_MAX)
    discount_percent: int = Field(ge=0, le=100)


class TiersIn(BaseModel):
    """Payload la `PUT /admin/loyalty/tiers` — TOATĂ scara de trepte, dintr-o dată.

    Se trimite întreagă, nu pe bucăți: o scară de fidelitate e coerentă ca
    ansamblu (praguri crescătoare, procente crescătoare), iar editarea „treaptă
    cu treaptă" ar permite stări intermediare absurde (Gold mai ieftin ca Silver).
    Lista GOALĂ e permisă și înseamnă explicit „program de fidelitate oprit".
    """

    tiers: list[TierIn] = Field(max_length=TIERS_MAX)
    max_total_discount_percent: int = Field(ge=0, le=100)


class TiersOut(BaseModel):
    """Configurarea curentă a programului de fidelitate."""

    tiers: list[TierOut]
    max_total_discount_percent: int
    updated_at: datetime


# --- Public: starea mea -------------------------------------------------------
class LoyaltyStatusOut(BaseModel):
    """`GET /loyalty/me` — unde sunt și ce îmi mai trebuie.

    `stamps` numără evenimente DISTINCTE cu check-in confirmat. `next_tier` și
    `stamps_to_next_tier` sunt `None` când userul e deja pe ultima treaptă.
    """

    stamps: int
    tier: TierOut | None = None
    discount_percent: int
    next_tier: TierOut | None = None
    stamps_to_next_tier: int | None = None
    # Scara completă, ca aplicația să poată desena progresul fără un al doilea apel.
    tiers: list[TierOut] = Field(default_factory=list)
    max_total_discount_percent: int


# --- Public: cotația de preț a unui bilet -------------------------------------
class TicketQuoteOut(BaseModel):
    """`GET /loyalty/events/{id}/ticket-quote` — prețul final, calculat pe SERVER.

    Defalcarea e expusă ca să fie EXPLICABILĂ userului („de ce plătesc atât"),
    nu ca să fie negociabilă: toate cele patru componente sunt recalculate la
    fiecare cerere din starea reală din baza de date.
    """

    event_id: uuid.UUID
    base_price: float
    currency: str
    # Componentele, fiecare deja plafonată la 0..100.
    loyalty_percent: int
    promo_percent: int
    invite_percent: int
    # Ce s-a aplicat efectiv, după regula de combinare și după plafon.
    applied_percent: int
    applied_source: str  # 'loyalty' | 'promo' | 'invite' | 'none'
    capped: bool
    discount_amount: float
    final_price: float
    tier: TierOut | None = None


# --- Public: folosirea unei invitații -----------------------------------------
class RedeemIn(BaseModel):
    """Payload la `POST /loyalty/invites/redeem`. UN SINGUR câmp: codul.

    Nu există aici `discount_percent`, `event_id` sau `price` — tot ce ar putea
    influența banii vine din invitația găsită pe server după cod.
    """

    code: safe_str(CODE_MAX_LENGTH)


class RedeemOut(BaseModel):
    """Rezultatul folosirii unei invitații (idempotent pentru același user)."""

    invite_id: uuid.UUID
    event_id: uuid.UUID
    event_title: str
    event_starts_at: datetime
    discount_percent: int
    redeemed_at: datetime
    # `False` când userul folosise deja ACEEAȘI invitație: cererea reușește, dar
    # nu s-a consumat o folosire nouă. Clientul poate afișa „ai deja invitația".
    consumed_new_use: bool


# --- Admin: invitații ---------------------------------------------------------
class InviteIn(BaseModel):
    """Payload la `POST /admin/loyalty/invites`.

    `code` NU e un câmp: codul se generează pe server. Un admin care și-ar alege
    codul ar alege, statistic, un cod ghicibil („VIP2026").
    """

    event_id: uuid.UUID
    max_uses: int = Field(default=1, ge=1)
    expires_at: datetime
    # Treapta minimă cerută (codul unei trepte configurate). NULL = fără cerință.
    min_tier: optional_safe_str(TIER_CODE_MAX_LENGTH) | None = None
    discount_percent: int | None = Field(default=None, ge=0, le=100)
    note: optional_safe_str(NOTE_MAX_LENGTH) | None = None


class AdminInviteOut(BaseModel):
    """O invitație în panoul de admin, cu starea folosirii.

    `code` e expus DOAR aici (rute de admin): adminul trebuie să îl poată
    transmite persoanei invitate și să îl recitească mai târziu.
    """

    id: uuid.UUID
    event_id: uuid.UUID
    event_title: str
    code: str
    max_uses: int
    used_count: int
    uses_left: int
    expires_at: datetime
    min_tier: str | None = None
    min_stamps_required: int | None = None
    discount_percent: int | None = None
    note: str | None = None
    revoked_at: datetime | None = None
    created_at: datetime
    # Starea calculată: 'active' | 'exhausted' | 'expired' | 'revoked'.
    status: str
