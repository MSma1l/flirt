"""Modele pentru CUMPĂRAREA de BILETE ONLINE la evenimente prin TRANSFER BANCAR
cu VERIFICARE MANUALĂ de admin.

Două entități:
  * `TicketOrder`     — o comandă de bilet a unui user la un eveniment cu preț.
  * `PaymentSettings` — datele bancare GLOBALE (singleton id=1, ca `AdSettings`).

FLUXUL, exprimat prin `status`:
  awaiting_payment → userul a cerut biletul, are instrucțiuni de plată;
  payment_declared → userul a declarat „am plătit" (intră prima în coada de admin);
  approved         → adminul a verificat manual transferul → se emite `ticket_code`;
  rejected         → adminul a respins (nu s-a găsit transferul etc.).

REFERINȚA userului (`reference`) e CODUL LUI DE PLATĂ de 6 cifre (`users.payment_code`,
generat leneș de `services/user_codes.py`): userul scrie DOAR acest cod în comentariul
transferului, iar adminul îl caută în extrasul băncii. E snapshot-uit pe comandă la
creare, dar rămâne identic pentru toate comenzile aceluiași user. Comenzile create
înainte de codul simplu își păstrează referința istorică `U-XXXXXXXX`.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# --- Stările unei comenzi de bilet -------------------------------------------
STATUS_AWAITING_PAYMENT = "awaiting_payment"
STATUS_PAYMENT_DECLARED = "payment_declared"
STATUS_PENDING_PAYMENT = "pending_payment"
STATUS_PROOF_SUBMITTED = "payment_proof_submitted"
STATUS_UNDER_REVIEW = "under_review"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_ADDITIONAL_INFORMATION_REQUIRED = "additional_information_required"
STATUS_CANCELLED = "cancelled"
TICKET_ORDER_STATUSES = (
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_APPROVED,
    STATUS_REJECTED,
    STATUS_PENDING_PAYMENT,
    STATUS_PROOF_SUBMITTED,
    STATUS_UNDER_REVIEW,
    STATUS_ADDITIONAL_INFORMATION_REQUIRED,
    STATUS_CANCELLED,
)

# Moneda implicită a biletului (aliniată cu `Event.ticket_currency`).
DEFAULT_CURRENCY = "lei"

# Cheia fixă a rândului singleton de date bancare.
PAYMENT_SETTINGS_ID = 1


class TicketOrder(Base):
    """O comandă de bilet online la un eveniment, plătită prin transfer bancar."""

    __tablename__ = "ticket_orders"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Prețul SNAPSHOT-uit din eveniment la momentul creării comenzii: dacă adminul
    # schimbă ulterior `Event.ticket_price`, comenzile deja emise păstrează prețul
    # cu care au fost create (userul plătește exact ce i s-a comunicat).
    price: Mapped[float] = mapped_column(Float, nullable=False)
    ticket_quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    total_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0, server_default="0")
    full_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    payment_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # URL intern; nu este serializat direct către client. Accesul se face prin
    # endpointul autorizat de proof.
    payment_proof_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Când userul a trimis plata spre verificare (dovadă încărcată / „am plătit").
    payment_declared_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Metoda declarată de user la încărcarea dovezii: `mia` | `iban` | NULL (necunoscută).
    payment_method: Mapped[str | None] = mapped_column(String(8), nullable=True)
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=DEFAULT_CURRENCY, default=DEFAULT_CURRENCY
    )
    # Codul de plată al userului (6 cifre; istoric `U-XXXXXXXX`), snapshot la creare.
    reference: Mapped[str] = mapped_column(String(32), nullable=False)
    # Starea din flux (vezi constantele de mai sus). Indexată: coada de admin
    # filtrează/ordonează pe ea (declared-first).
    status: Mapped[str] = mapped_column(
        # 40: `additional_information_required` are 31 de caractere (24 era prea puțin).
        String(40),
        nullable=False,
        server_default=STATUS_AWAITING_PAYMENT,
        default=STATUS_AWAITING_PAYMENT,
        index=True,
    )
    # Comentariul opțional al userului la „am plătit" (validat/curățat de schemă).
    user_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Nota adminului (motivul respingerii etc.).
    admin_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Codul UNIC de bilet, generat DOAR la aprobare (va deveni QR pe mobil).
    # NULL cât timp comanda nu e aprobată.
    ticket_code: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True
    )
    # Momentul deciziei (aprobare/respingere) + adminul care a decis.
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # --- Intrarea la eveniment (scanarea QR la ușă) ---------------------------
    # Setate ATOMIC de `ticket_scan_service.scan` (UPDATE … WHERE admitted_at IS
    # NULL), deci două scanări simultane nu pot admite de două ori. Stările
    # „used"/„expired" NU se stochează: se calculează din ora evenimentului.
    admitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    admitted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # created_at / updated_at vin din `Base`.


class PaymentSettings(Base):
    """Datele de plată GLOBALE (MIA după telefon și/sau transfer IBAN) — rând SINGLETON (id=1).

    Ca `AdSettings`: nu se creează niciodată mai mult de un rând. Serviciul îl
    citește pe `id == 1` și îl creează leneș cu placeholder-uri goale dacă lipsește,
    ca endpoint-urile să funcționeze chiar înainte de a rula migrarea de seed.
    """

    __tablename__ = "payment_settings"

    # PK fix — singura valoare validă e 1 (singleton). Fără autoincrement.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)

    # Beneficiarul contului (numele titularului).
    bank_beneficiary: Mapped[str] = mapped_column(
        String(200), nullable=False, server_default="", default=""
    )
    # IBAN-ul contului în care se face transferul.
    bank_iban: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default="", default=""
    )
    # Numele băncii (opțional, informativ).
    bank_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Instrucțiuni libere afișate userului (opțional).
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    # --- MIA Plăți Instant (BNM): plata din aplicația băncii după NUMĂR DE TELEFON.
    # Normalizat mereu la `+373XXXXXXXX`; NULL = metoda MIA nu e configurată.
    mia_phone: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Numele pe care plătitorul îl vede confirmat în aplicația băncii (opțional).
    mia_recipient_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Codul QR MIA (imagine re-encodată PNG, fără metadate) — URL public; NULL = fără QR.
    mia_qr_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # created_at / updated_at vin din `Base` (updated_at se rescrie la fiecare PUT).
