"""Modele pentru FIDELITATE (trepte Flirt Passport) și INVITAȚII SPECIALE.

Trei entități, toate NOI (nicio coloană existentă nu e atinsă):

  * `LoyaltySettings`         — pragurile treptelor + plafonul de reducere, rând
                                SINGLETON (id=1), ca `AdSettings` / `PaymentSettings`.
  * `LoyaltyInvite`           — o invitație emisă de admin pentru un eveniment:
                                cod, număr maxim de folosiri, expirare, treaptă minimă.
  * `LoyaltyInviteRedemption` — folosirea unei invitații de către un user (unică
                                per pereche invitație+user).

DE CE PRAGURILE STAU ÎN BAZA DE DATE, NU ÎN COD ȘI NICI DOAR ÎN `.env`
----------------------------------------------------------------------
Un prag de fidelitate e o decizie de MARKETING, nu una de inginerie: „de la 3
vizite dai 5%" se schimbă după prima campanie, apoi înainte de sărbători, apoi
când proprietarul vede marja. Scris în cod, fiecare schimbare cere un commit, un
build și un deploy. Pus doar în `.env`, cere cel puțin un restart de container —
adică tot un om de infrastructură, la ora la care marketingul vrea schimbarea.

Așa că pragurile stau într-un rând din baza de date, editabil din panoul de
admin (`PUT /api/v1/admin/loyalty/tiers`), cu valorile din `Settings`
(`LOYALTY_TIERS`) folosite DOAR ca valori inițiale, la crearea leneșă a rândului.
Rezultatul: o schimbare de prag e un click, nu un deploy; iar o instalare nouă
pornește cu praguri rezonabile, fără niciun pas manual.

ȘTAMPILE: NUMĂRAREA E DEJA SIGURĂ PRIN CONSTRUCȚIE
--------------------------------------------------
`FlirtPassportStamp` are `UniqueConstraint("event_id", "user_id")` — baza de date
REFUZĂ o a doua ștampilă a aceluiași user la același eveniment, iar
`event_service.checkin` e oricum idempotent (re-check-in-ul întoarce ștampila
existentă, fără să insereze). Deci „numără ștampile la evenimente DISTINCTE" =
`COUNT(*)` pe ștampilele userului; nu e nevoie de `COUNT(DISTINCT event_id)` ca
să fie corect. Serviciul folosește totuși `COUNT(DISTINCT event_id)` ca plasă de
siguranță explicită — dacă vreodată constrângerea de unicitate ar fi relaxată,
treapta nu se umflă singură. Vezi `services/loyalty.py`.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Cheia fixă a rândului singleton de setări de fidelitate.
LOYALTY_SETTINGS_ID = 1

# Treapta „fără treaptă" — userul care încă n-a strâns pragul minim.
TIER_NONE_CODE = "none"
TIER_NONE_NAME = "Fără treaptă"

# Acțiunile auditate ale modulului. Stau AICI, nu în `models/admin.py`, ca modulul
# de fidelitate să fie autonom (`AdminAuditLog.action` e un `String(64)` liber,
# nu un enum) — un modul nou nu are de ce să modifice un fișier partajat.
ACTION_LOYALTY_INVITE_CREATE = "loyalty.invite.create"
ACTION_LOYALTY_INVITE_REVOKE = "loyalty.invite.revoke"
ACTION_LOYALTY_TIERS_UPDATE = "loyalty.tiers.update"


class LoyaltySettings(Base):
    """Pragurile treptelor + plafonul de reducere — rând SINGLETON (id=1).

    `tiers` e o listă JSON de obiecte:
        [{"code": "bronze", "name": "Bronze", "min_stamps": 3, "discount_percent": 5}, ...]
    normalizată și validată de serviciu (sortată crescător după `min_stamps`,
    procente în 0..100, coduri unice). JSON și nu o tabelă separată pentru că se
    citește ȘI se scrie mereu ÎNTREAGĂ, ca un singur document de configurare —
    o tabelă ar fi adus tranzacții de tip „șterge tot, reinserează" fără niciun
    câștig de interogare.
    """

    __tablename__ = "loyalty_settings"

    # PK fix — singura valoare validă e 1 (singleton). Fără autoincrement.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    tiers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Plafonul ABSOLUT al reducerii totale aplicate unui bilet (0..100). Ultima
    # plasă de siguranță între o greșeală de configurare și un bilet gratuit.
    max_total_discount_percent: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="30", default=30
    )
    # created_at / updated_at vin din `Base`.


class LoyaltyInvite(Base):
    """O invitație specială la un eveniment, emisă de admin.

    SECURITATE:
      * `code` e generat pe SERVER, din `secrets` (vezi `services/loyalty.py`) —
        clientul nu propune niciodată un cod. UNIC la nivel de tabelă: coliziunea
        e imposibilă, nu doar improbabilă.
      * `used_count` se incrementează DOAR printr-un UPDATE condiționat
        (`used_count < max_uses`), deci două cereri simultane nu pot consuma
        aceeași folosire de două ori.
      * `revoked_at` e o anulare SOFT: o invitație revocată rămâne în istoric cu
        folosirile ei (cine a intrat pe ea rămâne dovedibil), dar nu mai poate fi
        folosită.

    `min_stamps_required` e SNAPSHOT-ul pragului treptei cerute, nu o referință
    la treaptă: pragurile sunt reconfigurabile oricând, iar o invitație emisă cu
    „minim Silver" trebuie să însemne același lucru și după ce Silver e mutat de
    la 6 la 8 ștampile. `min_tier_code` rămâne doar ca etichetă pentru panou.
    """

    __tablename__ = "loyalty_invites"

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Codul de invitație — generat pe server, unic, căutat exact (index unic).
    code: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # Câte folosiri are în total și câte s-au consumat deja.
    max_uses: Mapped[int] = mapped_column(Integer, nullable=False)
    used_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Treapta minimă cerută: pragul în ștampile (sursa de adevăr la verificare) +
    # codul treptei la momentul emiterii (doar etichetă). NULL = fără cerință.
    min_stamps_required: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_tier_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Reducere suplimentară acordată de invitație la biletul acelui eveniment
    # (0..100). NULL = invitația dă doar acces, fără bonus de preț.
    discount_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Notă internă a adminului (pentru cine a fost emisă, ce campanie).
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Anulare SOFT + cine a emis-o (SET NULL: istoricul supraviețuiește ștergerii
    # contului de admin, ca la `AdminAuditLog`).
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # created_at / updated_at vin din `Base`.


class LoyaltyInviteRedemption(Base):
    """Folosirea unei invitații de către un user. UNICĂ per (invitație, user).

    Constrângerea de unicitate face folosirea IDEMPOTENTĂ pentru același user:
    un dublu-tap pe buton nu consumă două folosiri din cele câteva disponibile,
    iar o invitație deja consumată nu poate fi „refolosită" de același cont.
    """

    __tablename__ = "loyalty_invite_redemptions"
    __table_args__ = (
        UniqueConstraint("invite_id", "user_id", name="uq_invite_redemption_pair"),
    )

    invite_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("loyalty_invites.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Evenimentul, denormalizat din invitație: cotația de preț a unui bilet caută
    # „am o invitație folosită la evenimentul X?" fără să mai treacă prin invitații.
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Reducerea SNAPSHOT la momentul folosirii: dacă adminul editează ulterior
    # invitația, userul păstrează ce i s-a promis când a folosit-o.
    discount_percent: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0", default=0
    )
    redeemed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
