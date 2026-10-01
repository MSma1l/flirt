"""Starea de CICLU DE VIAȚĂ a unui bilet, expusă clienților (`status`).

Funcții PURE (fără DB): primesc modelele deja încărcate + `now` și întorc una
dintre stări. NIMIC din ce depinde de timp nu se stochează — „used"/„expired"
se calculează la fiecare citire din ora evenimentului, deci nu e nevoie de cron.

  valid      plătit/aprobat, încă nescanat la intrare;
  admitted   scanat la ușă (`admitted_at`), evenimentul încă în desfășurare;
  used       evenimentul s-a terminat DUPĂ ce biletul a fost admis;
  expired    evenimentul s-a terminat și biletul NU a fost scanat niciodată;
  cancelled  comanda a fost respinsă/anulată.

SFÂRȘITUL EVENIMENTULUI: modelul `Event` nu are `ends_at`, deci folosim
`starts_at + EVENT_DURATION` (12h — acoperă o petrecere de noapte). Dacă în
viitor apare o coloană `ends_at`, ea are prioritate automat (`getattr`).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models.account import Ticket
from app.models.event import Event, as_utc
from app.models.ticket_order import (
    STATUS_APPROVED,
    STATUS_CANCELLED,
    STATUS_REJECTED,
    TicketOrder,
)

TICKET_VALID = "valid"
TICKET_ADMITTED = "admitted"
TICKET_USED = "used"
TICKET_EXPIRED = "expired"
TICKET_CANCELLED = "cancelled"
TICKET_STATUSES = (
    TICKET_VALID,
    TICKET_ADMITTED,
    TICKET_USED,
    TICKET_EXPIRED,
    TICKET_CANCELLED,
)

# Durata presupusă a unui eveniment fără oră de final explicită.
EVENT_DURATION = timedelta(hours=12)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def event_ends_at(event: Event) -> datetime:
    """Momentul (UTC) după care evenimentul e considerat încheiat."""
    ends_at = getattr(event, "ends_at", None)
    if ends_at is not None:
        return as_utc(ends_at)
    return as_utc(event.starts_at) + EVENT_DURATION


def event_is_over(event: Event, now: datetime | None = None) -> bool:
    return (now or _now()) >= event_ends_at(event)


def order_ticket_status(
    order: TicketOrder, event: Event, now: datetime | None = None
) -> str | None:
    """Starea biletului unei comenzi; None cât timp plata nu e decisă."""
    if order.status in (STATUS_REJECTED, STATUS_CANCELLED):
        return TICKET_CANCELLED
    if order.status != STATUS_APPROVED:
        return None
    over = event_is_over(event, now)
    if order.admitted_at is not None:
        return TICKET_USED if over else TICKET_ADMITTED
    return TICKET_EXPIRED if over else TICKET_VALID


def party_ticket_status(
    ticket: Ticket, admitted_event: Event | None, now: datetime | None = None
) -> str:
    """Starea biletului Flirt Party (nelegat de eveniment până la scanare).

    Nu expiră niciodată cât timp nu e folosit (nu are eveniment propriu).
    """
    if ticket.admitted_at is not None:
        if admitted_event is None or event_is_over(admitted_event, now):
            # Evenimentul șters ulterior → biletul rămâne consumat.
            return TICKET_USED
        return TICKET_ADMITTED
    if ticket.used:
        # Marcaj istoric „folosit" fără scanare (date vechi).
        return TICKET_USED
    return TICKET_VALID
