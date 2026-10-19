"""TIPURILE DE BILET ale unui eveniment (Early bird / Standard / VIP / La intrare).

Regulile, într-un singur loc, ca adminul (salvarea) și fluxul de cumpărare
(comenzi + cereri) să nu le poată aplica diferit:

* MAXIM `MAX_TICKET_TIERS` tipuri; numele unice; prețul ≥ 0 (validate în schemă).
* Când un eveniment are tipuri, ele sunt SURSA prețului; `Event.ticket_price`
  e ținut sincron ca preț MINIM („de la X lei") — îl citesc clienții vechi,
  listarea și cotația de fidelitate.
* Un eveniment FĂRĂ tipuri dar cu `ticket_price` (rând vechi, creat înainte de
  migrare sau de un client vechi) se comportă ca un singur preț implicit.
* Capacitatea: plafonul TIPULUI (opțional) și capacitatea TOTALĂ a
  evenimentului (opțională) se respectă amândouă. Locurile se ocupă la
  APROBARE, sub lock-ul pe eveniment, apoi pe tip (ordinea: comandă →
  eveniment → tip; salvarea adminului: eveniment → tipuri — fără deadlock).
"""
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import status
from sqlalchemy import func, inspect as sa_inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import CodedHTTPException, ErrorCode
from app.models.event import DEFAULT_TICKET_TIER_NAME, Event, EventTicketTier
from app.models.ticket_order import STATUS_CANCELLED, STATUS_REJECTED, TicketOrder

if TYPE_CHECKING:  # evită importul circular schemă ↔ serviciu
    from app.schemas.admin import AdminTicketTierIn


async def ensure_loaded(db: AsyncSession, *events: Event) -> None:
    """Garantează că `event.ticket_tiers` e încărcat înainte de un acces sincron.

    Relația e `selectin` (vine odată cu orice SELECT pe evenimente), dar un
    `db.get` care găsește evenimentul deja în identity map (ex. creat mai devreme
    în aceeași sesiune) nu mai interoghează nimic — iar un lazy-load sincron în
    contextul async ar arunca `MissingGreenlet`. Zero query-uri când e încărcat.
    """
    for event in events:
        state = sa_inspect(event)
        if state.persistent and "ticket_tiers" in state.unloaded:
            await db.refresh(event, attribute_names=["ticket_tiers"])


# --------------------------------------------------------------------------- #
# Cumpărare
# --------------------------------------------------------------------------- #
def resolve_for_purchase(
    event: Event, tier_id: uuid.UUID | None, *, required: bool = True
) -> EventTicketTier | None:
    """Tipul ales pentru o comandă/cerere.

    * eveniment fără tipuri → None (preț unic); un `tier_id` trimis → 422;
    * un singur tip → acela, chiar dacă clientul nu a trimis nimic (fluxul
      vechi, fără pas de alegere);
    * mai multe tipuri fără alegere → 422 `ticket_tier_required` (sau None cu
      `required=False`, ca apelantul să poată întoarce întâi o comandă existentă);
    * un id care nu e al acestui eveniment → 422 `ticket_tier_invalid`.
    """
    tiers = event.ticket_tiers
    if not tiers:
        if tier_id is not None:
            raise _invalid_tier()
        return None
    if tier_id is None:
        if len(tiers) == 1:
            return tiers[0]
        if not required:
            return None
        raise tier_required()
    for tier in tiers:
        if tier.id == tier_id:
            return tier
    raise _invalid_tier()


def tier_required() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Alegeți tipul de bilet.",
        code=ErrorCode.TICKET_TIER_REQUIRED,
    )


def _invalid_tier() -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="Tipul de bilet ales nu există pentru acest eveniment.",
        code=ErrorCode.TICKET_TIER_INVALID,
    )


def unit_price(event: Event, tier: EventTicketTier | None) -> float:
    """Prețul de bază al unui bilet (înainte de reduceri)."""
    if tier is not None:
        return float(tier.price)
    return float(event.ticket_price or 0.0)


def is_tier_sold_out(event: Event, tier: EventTicketTier, quantity: int = 1) -> bool:
    """Epuizat = plafonul tipului SAU capacitatea totală a evenimentului."""
    return tier.is_sold_out(quantity) or event.full_capacity_reached(quantity)


def ensure_tier_available(tier: EventTicketTier | None, quantity: int = 1) -> None:
    """Verificarea „soft" la crearea unei comenzi/cereri NOI (fără lock) — ca
    `_ensure_not_sold_out` pentru eveniment. Garanția reală e la aprobare."""
    if tier is not None and tier.is_sold_out(quantity):
        raise _tier_sold_out(tier)


def _tier_sold_out(tier: EventTicketTier) -> CodedHTTPException:
    return CodedHTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Biletele „{tier.name}” s-au epuizat.",
        code=ErrorCode.TICKETS_SOLD_OUT,
    )


async def lock_tier(db: AsyncSession, tier_id: uuid.UUID | None) -> EventTicketTier | None:
    """Rândul tipului BLOCAT și recitit (ca `_lock_event`). None dacă tipul a
    fost șters între timp (comanda își păstrează snapshot-ul numelui)."""
    if tier_id is None:
        return None
    return await db.scalar(
        select(EventTicketTier)
        .where(EventTicketTier.id == tier_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def check_reserve(tier: EventTicketTier, quantity: int) -> None:
    """409 `tickets_sold_out` dacă `quantity` locuri ar depăși plafonul tipului."""
    if tier.is_sold_out(quantity):
        raise _tier_sold_out(tier)


def reserve(tier: EventTicketTier, quantity: int) -> None:
    """Ocupă locuri din plafonul tipului; 409 `tickets_sold_out` peste plafon."""
    check_reserve(tier, quantity)
    tier.sold = (tier.sold or 0) + quantity


def release(tier: EventTicketTier, quantity: int) -> None:
    """Eliberează locurile unui bilet anulat (plafonat la 0)."""
    tier.sold = max(0, (tier.sold or 0) - quantity)


# --------------------------------------------------------------------------- #
# Salvarea din panoul de admin
# --------------------------------------------------------------------------- #
def legacy_price_items(
    event: Event, price: float | None
) -> list[dict] | None:
    """Traduce un payload VECHI (doar `ticket_price`) în lista de tipuri.

    * preț None → fără tipuri (vânzarea online oprită);
    * 0 sau 1 tip → un singur tip cu prețul nou (numele/plafonul se păstrează);
    * mai multe tipuri → None: prețul unic nu are sens, apelantul refuză (422).
    """
    if price is None:
        return []
    tiers = event.ticket_tiers
    if not tiers:
        return [{"id": None, "name": DEFAULT_TICKET_TIER_NAME, "price": price,
                 "capacity": None, "description": None}]
    if len(tiers) == 1:
        t = tiers[0]
        return [{"id": t.id, "name": t.name, "price": price,
                 "capacity": t.capacity, "description": t.description}]
    return None


async def sync_tiers(
    db: AsyncSession, event: Event, items: list[AdminTicketTierIn] | list[dict]
) -> None:
    """Înlocuiește tipurile evenimentului cu lista primită (în ordinea ei).

    Tipurile cu `id` se ACTUALIZEAZĂ (își păstrează `sold` și comenzile), cele
    fără `id` se creează, cele care lipsesc se șterg — dar NU dacă au comenzi
    active (409 `ticket_tier_in_use`). Plafonul unui tip nu poate coborî sub
    biletele deja vândute din el (409 `capacity_below_sold`). La final
    `ticket_price` = prețul minim (sau None fără tipuri).

    Apelantul ține lock-ul pe eveniment; aici blocăm și recitim tipurile, ca
    `sold` să fie cel real (o aprobare simultană ține aceleași lock-uri).
    """
    rows = [_as_dict(i) for i in items]
    existing: dict[uuid.UUID, EventTicketTier] = {}
    if event.id is not None:
        locked = (
            await db.execute(
                select(EventTicketTier)
                .where(EventTicketTier.event_id == event.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
        existing = {t.id: t for t in locked}

    kept = {r["id"] for r in rows if r["id"] is not None}
    if kept - existing.keys():
        raise _invalid_tier()

    removed = [t for tid, t in existing.items() if tid not in kept]
    if removed:
        in_use = await db.scalar(
            select(func.count())
            .select_from(TicketOrder)
            .where(
                TicketOrder.ticket_tier_id.in_([t.id for t in removed]),
                TicketOrder.status.not_in((STATUS_REJECTED, STATUS_CANCELLED)),
            )
        )
        if in_use:
            raise CodedHTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Un tip de bilet cu comenzi active nu poate fi șters "
                    "(respingeți sau anulați întâi comenzile lui)."
                ),
                code=ErrorCode.TICKET_TIER_IN_USE,
            )

    ordered: list[EventTicketTier] = []
    for position, row in enumerate(rows):
        tier = existing.get(row["id"]) if row["id"] is not None else None
        if tier is None:
            tier = EventTicketTier(name=row["name"], price=row["price"], sold=0)
        elif row["capacity"] is not None and row["capacity"] < (tier.sold or 0):
            raise CodedHTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Capacitatea tipului „{tier.name}” nu poate fi mai mică "
                    f"decât biletele deja vândute ({tier.sold})."
                ),
                code=ErrorCode.CAPACITY_BELOW_SOLD,
            )
        tier.name = row["name"]
        tier.price = float(row["price"])
        tier.capacity = row["capacity"]
        tier.description = row["description"]
        tier.position = position
        ordered.append(tier)

    # Atribuirea listei: `delete-orphan` șterge tipurile scoase.
    event.ticket_tiers = ordered
    event.ticket_price = min((t.price for t in ordered), default=None)


def _as_dict(item) -> dict:
    if isinstance(item, dict):
        return item
    return {
        "id": item.id,
        "name": item.name,
        "price": item.price,
        "capacity": item.capacity,
        "description": item.description,
    }
