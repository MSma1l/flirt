"""Modele de monetizare (TZ 9): Subscription + PurchaseReceipt.

`Subscription` = starea curentă (ce are userul acum). `PurchaseReceipt` = registrul
tranzacțiilor CONSUMATE de la magazin, cu `transaction_id` UNIC — el este bariera
anti-replay: fără el, un singur receipt valid putea fi pasat între conturi și
deschidea premium la oricâți useri.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Subscription(Base):
    """Abonamentul unui user.

    `plan`: 'premium' | 'no_ads' | 'ai_bot' | 'all_inclusive'.
    `status`: 'active' | 'canceled' | 'expired'.
    `provider`: cine a procesat plata ('stub'|'stripe'|'app_store'|'play').
    """

    __tablename__ = "subscriptions"

    # Proprietarul abonamentului; indexat pentru lookup rapid pe user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Pachetul cumpărat (codul planului din PLANS).
    plan: Mapped[str] = mapped_column(String(32), nullable=False)
    # Starea abonamentului; implicit 'active' după cumpărare.
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    # Providerul care a procesat plata (din config la momentul cumpărării).
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Momentul expirării; None = fără expirare cunoscută.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # „Card de reduceri": numărul de intrări (check-in-uri cu reducere) cumpărate și
    # câte au mai rămas. Setate DOAR pentru planurile card ('card_5'|'card_10');
    # NULL pentru celelalte planuri → retrocompatibil, fără sens de „0 intrări".
    entries_total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entries_remaining: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PurchaseReceipt(Base):
    """O tranzacție de magazin deja consumată — bariera anti-replay.

    De ce e nevoie de un tabel separat, nu de o coloană pe `subscriptions`:
    `subscriptions` ține STAREA (un rând per user, suprascris la fiecare reînnoire),
    pe când aici avem nevoie de ISTORIC imuabil, cu unicitate globală pe
    `transaction_id`. Unicitatea trebuie să fie o CONSTRÂNGERE DE BAZĂ DE DATE, nu o
    verificare în Python: două cereri concurente cu același receipt ar trece amândouă
    de un `SELECT ... WHERE transaction_id = ?` și ar activa premium pe două conturi.
    """

    __tablename__ = "purchase_receipts"

    # Cine a consumat tranzacția. Un `transaction_id` aparține unui SINGUR user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Magazinul care a semnat tranzacția ('app_store' | 'play' | 'stripe').
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Id-ul tranzacției, unic GLOBAL. Aici se rupe replay-ul: al doilea cont care
    # trimite același receipt lovește constrângerea UNIQUE, nu o verificare de cod.
    transaction_id: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    # Id-ul tranzacției ORIGINALE (rădăcina lanțului de reînnoiri la Apple/Google).
    # NU poate fi UNIQUE: fiecare reînnoire lunară e o tranzacție nouă cu ACELAȘI
    # original — un UNIQUE aici ar bloca reînnoirile legitime ale aceluiași user.
    # Îl indexăm și verificăm în serviciu că nu-l revendică un ALT user (același
    # abonament Apple, partajat între conturi = tot replay, doar cu alt id).
    original_transaction_id: Mapped[str] = mapped_column(
        String(255), index=True, nullable=False
    )
    # Produsul semnat de magazin — dovada a CE a cumpărat userul (nu ce a cerut).
    product_id: Mapped[str] = mapped_column(String(128), nullable=False)
    # Planul derivat din produs (audit: ce i-am acordat efectiv).
    plan: Mapped[str] = mapped_column(String(32), nullable=False)
    # 'Production' | 'Sandbox' — o tranzacție de sandbox nu are voie în producție.
    environment: Mapped[str] = mapped_column(String(16), nullable=False)
    # Expirarea REALĂ raportată de magazin (nu „acum + 30 de zile").
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
