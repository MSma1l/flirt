"""Logica programului de FIDELITATE (trepte Flirt Passport) și a INVITAȚIILOR.

Concentrat aici (nu în rute) după convenția proiectului: rutele rămân subțiri,
serviciul deține accesul la DB, commit-urile și regulile de business.

────────────────────────────────────────────────────────────────────────────────
1. CÂT VALOREAZĂ O ȘTAMPILĂ
────────────────────────────────────────────────────────────────────────────────
Treapta unui user e dată de numărul de EVENIMENTE DISTINCTE la care are ștampilă
confirmată. Numărăm cu `COUNT(DISTINCT event_id)`, deși `FlirtPassportStamp` are
deja `UniqueConstraint(event_id, user_id)` și `event_service.checkin` e idempotent:
dublura e imposibilă azi, iar `DISTINCT` o ține imposibilă și mâine, dacă cineva
relaxează constrângerea ca să permită re-check-in. Costul e zero (același index),
câștigul e că treapta nu se poate umfla niciodată din două rânduri.

Pragurile NU sunt în cod. Stau într-un rând singleton (`loyalty_settings`),
editabil din panoul de admin — motivarea completă e în `models/loyalty.py`.

────────────────────────────────────────────────────────────────────────────────
2. REGULA DE COMBINARE A REDUCERILOR  (decizia cerută explicit)
────────────────────────────────────────────────────────────────────────────────
Un user poate avea SIMULTAN trei surse de reducere la același bilet:
    (a) treapta de fidelitate,
    (b) promo-ul evenimentului (`Event.promo_discount_percent`),
    (c) o invitație specială folosită pentru acel eveniment.

REGULA ALEASĂ: **se aplică CEA MAI MARE, nu se cumulează**, iar rezultatul e
plafonat la `max_total_discount_percent`:

    procent_final = min(plafon, max(fidelitate, promo, invitație))
    preț_final    = max(0, rotunjit(preț * (1 − procent_final / 100)))

DE CE NU CUMULATIV (nici prin adunare, nici „în ordine", multiplicativ):
  * Adunarea e nemărginită prin construcție. Fiecare sursă e configurată de altă
    persoană, în alt moment, fără să o vadă pe cealaltă: marketingul pune promo
    40% de sărbători, programul de fidelitate dă 15%, o invitație VIP mai dă 20%
    — nimeni nu a decis vreodată 75%, dar asta iese. Plafonul ar salva prețul,
    dar ar face reducerea IMPREVIZIBILĂ: doi useri cu drepturi diferite ajung
    amândoi la plafon și primesc același preț, ceea ce anulează tocmai
    diferențierea pentru care există treptele.
  * Aplicarea „în ordine" (multiplicativă) nu duce prețul sub zero, dar dă
    numere pe care nimeni nu le poate explica la telefon („0,85 × 0,90 × 0,80 =
    38,8% reducere") și depinde de ORDINEA aplicării, adică de o convenție
    nescrisă din cod.
  * „Cea mai mare câștigă" e ușor de comunicat („primești cea mai bună reducere
    la care ai dreptul"), nu poate fi exploatată prin acumulare de avantaje mici
    și păstrează sensul treptelor: fidelitatea contează exact atunci când e mai
    bună decât promo-ul de masă.

Plafonul rămâne totuși activ, ca a DOUA apărare, nu ca regulă principală: el
prinde greșeala de configurare (un promo tastat „90" în loc de „9"), nu
combinarea. Iar prețul e tăiat explicit la 0 — un procent > 100 dintr-o coloană
coruptă nu poate produce un preț negativ (adică o datorie a firmei către user).

TOT CE ȚINE DE BANI SE CALCULEAZĂ AICI, PE SERVER. Clientul trimite cel mult un
cod de invitație; niciun preț și niciun procent primit de la client nu e folosit.

────────────────────────────────────────────────────────────────────────────────
3. FOLOSIREA UNEI INVITAȚII E ATOMICĂ
────────────────────────────────────────────────────────────────────────────────
Incrementul contorului NU se face „citește, adună 1, scrie" — între citire și
scriere încap oricâte alte cereri. Se face printr-un UPDATE CONDIȚIONAT, într-o
singură instrucțiune SQL:

    UPDATE loyalty_invites SET used_count = used_count + 1
     WHERE id = :id AND used_count < max_uses AND revoked_at IS NULL
       AND expires_at > :now

Baza de date blochează rândul pe durata actualizării; a doua cerere concurentă
așteaptă, apoi RE-evaluează condiția pe versiunea deja incrementată și nu mai
potrivește niciun rând (`rowcount == 0`) → 409. Deci ultima folosire disponibilă
nu poate fi consumată de două ori, oricâte cereri sosesc simultan
(`test_loyalty.py::test_concurrent_redeem_of_last_use_...`).

Inserarea rândului de folosire vine DUPĂ increment, în ACEEAȘI tranzacție, și e
protejată de `uq_invite_redemption_pair`: dacă același user trimite codul de două
ori simultan, una dintre inserări cade cu `IntegrityError`, tranzacția ei se
anulează ÎMPREUNĂ cu incrementul (deci nu se pierde o folosire), iar răspunsul
devine idempotent — folosirea existentă, fără consum nou.
"""
from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.event import Event, FlirtPassportStamp
from app.models.loyalty import (
    ACTION_LOYALTY_INVITE_CREATE,
    ACTION_LOYALTY_INVITE_REVOKE,
    ACTION_LOYALTY_TIERS_UPDATE,
    LOYALTY_SETTINGS_ID,
    LoyaltyInvite,
    LoyaltyInviteRedemption,
    LoyaltySettings,
)
from app.models.user import User
from app.schemas.loyalty import (
    AdminInviteOut,
    InviteIn,
    LoyaltyStatusOut,
    RedeemOut,
    TicketQuoteOut,
    TierOut,
    TiersIn,
    TiersOut,
)
from app.services.admin_service import audit
from app.services.pagination import (
    ADMIN_MAX_LIMIT,
    ADMIN_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)

# Alfabetul codurilor de invitație: 32 de simboluri, FĂRĂ caracterele ambigue
# (0/O, 1/I/L) — un cod se dictează la telefon și se tastează cu degetul mare pe
# un telefon, iar un „O" citit ca „0" e un cod invalid pentru un invitat real.
# 32 de simboluri = exact 5 biți de entropie pe caracter (vezi config).
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ023456789"
# Câte coduri încercăm înainte să renunțăm, în cazul (astronomic de improbabil)
# al unei coliziuni cu un cod existent.
_CODE_MAX_ATTEMPTS = 5

# Stările calculate ale unei invitații (ordinea contează: revocarea bate totul).
INVITE_ACTIVE = "active"
INVITE_REVOKED = "revoked"
INVITE_EXPIRED = "expired"
INVITE_EXHAUSTED = "exhausted"

# Sursele posibile ale reducerii aplicate.
SOURCE_NONE = "none"
SOURCE_LOYALTY = "loyalty"
SOURCE_PROMO = "promo"
SOURCE_INVITE = "invite"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    """Normalizează un datetime la UTC (naive → atașează UTC), ca în ticket_order_service."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# --------------------------------------------------------------------------- #
# Trepte: seminția din config → rândul singleton din DB
# --------------------------------------------------------------------------- #
def _parse_tiers_seed(raw: str) -> list[dict]:
    """Parsează `LOYALTY_TIERS` (`cod:nume:ștampile:procent,...`) → listă de trepte.

    Defensiv: o intrare stricată e IGNORATĂ, nu aruncă. Configurarea de pornire nu
    are voie să împiedice aplicația să pornească — cel mult programul pornește cu
    mai puține trepte, vizibil imediat în panou și corectabil de acolo.
    """
    out: list[dict] = []
    for chunk in (raw or "").split(","):
        parts = [p.strip() for p in chunk.split(":")]
        if len(parts) != 4 or not parts[0]:
            continue
        try:
            min_stamps = int(parts[2])
            percent = int(parts[3])
        except ValueError:
            continue
        out.append(
            {
                "code": parts[0],
                "name": parts[1] or parts[0],
                "min_stamps": min_stamps,
                "discount_percent": percent,
            }
        )
    return _normalize_tiers(out)


def _normalize_tiers(tiers: list[dict]) -> list[dict]:
    """Curăță scara de trepte: praguri ≥ 1, procente în 0..100, coduri unice, sortate.

    Sortarea crescătoare după `min_stamps` e ce face restul codului simplu:
    „treapta mea" = ultima treaptă al cărei prag e atins, „următoarea" = prima
    care nu e. Fără normalizare aici, ordinea ar depinde de cum a completat
    adminul formularul.
    """
    seen: set[str] = set()
    clean: list[dict] = []
    for tier in tiers:
        code = str(tier.get("code", "")).strip()
        if not code or code in seen:
            continue
        seen.add(code)
        min_stamps = max(1, int(tier.get("min_stamps", 1)))
        percent = min(100, max(0, int(tier.get("discount_percent", 0))))
        clean.append(
            {
                "code": code,
                "name": str(tier.get("name") or code).strip(),
                "min_stamps": min_stamps,
                "discount_percent": percent,
            }
        )
    clean.sort(key=lambda t: (t["min_stamps"], t["code"]))
    return clean


async def _get_or_create_settings(db: AsyncSession) -> LoyaltySettings:
    """Rândul singleton `id=1`, creat leneș din valorile de pornire din `Settings`."""
    row = await db.get(LoyaltySettings, LOYALTY_SETTINGS_ID)
    if row is not None:
        return row
    row = LoyaltySettings(
        id=LOYALTY_SETTINGS_ID,
        tiers=_parse_tiers_seed(settings.loyalty_tiers),
        max_total_discount_percent=min(
            100, max(0, settings.loyalty_max_total_discount_percent)
        ),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


def _to_tier_out(tier: dict) -> TierOut:
    return TierOut(
        code=tier["code"],
        name=tier["name"],
        min_stamps=tier["min_stamps"],
        discount_percent=tier["discount_percent"],
    )


def _to_tiers_out(row: LoyaltySettings) -> TiersOut:
    return TiersOut(
        tiers=[_to_tier_out(t) for t in _normalize_tiers(list(row.tiers or []))],
        max_total_discount_percent=row.max_total_discount_percent,
        updated_at=row.updated_at,
    )


async def get_tiers(db: AsyncSession) -> TiersOut:
    """Configurarea curentă a programului de fidelitate."""
    return _to_tiers_out(await _get_or_create_settings(db))


async def update_tiers(
    db: AsyncSession, data: TiersIn, actor: User, ip: str | None = None
) -> TiersOut:
    """Rescrie scara de trepte + plafonul (auditat: `loyalty.tiers.update`).

    Auditat pentru că e o decizie cu efect direct asupra banilor încasați: cine a
    dus reducerea maximă de la 15% la 60% și când trebuie să rămână dovedibil.
    """
    row = await _get_or_create_settings(db)
    row.tiers = _normalize_tiers([t.model_dump() for t in data.tiers])
    row.max_total_discount_percent = data.max_total_discount_percent
    audit(
        db,
        actor,
        ACTION_LOYALTY_TIERS_UPDATE,
        target_type="loyalty_settings",
        meta={
            "tiers": row.tiers,
            "max_total_discount_percent": row.max_total_discount_percent,
        },
        ip=ip,
    )
    await db.commit()
    await db.refresh(row)
    return _to_tiers_out(row)


# --------------------------------------------------------------------------- #
# Ștampile → treaptă
# --------------------------------------------------------------------------- #
async def count_stamps(db: AsyncSession, user: User) -> int:
    """Câte EVENIMENTE DISTINCTE are userul ștampilate (vezi antetul modulului)."""
    return (
        await db.scalar(
            select(func.count(func.distinct(FlirtPassportStamp.event_id))).where(
                FlirtPassportStamp.user_id == user.id
            )
        )
    ) or 0


def resolve_tier(tiers: list[dict], stamps: int) -> tuple[dict | None, dict | None]:
    """(treapta curentă, treapta următoare) pentru un număr de ștampile.

    Treapta curentă = ultima al cărei prag e ATINS; următoarea = prima neatinsă.
    Pe lista normalizată (sortată), amândouă ies dintr-o singură parcurgere.
    """
    current: dict | None = None
    nxt: dict | None = None
    for tier in tiers:
        if stamps >= tier["min_stamps"]:
            current = tier
        elif nxt is None:
            nxt = tier
    return current, nxt


async def get_status(db: AsyncSession, user: User) -> LoyaltyStatusOut:
    """`GET /loyalty/me` — treaptă, reducere, cât mai am până la următoarea."""
    row = await _get_or_create_settings(db)
    tiers = _normalize_tiers(list(row.tiers or []))
    stamps = await count_stamps(db, user)
    current, nxt = resolve_tier(tiers, stamps)
    return LoyaltyStatusOut(
        stamps=stamps,
        tier=_to_tier_out(current) if current else None,
        discount_percent=current["discount_percent"] if current else 0,
        next_tier=_to_tier_out(nxt) if nxt else None,
        stamps_to_next_tier=(nxt["min_stamps"] - stamps) if nxt else None,
        tiers=[_to_tier_out(t) for t in tiers],
        max_total_discount_percent=row.max_total_discount_percent,
    )


# --------------------------------------------------------------------------- #
# Regula de combinare a reducerilor (vezi secțiunea 2 din antet)
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class PriceBreakdown:
    """Defalcarea prețului, calculată integral pe server."""

    base_price: float
    loyalty_percent: int
    promo_percent: int
    invite_percent: int
    applied_percent: int
    applied_source: str
    capped: bool
    discount_amount: float
    final_price: float


def _clamp_percent(value: int | None) -> int:
    """Orice procent, de oriunde ar veni, ajunge în 0..100 înainte să atingă banii."""
    if value is None:
        return 0
    return min(100, max(0, int(value)))


def combine_discounts(
    base_price: float,
    *,
    loyalty_percent: int | None,
    promo_percent: int | None,
    invite_percent: int | None,
    cap_percent: int,
) -> PriceBreakdown:
    """CEA MAI MARE reducere câștigă, plafonată, cu prețul tăiat la 0.

    Funcție PURĂ (fără DB): tocmai regula care mișcă banii trebuie să fie
    testabilă direct, pe cazuri limită, fără să construiești un user și un
    eveniment pentru fiecare.

    Ordinea de departajare la egalitate: fidelitate > invitație > promo. E
    arbitrară ca preț (procentul e același), dar nu ca mesaj: userului i se spune
    că a primit reducerea pentru care a făcut un efort, nu una de masă.
    """
    loyalty = _clamp_percent(loyalty_percent)
    promo = _clamp_percent(promo_percent)
    invite = _clamp_percent(invite_percent)
    cap = _clamp_percent(cap_percent)

    best = max(loyalty, promo, invite)
    if best <= 0:
        source = SOURCE_NONE
    elif best == loyalty:
        source = SOURCE_LOYALTY
    elif best == invite:
        source = SOURCE_INVITE
    else:
        source = SOURCE_PROMO

    applied = min(best, cap)
    # Prețul de bază negativ (coloană coruptă / date de test absurde) e tratat ca 0:
    # nu emitem niciodată o sumă negativă de încasat.
    base = max(0.0, float(base_price or 0.0))
    final = round(base * (1 - applied / 100), 2)
    final = max(0.0, final)
    return PriceBreakdown(
        base_price=base,
        loyalty_percent=loyalty,
        promo_percent=promo,
        invite_percent=invite,
        applied_percent=applied,
        applied_source=source if applied > 0 else SOURCE_NONE,
        capped=best > cap,
        discount_amount=round(base - final, 2),
        final_price=final,
    )


async def _best_invite_percent(
    db: AsyncSession, user: User, event_id: uuid.UUID
) -> int:
    """Cea mai bună reducere dintre invitațiile PE CARE USERUL LE-A FOLOSIT deja
    pentru acest eveniment.

    Sursa e rândul de folosire (`LoyaltyInviteRedemption`), cu procentul
    SNAPSHOT-uit: userul nu poate invoca o invitație pe care n-a folosit-o, iar o
    editare ulterioară a invitației nu îi schimbă retroactiv prețul.
    """
    return (
        await db.scalar(
            select(func.max(LoyaltyInviteRedemption.discount_percent)).where(
                LoyaltyInviteRedemption.user_id == user.id,
                LoyaltyInviteRedemption.event_id == event_id,
            )
        )
    ) or 0


async def price_breakdown(
    db: AsyncSession, user: User, event: Event
) -> PriceBreakdown:
    """Defalcarea prețului unui bilet pentru un user și un eveniment.

    SINGURA cale prin care se calculează prețul unui bilet. Apelabilă și din
    fluxul de comandă (`ticket_order_service.create_order`), ca prețul afișat în
    cotație și prețul înscris pe comandă să nu poată diverge — două formule
    înseamnă, mai devreme sau mai târziu, două prețuri.
    """
    row = await _get_or_create_settings(db)
    tiers = _normalize_tiers(list(row.tiers or []))
    stamps = await count_stamps(db, user)
    current, _ = resolve_tier(tiers, stamps)
    return combine_discounts(
        event.ticket_price or 0.0,
        loyalty_percent=current["discount_percent"] if current else 0,
        promo_percent=event.promo_discount_percent,
        invite_percent=await _best_invite_percent(db, user, event.id),
        cap_percent=row.max_total_discount_percent,
    )


async def _get_event_or_404(db: AsyncSession, event_id: uuid.UUID) -> Event:
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )
    return event


async def ticket_quote(
    db: AsyncSession, user: User, event_id: uuid.UUID
) -> TicketQuoteOut:
    """`GET /loyalty/events/{id}/ticket-quote` — cât plătesc EU pe biletul ăsta.

    400 dacă evenimentul nu are preț (biletul online indisponibil) — aceeași
    semantică precum `ticket_order_service.create_order`.
    """
    event = await _get_event_or_404(db, event_id)
    if event.ticket_price is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Biletul online nu este disponibil pentru acest eveniment.",
        )

    row = await _get_or_create_settings(db)
    tiers = _normalize_tiers(list(row.tiers or []))
    stamps = await count_stamps(db, user)
    current, _ = resolve_tier(tiers, stamps)
    breakdown = combine_discounts(
        event.ticket_price,
        loyalty_percent=current["discount_percent"] if current else 0,
        promo_percent=event.promo_discount_percent,
        invite_percent=await _best_invite_percent(db, user, event.id),
        cap_percent=row.max_total_discount_percent,
    )
    return TicketQuoteOut(
        event_id=event.id,
        base_price=breakdown.base_price,
        currency=event.ticket_currency or "lei",
        loyalty_percent=breakdown.loyalty_percent,
        promo_percent=breakdown.promo_percent,
        invite_percent=breakdown.invite_percent,
        applied_percent=breakdown.applied_percent,
        applied_source=breakdown.applied_source,
        capped=breakdown.capped,
        discount_amount=breakdown.discount_amount,
        final_price=breakdown.final_price,
        tier=_to_tier_out(current) if current else None,
    )


# --------------------------------------------------------------------------- #
# Invitații — generarea codului
# --------------------------------------------------------------------------- #
def generate_code(length: int | None = None) -> str:
    """Cod de invitație generat CRIPTOGRAFIC pe server.

    `secrets.choice`, nu `random`: `random` e un Mersenne Twister determinist, iar
    din câteva coduri observate se poate reconstrui starea generatorului și
    prezice restul. Lungimea implicită (12 caractere dintr-un alfabet de 32) dă
    ~60 de biți: chiar și cu un milion de încercări pe secundă — imposibil, ruta
    de folosire e limitată la câteva pe minut și pe IP — spațiul nu se explorează.
    """
    size = max(8, int(length or settings.loyalty_invite_code_length))
    return "".join(secrets.choice(_CODE_ALPHABET) for _ in range(size))


def normalize_code(code: str) -> str:
    """Normalizarea codului tastat de user: fără spații, fără cratime, majuscule.

    Un cod dictat la telefon ajunge scris „abcd-efgh ijkl". Alfabetul nu conține
    litere mici, deci ridicarea la majuscule nu poate crea coliziuni.
    """
    return "".join(ch for ch in code.strip().upper() if ch not in " -_\t\n")


# --------------------------------------------------------------------------- #
# Invitații — folosirea (user)
# --------------------------------------------------------------------------- #
def _invite_status(invite: LoyaltyInvite, now: datetime) -> str:
    if invite.revoked_at is not None:
        return INVITE_REVOKED
    if _as_utc(invite.expires_at) <= now:
        return INVITE_EXPIRED
    if invite.used_count >= invite.max_uses:
        return INVITE_EXHAUSTED
    return INVITE_ACTIVE


async def _find_redemption(
    db: AsyncSession, invite_id: uuid.UUID, user_id: uuid.UUID
) -> LoyaltyInviteRedemption | None:
    return (
        await db.execute(
            select(LoyaltyInviteRedemption).where(
                LoyaltyInviteRedemption.invite_id == invite_id,
                LoyaltyInviteRedemption.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


def _to_redeem_out(
    redemption: LoyaltyInviteRedemption, event: Event, *, consumed_new_use: bool
) -> RedeemOut:
    return RedeemOut(
        invite_id=redemption.invite_id,
        event_id=event.id,
        event_title=event.title,
        event_starts_at=event.starts_at,
        discount_percent=redemption.discount_percent,
        redeemed_at=redemption.redeemed_at,
        consumed_new_use=consumed_new_use,
    )


async def redeem_invite(db: AsyncSession, user: User, code: str) -> RedeemOut:
    """Folosește un cod de invitație. ATOMIC (vezi secțiunea 3 din antet).

    Coduri de răspuns:
      404 — cod inexistent (nu confirmăm niciodată existența unui cod străin);
      409 — revocată / expirată / epuizată;
      403 — treaptă de fidelitate insuficientă;
      200 — folosită (sau deja folosită de ACELAȘI user → idempotent, fără consum).
    """
    normalized = normalize_code(code)
    invite = (
        await db.execute(select(LoyaltyInvite).where(LoyaltyInvite.code == normalized))
    ).scalar_one_or_none()
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Cod de invitație invalid."
        )

    # Id-urile se REȚIN în variabile locale: dacă mai jos ajungem pe calea de
    # `rollback`, SQLAlchemy expiră toate instanțele din sesiune, iar o simplă
    # citire `invite.id` ar declanșa o interogare sincronă în context async
    # (`MissingGreenlet`). Variabilele locale nu expiră.
    invite_id = invite.id
    event_id = invite.event_id
    # Și id-ul userului, din același motiv: pe calea de `rollback` instanța `user`
    # (încărcată în ACEEAȘI sesiune) e expirată, iar `user.id` ar deveni o citire
    # sincronă din bază — exact eroarea `MissingGreenlet`.
    user_id = user.id
    event = await _get_event_or_404(db, event_id)

    # IDEMPOTENȚĂ ÎNAINTEA ORICĂREI VERIFICĂRI DE STARE: un user care a folosit deja
    # invitația își poate reciti rezultatul chiar și după ce ea a expirat sau s-a
    # epuizat — dreptul lui e deja câștigat, nu se re-evaluează.
    existing = await _find_redemption(db, invite_id, user_id)
    if existing is not None:
        return _to_redeem_out(existing, event, consumed_new_use=False)

    now = _now()
    state = _invite_status(invite, now)
    if state == INVITE_REVOKED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitația a fost anulată.",
        )
    if state == INVITE_EXPIRED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Invitația a expirat."
        )
    if state == INVITE_EXHAUSTED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitația a fost deja folosită de numărul maxim de persoane.",
        )

    # Treapta minimă cerută — verificată pe pragul SNAPSHOT (`min_stamps_required`),
    # nu pe codul treptei: pragurile se pot reconfigura între emitere și folosire.
    if invite.min_stamps_required:
        stamps = await count_stamps(db, user)
        if stamps < invite.min_stamps_required:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "Invitația cere cel puțin "
                    f"{invite.min_stamps_required} ștampile Flirt Passport."
                ),
            )

    # --- Consumul propriu-zis: o singură instrucțiune, condiționată -----------
    result = await db.execute(
        update(LoyaltyInvite)
        .where(
            LoyaltyInvite.id == invite_id,
            LoyaltyInvite.used_count < LoyaltyInvite.max_uses,
            LoyaltyInvite.revoked_at.is_(None),
            LoyaltyInvite.expires_at > now,
        )
        .values(used_count=LoyaltyInvite.used_count + 1)
        # `synchronize_session=False`: nu cerem ORM-ului să reconcilieze obiectul
        # din sesiune (criteriul compară două coloane, ceea ce l-ar forța la un
        # SELECT suplimentar). Obiectul `invite` din memorie rămâne cu valoarea
        # veche a contorului și NU mai e folosit după acest punct.
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        # Cineva a luat ultima folosire (sau adminul a revocat) între verificare și
        # increment. Nu s-a modificat nimic → putem ridica fără să anulăm nimic.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Invitația a fost deja folosită de numărul maxim de persoane.",
        )

    redemption = LoyaltyInviteRedemption(
        invite_id=invite_id,
        user_id=user_id,
        event_id=event_id,
        discount_percent=_clamp_percent(invite.discount_percent),
        redeemed_at=now,
    )
    db.add(redemption)
    try:
        await db.commit()
    except IntegrityError:
        # Același user, două cereri simultane: unicitatea (invite_id, user_id) a
        # respins-o pe a doua. Anulăm TOATĂ tranzacția — deci și incrementul, care
        # altfel ar fi ars o folosire fără beneficiar — și răspundem idempotent.
        await db.rollback()
        existing = await _find_redemption(db, invite_id, user_id)
        if existing is None:  # pragma: no cover — doar dacă altceva a stricat constrângerea
            raise
        # `rollback` a expirat instanțele din sesiune → re-citim evenimentul
        # printr-un acces AȘTEPTAT, nu prin atribute expirate.
        event = await _get_event_or_404(db, event_id)
        return _to_redeem_out(existing, event, consumed_new_use=False)

    await db.refresh(redemption)
    return _to_redeem_out(redemption, event, consumed_new_use=True)


# --------------------------------------------------------------------------- #
# Invitații — admin
# --------------------------------------------------------------------------- #
def _to_admin_invite_out(invite: LoyaltyInvite, event: Event) -> AdminInviteOut:
    return AdminInviteOut(
        id=invite.id,
        event_id=invite.event_id,
        event_title=event.title,
        code=invite.code,
        max_uses=invite.max_uses,
        used_count=invite.used_count,
        uses_left=max(0, invite.max_uses - invite.used_count),
        expires_at=invite.expires_at,
        min_tier=invite.min_tier_code,
        min_stamps_required=invite.min_stamps_required,
        discount_percent=invite.discount_percent,
        note=invite.note,
        revoked_at=invite.revoked_at,
        created_at=invite.created_at,
        status=_invite_status(invite, _now()),
    )


async def create_invite(
    db: AsyncSession, data: InviteIn, actor: User, ip: str | None = None
) -> AdminInviteOut:
    """Emite o invitație (auditat: `loyalty.invite.create`).

    Validări de business, toate pe server:
      404 — evenimentul nu există;
      400 — expirare în trecut, expirare prea îndepărtată, `max_uses` peste plafon,
            treaptă minimă inexistentă în configurarea curentă.
    """
    event = await _get_event_or_404(db, data.event_id)

    now = _now()
    expires_at = _as_utc(data.expires_at)
    if expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Data de expirare trebuie să fie în viitor.",
        )
    max_horizon = now.timestamp() + settings.loyalty_invite_max_days * 86_400
    if expires_at.timestamp() > max_horizon:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Expirarea nu poate depăși "
                f"{settings.loyalty_invite_max_days} de zile."
            ),
        )
    if data.max_uses > settings.loyalty_invite_max_uses_cap:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Numărul maxim de folosiri nu poate depăși "
                f"{settings.loyalty_invite_max_uses_cap}."
            ),
        )

    # Treapta minimă → prag în ștampile, rezolvat ACUM și snapshot-uit.
    min_stamps: int | None = None
    min_tier_code: str | None = None
    if data.min_tier:
        row = await _get_or_create_settings(db)
        tiers = _normalize_tiers(list(row.tiers or []))
        match = next((t for t in tiers if t["code"] == data.min_tier), None)
        if match is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Treapta „{data.min_tier}” nu există în configurarea curentă.",
            )
        min_stamps = match["min_stamps"]
        min_tier_code = match["code"]

    # Generare cu reîncercare: codul e unic la nivel de tabelă, deci o coliziune
    # (practic imposibilă) ar cădea la commit, nu ar produce un duplicat tăcut.
    last_error: IntegrityError | None = None
    for _ in range(_CODE_MAX_ATTEMPTS):
        invite = LoyaltyInvite(
            # Id-ul e generat AICI, nu lăsat pe seama `default`-ului de coloană
            # (care se aplică abia la flush): jurnalul de audit scris în aceeași
            # tranzacție are nevoie de `target_id` ACUM, altfel ar rămâne NULL.
            id=uuid.uuid4(),
            event_id=event.id,
            code=generate_code(),
            max_uses=data.max_uses,
            used_count=0,
            expires_at=expires_at,
            min_stamps_required=min_stamps,
            min_tier_code=min_tier_code,
            discount_percent=data.discount_percent,
            note=data.note,
            created_by=actor.id,
        )
        db.add(invite)
        audit(
            db,
            actor,
            ACTION_LOYALTY_INVITE_CREATE,
            target_type="loyalty_invite",
            target_id=invite.id,
            # Codul NU intră în jurnal: e o credențială de acces la un beneficiu,
            # iar jurnalul de audit e citibil de orice admin (vezi models/admin.py).
            meta={
                "event_id": event.id,
                "max_uses": invite.max_uses,
                "expires_at": expires_at.isoformat(),
                "min_tier": min_tier_code,
                "discount_percent": data.discount_percent,
            },
            ip=ip,
        )
        try:
            await db.commit()
        except IntegrityError as exc:  # pragma: no cover — coliziune de cod
            last_error = exc
            await db.rollback()
            continue
        await db.refresh(invite)
        return _to_admin_invite_out(invite, event)

    raise last_error  # pragma: no cover — 5 coliziuni consecutive pe 60 de biți


async def list_invites(
    db: AsyncSession,
    *,
    event_id: uuid.UUID | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AdminInviteOut], str | None]:
    """Invitațiile, cele mai recente primele, cu starea folosirii (paginat pe cursor).

    Cheia de sortare e TOTALĂ — `(created_at, id)` — deci paginarea nu poate nici
    duplica, nici sări rânduri (aceeași tehnică precum `list_orders`). Evenimentul
    vine prin JOIN, o singură dată pe pagină (fără N+1).
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(LoyaltyInvite, Event).join(Event, Event.id == LoyaltyInvite.event_id)
    if event_id is not None:
        stmt = stmt.where(LoyaltyInvite.event_id == event_id)
    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_at = (
            select(LoyaltyInvite.created_at)
            .where(LoyaltyInvite.id == anchor_id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                LoyaltyInvite.created_at < anchor_at,
                (LoyaltyInvite.created_at == anchor_at)
                & (LoyaltyInvite.id < anchor_id),
            )
        )

    rows = (
        await db.execute(
            stmt.order_by(
                LoyaltyInvite.created_at.desc(), LoyaltyInvite.id.desc()
            ).limit(limit + 1)
        )
    ).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return [], None

    items = [_to_admin_invite_out(row.LoyaltyInvite, row.Event) for row in rows]
    next_cursor = encode_cursor(rows[-1].LoyaltyInvite.id) if has_more else None
    return items, next_cursor


async def revoke_invite(
    db: AsyncSession, invite_id: uuid.UUID, actor: User, ip: str | None = None
) -> AdminInviteOut:
    """Revocă o invitație (auditat: `loyalty.invite.revoke`).

    Revocare SOFT și IDEMPOTENTĂ: o invitație deja revocată rămâne revocată, cu
    momentul PRIMEI revocări (nu rescriem istoria la al doilea click). Folosirile
    deja consumate NU se anulează — cine a intrat pe ea a intrat.
    """
    invite = await db.get(LoyaltyInvite, invite_id)
    if invite is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    if invite.revoked_at is None:
        invite.revoked_at = _now()
        audit(
            db,
            actor,
            ACTION_LOYALTY_INVITE_REVOKE,
            target_type="loyalty_invite",
            target_id=invite.id,
            meta={"event_id": invite.event_id, "used_count": invite.used_count},
            ip=ip,
        )
        await db.commit()
        await db.refresh(invite)

    event = await _get_event_or_404(db, invite.event_id)
    return _to_admin_invite_out(invite, event)
