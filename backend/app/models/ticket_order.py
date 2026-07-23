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

REFERINȚA userului (`reference`) e codul lui scurt STABIL, derivat DETERMINIST din
`user.id` (`user_payment_ref`): userul îl pune în comentariul transferului, iar
adminul îl caută în extrasul băncii. E snapshot-uit pe comandă la creare, dar rămâne
identic pentru toate comenzile aceluiași user.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.user import User

# --- Stările unei comenzi de bilet -------------------------------------------
STATUS_AWAITING_PAYMENT = "awaiting_payment"
STATUS_PAYMENT_DECLARED = "payment_declared"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
TICKET_ORDER_STATUSES = (
    STATUS_AWAITING_PAYMENT,
    STATUS_PAYMENT_DECLARED,
    STATUS_APPROVED,
    STATUS_REJECTED,
)

# Moneda implicită a biletului (aliniată cu `Event.ticket_currency`).
DEFAULT_CURRENCY = "lei"

# Cheia fixă a rândului singleton de date bancare.
PAYMENT_SETTINGS_ID = 1


def user_payment_ref(user: User) -> str:
    """Referința de plată STABILĂ a unui user: `U-XXXXXXXX`.

    Derivată determinist din primele 8 caractere hex ale `user.id` (uuid),
    majuscule. NU necesită o coloană nouă — e o funcție pură de id-ul userului,
    deci aceeași valoare la fiecare apel, pentru toate comenzile lui.
    """
    return f"U-{user.id.hex[:8].upper()}"


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
    currency: Mapped[str] = mapped_column(
        String(8), nullable=False, server_default=DEFAULT_CURRENCY, default=DEFAULT_CURRENCY
    )
    # Referința de plată a userului (`U-XXXXXXXX`), snapshot la creare.
    reference: Mapped[str] = mapped_column(String(32), nullable=False)
    # Starea din flux (vezi constantele de mai sus). Indexată: coada de admin
    # filtrează/ordonează pe ea (declared-first).
    status: Mapped[str] = mapped_column(
        String(24),
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
    # created_at / updated_at vin din `Base`.


class PaymentSettings(Base):
    """Datele bancare GLOBALE pentru transfer — rând SINGLETON (id=1).

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
    # created_at / updated_at vin din `Base` (updated_at se rescrie la fiecare PUT).
