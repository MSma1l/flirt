"""Teste pentru FIDELITATE (trepte Flirt Passport) și INVITAȚII speciale.

Acoperă exact lucrurile care costă bani sau securitate dacă sunt greșite:
  * calculul treptei pe praguri (inclusiv exact PE prag și sub el);
  * ștampile duplicate la ACELAȘI eveniment — nu umflă treapta (și baza refuză);
  * reducerea de fidelitate aplicată în cotație ȘI pe comanda de bilet;
  * regula de combinare cu promo-ul evenimentului (cea mai mare câștigă);
  * plafonul reducerii totale;
  * prețul nu poate ajunge negativ, nici cu date corupte;
  * invitație validă / expirată / epuizată / revocată / treaptă insuficientă;
  * folosirea CONCURENTĂ a ultimei folosiri disponibile — exact una reușește;
  * clientul nu poate impune un preț sau un procent;
  * rutele de admin sunt inaccesibile unui user obișnuit.

Rulează pe PostgreSQL efemer (fixturile din `conftest.py`).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.db.session import AsyncSessionLocal
from app.models.event import Event, FlirtPassportStamp
from app.models.loyalty import LoyaltyInvite, LoyaltyInviteRedemption
from app.models.user import ROLE_ADMIN, User
from app.services import loyalty

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

pytestmark = pytest.mark.asyncio


# --------------------------------------------------------------------------- #
# Helperi
# --------------------------------------------------------------------------- #
async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _make_admin(client, db, email: str) -> dict:
    headers = await _register(client, email)
    user = await db.scalar(select(User).where(User.email == email))
    user.role = ROLE_ADMIN
    await db.commit()
    return headers


async def _user(db, email: str) -> User:
    return await db.scalar(select(User).where(User.email == email))


async def _create_event(
    db,
    *,
    ticket_price: float | None = None,
    promo_percent: int | None = None,
    title: str = "Petrecere Flirt",
) -> Event:
    event = Event(
        title=title,
        starts_at=datetime.now(timezone.utc) + timedelta(days=7),
        city="Chișinău",
        kind="flirt_party",
        ticket_price=ticket_price,
        ticket_currency="lei" if ticket_price is not None else None,
        promo_discount_percent=promo_percent,
        promo_code="FLIRT" if promo_percent else None,
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)
    return event


async def _give_stamps(db, user: User, count: int) -> list[Event]:
    """`count` ștampile la `count` evenimente DISTINCTE (ca un check-in real)."""
    events: list[Event] = []
    now = datetime.now(timezone.utc)
    for i in range(count):
        event = Event(
            title=f"Eveniment {i}",
            starts_at=now - timedelta(days=i + 1),
            city="Chișinău",
            kind="flirt_party",
        )
        db.add(event)
        await db.flush()
        db.add(
            FlirtPassportStamp(event_id=event.id, user_id=user.id, stamped_at=now)
        )
        events.append(event)
    await db.commit()
    return events


async def _create_invite(
    db,
    event: Event,
    *,
    code: str = "TESTCODE1234",
    max_uses: int = 1,
    used_count: int = 0,
    expires_in_days: float = 7,
    min_stamps: int | None = None,
    discount_percent: int | None = None,
    revoked: bool = False,
) -> LoyaltyInvite:
    """Invitație creată DIRECT în baza de date — pentru stările pe care ruta de
    admin le refuză prin construcție (expirată, deja epuizată)."""
    now = datetime.now(timezone.utc)
    invite = LoyaltyInvite(
        event_id=event.id,
        code=code,
        max_uses=max_uses,
        used_count=used_count,
        expires_at=now + timedelta(days=expires_in_days),
        min_stamps_required=min_stamps,
        min_tier_code=None,
        discount_percent=discount_percent,
        revoked_at=now if revoked else None,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


# --------------------------------------------------------------------------- #
# 1. Treapta pe praguri
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    ("stamps", "tier_code", "discount", "next_code", "to_next"),
    [
        (0, None, 0, "bronze", 3),
        (2, None, 0, "bronze", 1),       # sub prag, la un pas
        (3, "bronze", 5, "silver", 3),   # EXACT pe prag → treapta se acordă
        (5, "bronze", 5, "silver", 1),
        (6, "silver", 10, "gold", 6),
        (11, "silver", 10, "gold", 1),
        (12, "gold", 15, None, None),    # ultima treaptă → fără „următoarea"
        (40, "gold", 15, None, None),
    ],
)
async def test_tier_is_computed_from_thresholds(
    client, db_session, stamps, tier_code, discount, next_code, to_next
):
    """Pragurile configurate decid treapta; „exact pe prag" înseamnă ACORDAT."""
    email = f"tier{stamps}@example.com"
    headers = await _register(client, email)
    user = await _user(db_session, email)
    await _give_stamps(db_session, user, stamps)

    body = (await client.get(f"{API}/loyalty/me", headers=headers)).json()
    assert body["stamps"] == stamps
    assert (body["tier"]["code"] if body["tier"] else None) == tier_code
    assert body["discount_percent"] == discount
    assert (body["next_tier"]["code"] if body["next_tier"] else None) == next_code
    assert body["stamps_to_next_tier"] == to_next


async def test_tiers_come_from_db_and_change_without_deploy(client, db_session):
    """Pragul se schimbă dintr-un PUT de admin, nu dintr-un deploy."""
    admin = await _make_admin(client, db_session, "adm_tiers@example.com")
    headers = await _register(client, "u_tiers@example.com")
    user = await _user(db_session, "u_tiers@example.com")
    await _give_stamps(db_session, user, 2)

    # Cu pragurile implicite (bronze la 3), 2 ștampile nu dau nicio treaptă.
    assert (await client.get(f"{API}/loyalty/me", headers=headers)).json()["tier"] is None

    resp = await client.put(
        f"{ADMIN}/loyalty/tiers",
        json={
            "tiers": [
                {"code": "bronze", "name": "Bronze", "min_stamps": 2,
                 "discount_percent": 7},
            ],
            "max_total_discount_percent": 30,
        },
        headers=admin,
    )
    assert resp.status_code == 200, resp.text

    body = (await client.get(f"{API}/loyalty/me", headers=headers)).json()
    assert body["tier"]["code"] == "bronze"
    assert body["discount_percent"] == 7


# --------------------------------------------------------------------------- #
# 2. Ștampile duplicate la același eveniment
# --------------------------------------------------------------------------- #
async def test_second_checkin_same_event_does_not_add_a_stamp(client, db_session):
    """Două check-in-uri la ACELAȘI eveniment = o singură ștampilă, o singură dată
    numărată. Fără asta, cine intră și iese de zece ori ar ajunge Gold în aceeași seară."""
    headers = await _register(client, "dup@example.com")
    event = await _create_event(db_session)

    first = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    second = await client.post(f"{API}/events/{event.id}/checkin", headers=headers)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text

    passport = (await client.get(f"{API}/events/passport", headers=headers)).json()
    assert len(passport) == 1
    assert (await client.get(f"{API}/loyalty/me", headers=headers)).json()["stamps"] == 1


async def test_database_refuses_a_duplicate_stamp_row(client, db_session):
    """Garanția e a BAZEI, nu doar a codului: `uq_stamp_pair` respinge dublura.

    Testul e răspunsul explicit la întrebarea „poate un user să facă check-in de
    două ori la același eveniment?" — nu poate, nici prin API (idempotent), nici
    prin inserare directă.
    """
    await _register(client, "dup2@example.com")
    user = await _user(db_session, "dup2@example.com")
    event = await _create_event(db_session)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as session:
        session.add(
            FlirtPassportStamp(event_id=event.id, user_id=user.id, stamped_at=now)
        )
        await session.commit()

    async with AsyncSessionLocal() as session:
        session.add(
            FlirtPassportStamp(event_id=event.id, user_id=user.id, stamped_at=now)
        )
        with pytest.raises(IntegrityError):
            await session.commit()
        await session.rollback()


# --------------------------------------------------------------------------- #
# 3. Reducerea aplicată: cotație + comandă
# --------------------------------------------------------------------------- #
async def test_loyalty_discount_applies_to_quote_and_to_the_order(client, db_session):
    """Silver (10%) pe un bilet de 200 → 180, și în cotație, și pe comanda reală."""
    headers = await _register(client, "buy1@example.com")
    user = await _user(db_session, "buy1@example.com")
    await _give_stamps(db_session, user, 6)
    event = await _create_event(db_session, ticket_price=200.0)

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["loyalty_percent"] == 10
    assert quote["applied_percent"] == 10
    assert quote["applied_source"] == "loyalty"
    assert quote["base_price"] == 200.0
    assert quote["final_price"] == 180.0
    assert quote["discount_amount"] == 20.0

    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert order.status_code == 201, order.text
    assert order.json()["order"]["price"] == 180.0
    assert order.json()["payment"]["amount"] == 180.0


async def test_user_without_tier_pays_full_price(client, db_session):
    headers = await _register(client, "buy0@example.com")
    event = await _create_event(db_session, ticket_price=200.0)

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["applied_percent"] == 0
    assert quote["applied_source"] == "none"
    assert quote["final_price"] == 200.0


async def test_quote_without_ticket_price_is_400(client, db_session):
    headers = await _register(client, "noprice@example.com")
    event = await _create_event(db_session, ticket_price=None)
    resp = await client.get(
        f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers
    )
    assert resp.status_code == 400, resp.text


# --------------------------------------------------------------------------- #
# 4. Regula de combinare cu promo-ul evenimentului
# --------------------------------------------------------------------------- #
async def test_promo_wins_when_bigger_and_does_not_stack(client, db_session):
    """Fidelitate 10% + promo 25% NU fac 35%: se aplică 25%, sursa `promo`."""
    headers = await _register(client, "mix1@example.com")
    user = await _user(db_session, "mix1@example.com")
    await _give_stamps(db_session, user, 6)  # silver = 10%
    event = await _create_event(db_session, ticket_price=200.0, promo_percent=25)

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["loyalty_percent"] == 10
    assert quote["promo_percent"] == 25
    assert quote["applied_percent"] == 25
    assert quote["applied_source"] == "promo"
    assert quote["final_price"] == 150.0  # NU 130.0 (cumulat)


async def test_loyalty_wins_when_bigger_than_promo(client, db_session):
    headers = await _register(client, "mix2@example.com")
    user = await _user(db_session, "mix2@example.com")
    await _give_stamps(db_session, user, 12)  # gold = 15%
    event = await _create_event(db_session, ticket_price=100.0, promo_percent=5)

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["applied_percent"] == 15
    assert quote["applied_source"] == "loyalty"
    assert quote["final_price"] == 85.0


async def test_invite_discount_enters_the_same_rule(client, db_session):
    """Invitația e a treia sursă, tratată de ACEEAȘI regulă (cea mai mare câștigă)."""
    headers = await _register(client, "mix3@example.com")
    user = await _user(db_session, "mix3@example.com")
    await _give_stamps(db_session, user, 6)  # silver = 10%
    event = await _create_event(db_session, ticket_price=200.0, promo_percent=12)
    await _create_invite(db_session, event, code="VIPCODE00001", discount_percent=20)

    redeem = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "VIPCODE00001"}, headers=headers
    )
    assert redeem.status_code == 200, redeem.text

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert (quote["loyalty_percent"], quote["promo_percent"], quote["invite_percent"]) == (10, 12, 20)
    assert quote["applied_percent"] == 20
    assert quote["applied_source"] == "invite"
    assert quote["final_price"] == 160.0  # NU 200 × (1 − 0.42)


# --------------------------------------------------------------------------- #
# 5. Plafonul + prețul care nu poate deveni negativ
# --------------------------------------------------------------------------- #
async def test_cap_limits_a_misconfigured_promo(client, db_session):
    """Un promo tastat „90" în loc de „9" nu dă biletul aproape gratis: plafon 30%."""
    headers = await _register(client, "cap1@example.com")
    event = await _create_event(db_session, ticket_price=200.0, promo_percent=90)

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["promo_percent"] == 90
    assert quote["applied_percent"] == 30
    assert quote["capped"] is True
    assert quote["final_price"] == 140.0


async def test_cap_is_configurable_by_admin(client, db_session):
    admin = await _make_admin(client, db_session, "adm_cap@example.com")
    headers = await _register(client, "cap2@example.com")
    event = await _create_event(db_session, ticket_price=200.0, promo_percent=90)

    resp = await client.put(
        f"{ADMIN}/loyalty/tiers",
        json={"tiers": [], "max_total_discount_percent": 50},
        headers=admin,
    )
    assert resp.status_code == 200, resp.text

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["applied_percent"] == 50
    assert quote["final_price"] == 100.0


async def test_price_can_never_go_negative_or_below_zero():
    """Cazuri limită, direct pe regula pură (fără DB): oricât de corupte ar fi
    datele, prețul rămâne ≥ 0 și reducerea ≤ 100%."""
    # Procent corupt (>100), plafon deschis → tăiat la 100% → preț exact 0, nu negativ.
    full = loyalty.combine_discounts(
        100.0, loyalty_percent=150, promo_percent=None, invite_percent=None,
        cap_percent=100,
    )
    assert full.applied_percent == 100
    assert full.final_price == 0.0
    assert full.discount_amount == 100.0

    # Toate sursele corupte simultan — tot 0, nu −50.
    worst = loyalty.combine_discounts(
        50.0, loyalty_percent=999, promo_percent=999, invite_percent=999,
        cap_percent=999,
    )
    assert worst.final_price == 0.0

    # Procente negative (coloană coruptă) → 0%, prețul rămâne întreg.
    negative = loyalty.combine_discounts(
        80.0, loyalty_percent=-30, promo_percent=-1, invite_percent=None,
        cap_percent=30,
    )
    assert negative.applied_percent == 0
    assert negative.final_price == 80.0

    # Preț de bază negativ → 0, nu o sumă negativă de încasat.
    broken_price = loyalty.combine_discounts(
        -100.0, loyalty_percent=10, promo_percent=None, invite_percent=None,
        cap_percent=30,
    )
    assert broken_price.base_price == 0.0
    assert broken_price.final_price == 0.0


async def test_highest_wins_is_never_additive():
    """Contra-proba regulii: 15 + 25 + 20 → 25, niciodată 60."""
    result = loyalty.combine_discounts(
        100.0, loyalty_percent=15, promo_percent=25, invite_percent=20,
        cap_percent=100,
    )
    assert result.applied_percent == 25
    assert result.applied_source == "promo"
    assert result.final_price == 75.0


# --------------------------------------------------------------------------- #
# 6. Invitații: emitere, folosire, stări invalide
# --------------------------------------------------------------------------- #
async def test_admin_issues_invite_with_server_generated_code(client, db_session):
    admin = await _make_admin(client, db_session, "adm_inv@example.com")
    event = await _create_event(db_session, ticket_price=100.0)

    resp = await client.post(
        f"{ADMIN}/loyalty/invites",
        json={
            "event_id": str(event.id),
            "max_uses": 3,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
            "min_tier": "silver",
            "discount_percent": 20,
            "note": "Invitați VIP",
        },
        headers=admin,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    # Codul e generat pe server, cu entropie, din alfabetul fără caractere ambigue.
    assert len(body["code"]) >= 12
    assert set(body["code"]) <= set("ABCDEFGHJKMNPQRSTUVWXYZ023456789")
    assert body["status"] == "active"
    assert body["used_count"] == 0
    assert body["uses_left"] == 3
    # Treapta minimă e snapshot-uită ca PRAG, nu ca referință la configurare.
    assert body["min_tier"] == "silver"
    assert body["min_stamps_required"] == 6

    # Codul NU ajunge în jurnalul de audit (e o credențială, nu un parametru).
    log = (
        await client.get(f"{ADMIN}/audit-log?action=loyalty.invite.create", headers=admin)
    ).json()
    assert log and body["code"] not in str(log)


async def test_two_invites_never_get_the_same_code(client, db_session):
    admin = await _make_admin(client, db_session, "adm_inv2@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    payload = {
        "event_id": str(event.id),
        "max_uses": 1,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=5)).isoformat(),
    }
    codes = set()
    for _ in range(5):
        resp = await client.post(f"{ADMIN}/loyalty/invites", json=payload, headers=admin)
        assert resp.status_code == 201, resp.text
        codes.add(resp.json()["code"])
    assert len(codes) == 5


async def test_invite_rejects_past_expiry(client, db_session):
    admin = await _make_admin(client, db_session, "adm_inv3@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    resp = await client.post(
        f"{ADMIN}/loyalty/invites",
        json={
            "event_id": str(event.id),
            "max_uses": 1,
            "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
        },
        headers=admin,
    )
    assert resp.status_code == 400, resp.text


async def test_valid_invite_is_redeemed_and_is_idempotent(client, db_session):
    headers = await _register(client, "inv_ok@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    invite = await _create_invite(
        db_session, event, code="GOODCODE0001", max_uses=2, discount_percent=25
    )

    first = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "GOODCODE0001"}, headers=headers
    )
    assert first.status_code == 200, first.text
    assert first.json()["consumed_new_use"] is True
    assert first.json()["discount_percent"] == 25
    assert first.json()["event_id"] == str(event.id)

    # Al doilea apel al ACELUIAȘI user: reușește, dar NU mai consumă o folosire.
    second = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "goodcode0001"}, headers=headers
    )
    assert second.status_code == 200, second.text
    assert second.json()["consumed_new_use"] is False

    await db_session.refresh(invite)
    assert invite.used_count == 1


async def test_unknown_code_is_404(client, db_session):
    headers = await _register(client, "inv_404@example.com")
    resp = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "NOSUCHCODE99"}, headers=headers
    )
    assert resp.status_code == 404, resp.text


async def test_expired_invite_is_rejected(client, db_session):
    headers = await _register(client, "inv_exp@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    await _create_invite(
        db_session, event, code="EXPIREDCODE1", expires_in_days=-1
    )
    resp = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "EXPIREDCODE1"}, headers=headers
    )
    assert resp.status_code == 409, resp.text
    assert "expirat" in resp.json()["detail"].lower()


async def test_exhausted_invite_is_rejected(client, db_session):
    headers = await _register(client, "inv_ex@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    await _create_invite(
        db_session, event, code="USEDUPCODE12", max_uses=1, used_count=1
    )
    resp = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "USEDUPCODE12"}, headers=headers
    )
    assert resp.status_code == 409, resp.text


async def test_revoked_invite_is_rejected_and_revocation_keeps_history(
    client, db_session
):
    admin = await _make_admin(client, db_session, "adm_rev@example.com")
    first_user = await _register(client, "inv_rev1@example.com")
    second_user = await _register(client, "inv_rev2@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    invite = await _create_invite(
        db_session, event, code="REVOKECODE12", max_uses=5, discount_percent=10
    )

    ok = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "REVOKECODE12"}, headers=first_user
    )
    assert ok.status_code == 200, ok.text

    revoked = await client.post(
        f"{ADMIN}/loyalty/invites/{invite.id}/revoke", headers=admin
    )
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["status"] == "revoked"
    # Folosirea deja consumată NU se anulează — cine a intrat pe ea a intrat.
    assert revoked.json()["used_count"] == 1

    blocked = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "REVOKECODE12"},
        headers=second_user,
    )
    assert blocked.status_code == 409, blocked.text

    # Cine a folosit-o înainte de revocare își păstrează reducerea.
    quote = (
        await client.get(
            f"{API}/loyalty/events/{event.id}/ticket-quote", headers=first_user
        )
    ).json()
    assert quote["invite_percent"] == 10


async def test_invite_with_insufficient_tier_is_forbidden(client, db_session):
    headers = await _register(client, "inv_tier@example.com")
    user = await _user(db_session, "inv_tier@example.com")
    await _give_stamps(db_session, user, 2)  # sub bronze
    event = await _create_event(db_session, ticket_price=100.0)
    await _create_invite(db_session, event, code="TIERCODE0001", min_stamps=6)

    resp = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "TIERCODE0001"}, headers=headers
    )
    assert resp.status_code == 403, resp.text

    # Aceeași invitație, un user care ARE treapta → trece.
    ok_headers = await _register(client, "inv_tier_ok@example.com")
    ok_user = await _user(db_session, "inv_tier_ok@example.com")
    await _give_stamps(db_session, ok_user, 6)
    ok = await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "TIERCODE0001"},
        headers=ok_headers,
    )
    assert ok.status_code == 200, ok.text


# --------------------------------------------------------------------------- #
# 7. Concurență pe ultima folosire disponibilă
# --------------------------------------------------------------------------- #
async def test_concurrent_redeem_of_last_use_succeeds_exactly_once(client, db_session):
    """Cinci useri diferiți trimit SIMULTAN ultimul cod disponibil: exact unul intră.

    Testat pe SERVICIU, cu câte o sesiune de bază de date proprie pentru fiecare
    — nu prin HTTP: fixtura `client` împarte O SINGURĂ sesiune între cereri, deci
    cererile s-ar ciocni în driver, nu în codul testat (aceeași observație ca în
    `test_telegram_initdata_real.py`). Cu sesiuni separate, cursa e cea reală:
    cinci tranzacții concurente peste același rând.
    """
    emails = [f"race{i}@example.com" for i in range(5)]
    for email in emails:
        await _register(client, email)
    event = await _create_event(db_session, ticket_price=100.0)
    invite = await _create_invite(
        db_session, event, code="RACECODE0001", max_uses=1, discount_percent=10
    )
    user_ids = [(await _user(db_session, email)).id for email in emails]
    await db_session.commit()  # nicio tranzacție deschisă care să blocheze rândul

    async def _attempt(user_id: uuid.UUID):
        async with AsyncSessionLocal() as session:
            user = await session.get(User, user_id)
            return await loyalty.redeem_invite(session, user, "RACECODE0001")

    results = await asyncio.gather(
        *(_attempt(uid) for uid in user_ids), return_exceptions=True
    )
    ok = [r for r in results if not isinstance(r, Exception)]
    refused = [r for r in results if isinstance(r, Exception)]
    assert len(ok) == 1, results
    assert len(refused) == 4, results
    assert all(getattr(r, "status_code", None) == 409 for r in refused), refused

    # Contorul a crescut EXACT o dată, iar rândurile de folosire sunt exact unul.
    async with AsyncSessionLocal() as session:
        fresh = await session.get(LoyaltyInvite, invite.id)
        assert fresh.used_count == 1
        used = await session.scalar(
            select(func.count())
            .select_from(LoyaltyInviteRedemption)
            .where(LoyaltyInviteRedemption.invite_id == invite.id)
        )
        assert used == 1


async def test_concurrent_redeem_by_the_same_user_burns_a_single_use(
    client, db_session
):
    """Dublu-tap al ACELUIAȘI user pe o invitație cu 2 folosiri: consumă UNA.

    Fără constrângerea de unicitate (invitație, user), cele două cereri ar
    incrementa contorul de două ori și ar arde o folosire fără beneficiar.
    """
    await _register(client, "same@example.com")
    user_id = (await _user(db_session, "same@example.com")).id
    event = await _create_event(db_session, ticket_price=100.0)
    invite = await _create_invite(
        db_session, event, code="SAMECODE0001", max_uses=2, discount_percent=10
    )
    await db_session.commit()

    async def _attempt():
        async with AsyncSessionLocal() as session:
            user = await session.get(User, user_id)
            return await loyalty.redeem_invite(session, user, "SAMECODE0001")

    results = await asyncio.gather(_attempt(), _attempt(), return_exceptions=True)
    assert all(not isinstance(r, Exception) for r in results), results
    assert sum(1 for r in results if r.consumed_new_use) == 1, results

    async with AsyncSessionLocal() as session:
        fresh = await session.get(LoyaltyInvite, invite.id)
        assert fresh.used_count == 1


# --------------------------------------------------------------------------- #
# 8. Clientul nu are voie să influențeze banii
# --------------------------------------------------------------------------- #
async def test_client_cannot_inject_price_or_percent(client, db_session):
    """Câmpurile de preț/procent trimise de client sunt IGNORATE, nu onorate."""
    headers = await _register(client, "inject@example.com")
    event = await _create_event(db_session, ticket_price=200.0)
    await _create_invite(db_session, event, code="INJECTCODE12", discount_percent=5)

    resp = await client.post(
        f"{API}/loyalty/invites/redeem",
        json={"code": "INJECTCODE12", "discount_percent": 99, "price": 1},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["discount_percent"] == 5

    quote = (
        await client.get(f"{API}/loyalty/events/{event.id}/ticket-quote", headers=headers)
    ).json()
    assert quote["applied_percent"] == 5
    assert quote["final_price"] == 190.0

    order = await client.post(f"{API}/events/{event.id}/ticket-orders", headers=headers)
    assert order.json()["order"]["price"] == 190.0


# --------------------------------------------------------------------------- #
# 9. Rutele de admin sunt închise userilor obișnuiți
# --------------------------------------------------------------------------- #
async def test_admin_loyalty_routes_are_forbidden_for_normal_users(client, db_session):
    headers = await _register(client, "nosy@example.com")
    event = await _create_event(db_session, ticket_price=100.0)
    invite = await _create_invite(db_session, event, code="ADMONLYCODE1")

    expires = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    # Secvențial, nu în paralel: fixtura `client` împarte O SINGURĂ sesiune de DB
    # între cereri, iar două cereri simultane pe ea s-ar ciocni în driver.
    responses = [
        await client.get(f"{ADMIN}/loyalty/invites", headers=headers),
        await client.get(f"{ADMIN}/loyalty/tiers", headers=headers),
        await client.post(
            f"{ADMIN}/loyalty/invites",
            json={"event_id": str(event.id), "max_uses": 1, "expires_at": expires},
            headers=headers,
        ),
        await client.post(
            f"{ADMIN}/loyalty/invites/{invite.id}/revoke", headers=headers
        ),
        await client.put(
            f"{ADMIN}/loyalty/tiers",
            json={"tiers": [], "max_total_discount_percent": 90},
            headers=headers,
        ),
    ]
    for resp in responses:
        assert resp.status_code == 403, resp.text

    # Fără token deloc → 401.
    assert (await client.get(f"{ADMIN}/loyalty/invites")).status_code == 401


async def test_admin_list_shows_usage_state(client, db_session):
    admin = await _make_admin(client, db_session, "adm_list@example.com")
    user = await _register(client, "lister@example.com")
    event = await _create_event(db_session, ticket_price=100.0, title="Cu invitații")
    other = await _create_event(db_session, ticket_price=100.0, title="Alt eveniment")
    await _create_invite(db_session, event, code="LISTCODE0001", max_uses=2)
    await _create_invite(db_session, other, code="LISTCODE0002", max_uses=1)

    await client.post(
        f"{API}/loyalty/invites/redeem", json={"code": "LISTCODE0001"}, headers=user
    )

    items = (await client.get(f"{ADMIN}/loyalty/invites", headers=admin)).json()
    assert len(items) == 2

    filtered = (
        await client.get(f"{ADMIN}/loyalty/invites?event_id={event.id}", headers=admin)
    ).json()
    assert len(filtered) == 1
    assert filtered[0]["code"] == "LISTCODE0001"
    assert filtered[0]["event_title"] == "Cu invitații"
    assert filtered[0]["used_count"] == 1
    assert filtered[0]["uses_left"] == 1
    assert filtered[0]["status"] == "active"
