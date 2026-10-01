"""Modele pentru Evenimente + Flirt Passport (TZ secț. 8).

Patru entități: evenimentul propriu-zis, prezența declarată a userului
(„Iiду на мероприятие"), ștampila Flirt Passport primită după check-in și
intrarea plătită CASH la ușă (fără bilet online).
Toate moștenesc `Base` (PK uuid + timestamps).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Event(Base):
    """Un eveniment/Live Event afișat pe hartă și în lista de evenimente."""

    __tablename__ = "events"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Momentul de start (cu timezone) — folosit pentru filtrarea „viitor".
    # Indexat: `WHERE starts_at >= now() ORDER BY starts_at` e query-ul listării
    # (și cheia de paginare); fără index, orice listare sortează întreaga tabelă.
    starts_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    venue: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # Coordonate opționale pentru harta Live Events (TZ 8.3).
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Tipul evenimentului: 'flirt_party' | 'concert' | 'other'.
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    cover_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Promo/reducere de marketing setată de admin — ACELAȘI pentru toți userii care
    # merg la eveniment (nu se generează coduri per user). Toate opționale =
    # retrocompatibil: un eveniment fără promo rămâne valid.
    #   * procentul reducerii (0..100) afișat în Flirt Passport / detaliul evenimentului;
    #   * codul scurt arătat la intrare (ex. „FLIRT10");
    #   * descrierea a ce se întâmplă când arăți codul la intrare.
    promo_discount_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    promo_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    promo_description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Preț al BILETULUI ONLINE (transfer bancar + verificare manuală de admin).
    # NULL = biletul online NU e disponibil pentru acest eveniment (retrocompatibil:
    # evenimentele existente rămân fără vânzare de bilete). `ticket_currency` are
    # sens doar când `ticket_price` e setat.
    ticket_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    ticket_currency: Mapped[str | None] = mapped_column(
        String(8), nullable=True, server_default="lei"
    )
    # Capacitatea pentru vânzarea de bilete. NULL înseamnă nelimitat; la aprobare
    # se incrementează `tickets_sold`, în aceeași tranzacție cu comanda.
    ticket_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tickets_sold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Ora la care se ÎNCHIDE vânzarea online (cererea proprietarului: fără haos la
    # intrare). NULL = se închide la `starts_at` — comportamentul de dinainte, deci
    # evenimentele existente nu se schimbă. Regula de validare (cel mult
    # `starts_at + TICKET_SALES_END_MAX_AFTER_START`) e în `admin_service`.
    ticket_sales_end_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    @property
    def effective_ticket_sales_end(self) -> datetime:
        """Momentul EFECTIV de închidere a vânzării online (UTC, tz-aware)."""
        return as_utc(self.ticket_sales_end_at or self.starts_at)

    def ticket_sales_open(self, now: datetime | None = None) -> bool:
        """True doar dacă evenimentul vinde bilete online ACUM: are preț, nu s-a
        atins ora de închidere și (dacă există capacitate) nu e sold-out."""
        if self.ticket_price is None:
            return False
        now = now or datetime.now(timezone.utc)
        if now >= self.effective_ticket_sales_end:
            return False
        if (
            self.ticket_capacity is not None
            and (self.tickets_sold or 0) >= self.ticket_capacity
        ):
            return False
        return True


# Cât de târziu după START poate fi pusă închiderea vânzării (ex. un concert la
# care se mai vând bilete în primele ore). Peste asta e aproape sigur o greșeală
# de introducere (zi/lună inversate), deci API-ul o refuză cu 422.
TICKET_SALES_END_MAX_AFTER_START = timedelta(hours=12)


def as_utc(value: datetime) -> datetime:
    """Naive → UTC (SQLite întoarce naive), ca să comparăm mereu tz-aware."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class EventAttendance(Base):
    """Marcajul „merg la eveniment" al unui user (TZ 8.2). Unic per (event, user)."""

    __tablename__ = "event_attendances"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_attendance_pair"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    going: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FlirtPassportStamp(Base):
    """Ștampilă Flirt Passport după vizită confirmată (TZ 8.4). Unică per pereche."""

    __tablename__ = "flirt_passport_stamps"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_stamp_pair"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Momentul emiterii ștampilei (check-in confirmat).
    stamped_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


# Metodele de plată ale unei intrări la ușă. Azi doar cash; câmpul e text ca o
# metodă nouă (ex. card la ușă) să nu ceară migrare de schemă.
DOOR_PAYMENT_CASH = "cash"


class EventDoorAdmission(Base):
    """Intrare la eveniment plătită la UȘĂ (fără bilet online).

    Staff-ul scanează QR-ul Flirt Passport al omului și apasă „Achitat cash":
    rândul ține evidența intrării (contorul de la ușă) și e unic per pereche
    (event, user) — a doua apăsare întoarce `already_admitted`.
    """

    __tablename__ = "event_door_admissions"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_door_admission_pair"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("events.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    payment_method: Mapped[str] = mapped_column(
        String(16), nullable=False, default=DOOR_PAYMENT_CASH,
        server_default=DOOR_PAYMENT_CASH,
    )
    admitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Staff-ul care a încasat; SET NULL dacă contul lui dispare (rândul rămâne).
    admitted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
