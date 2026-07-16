"""Teste funcționale pentru panoul de administrare (`/api/v1/admin/*`).

Acoperă, pentru un ADMIN autentificat: statistici agregate, serii temporale,
coada de moderare + rezolvare, gestiunea userilor (ban/unban/ștergere GDPR),
CRUD-ul de evenimente, abonamentele și jurnalul de audit.

Securitatea (401/403/leak/audit/plafoane) e testată separat, în
`test_admin_security.py`.

Rulează OFFLINE, pe SQLite in-memory (fixturile din `conftest.py`).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.models.admin import AdminAuditLog
from app.models.billing import Subscription
from app.models.chat import Chat, Message
from app.models.event import Event, EventAttendance
from app.models.moderation import Report
from app.models.profile import Profile
from app.models.swipe import Like, Match
from app.models.user import ROLE_ADMIN, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

_ADULT_YEAR = date.today().year - 25


# --------------------------------------------------------------------------- #
# Helperi
# --------------------------------------------------------------------------- #
async def _register(client, email: str) -> dict:
    """Înregistrează un user și întoarce headerele cu Bearer token."""
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def _get_user(db, email: str) -> User:
    return await db.scalar(select(User).where(User.email == email))


async def _make_admin(client, db, email: str) -> tuple[dict, User]:
    """Creează un user și îl promovează la rol de admin (bootstrap-ul din script).

    Rolul e citit din DB la FIECARE cerere (`require_admin`), deci token-ul emis
    înainte de promovare devine imediat valid pentru panou — fără re-login.
    """
    headers = await _register(client, email)
    user = await _get_user(db, email)
    user.role = ROLE_ADMIN
    await db.commit()
    return headers, user


async def _make_profile(db, user: User, name: str, **kwargs) -> Profile:
    profile = Profile(
        user_id=user.id,
        name=name,
        birth_date=date(_ADULT_YEAR, 6, 15),
        gender=kwargs.get("gender", "female"),
        height_cm=170,
        city=kwargs.get("city", "Chișinău"),
        languages=["ro"],
        dating_statuses=["serious"],
        photos=kwargs.get("photos", ["https://cdn.flirt.local/p1.jpg"]),
        about=kwargs.get("about", "Salut!"),
        completed=kwargs.get("completed", True),
        verified=kwargs.get("verified", False),
    )
    db.add(profile)
    await db.commit()
    return profile


# --------------------------------------------------------------------------- #
# 1. Statistici
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_stats_aggregates_every_domain(client, db_session):
    """`GET /admin/stats` întoarce contoare corecte pentru toate domeniile."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "u1@example.com")
    await _register(client, "u2@example.com")
    u1 = await _get_user(db_session, "u1@example.com")
    u2 = await _get_user(db_session, "u2@example.com")

    await _make_profile(db_session, u1, "Ana", verified=True)
    await _make_profile(db_session, u2, "Bianca", completed=False)

    # Un swipe reciproc → match + chat + mesaj.
    db_session.add_all(
        [
            Like(from_user_id=u1.id, to_user_id=u2.id, is_like=True),
            Like(from_user_id=u2.id, to_user_id=u1.id, is_like=True),
            Like(from_user_id=admin.id, to_user_id=u1.id, is_like=False),
        ]
    )
    match = Match(user_a_id=min(u1.id, u2.id, key=str), user_b_id=max(u1.id, u2.id, key=str))
    db_session.add(match)
    await db_session.flush()
    chat = Chat(match_id=match.id, user_a_id=match.user_a_id, user_b_id=match.user_b_id)
    db_session.add(chat)
    await db_session.flush()
    db_session.add(Message(chat_id=chat.id, sender_id=u1.id, body="hey", was_masked=True))

    # Un raport + un abonament activ + un eveniment viitor.
    db_session.add(Report(reporter_id=u1.id, reported_id=u2.id, category="spam"))
    db_session.add(
        Subscription(
            user_id=u1.id,
            plan="premium",
            status="active",
            provider="stub",
            expires_at=datetime.now(timezone.utc) + timedelta(days=10),
        )
    )
    db_session.add(
        Event(
            title="Party",
            starts_at=datetime.now(timezone.utc) + timedelta(days=2),
            city="Chișinău",
            kind="flirt_party",
        )
    )
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["users"]["total"] == 3            # admin + 2 useri
    assert data["users"]["new_today"] == 3
    assert data["users"]["admins"] == 1
    assert data["users"]["banned"] == 0

    assert data["profiles"]["total"] == 2
    assert data["profiles"]["completed"] == 1
    assert data["profiles"]["verified"] == 1
    # Incomplet se raportează la TOȚI userii (adminul nu are profil deloc).
    assert data["profiles"]["incomplete"] == 2

    assert data["swipes"]["swipes"] == 3
    assert data["swipes"]["likes"] == 2
    assert data["swipes"]["dislikes"] == 1
    assert data["swipes"]["matches"] == 1
    assert data["swipes"]["match_rate"] == 50.0   # 1 match / 2 like-uri

    assert data["chats"]["chats"] == 1
    assert data["chats"]["messages"] == 1
    assert data["chats"]["masked_messages"] == 1

    assert data["reports"]["total"] == 1
    assert data["reports"]["pending"] == 1
    assert data["reports"]["by_category"] == {"spam": 1}

    assert data["subscriptions"]["active"] == 1
    assert data["subscriptions"]["by_plan"] == {"premium": 1}
    # Venitul estimat vine din prețul din config, nu dintr-o constantă din test.
    from app.core.config import settings

    assert data["subscriptions"]["estimated_revenue_eur"] == settings.price_premium

    assert data["events"]["total"] == 1
    assert data["events"]["upcoming"] == 1


@pytest.mark.asyncio
async def test_stats_on_empty_db_returns_zeros_not_nulls(client, db_session):
    """Pe o bază goală, `SUM(...)` întoarce NULL în SQL → trebuie să devină 0.

    Fără `COALESCE`, dashboard-ul ar primi `null` și ar sparge graficele din UI.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["swipes"] == {
        "swipes": 0,
        "likes": 0,
        "dislikes": 0,
        "matches": 0,
        "matches_24h": 0,
        "match_rate": 0.0,   # fără ZeroDivisionError pe 0 like-uri
    }
    assert data["reports"]["total"] == 0
    assert data["subscriptions"]["estimated_revenue_eur"] == 0.0
    # Niciun contor nu are voie să fie `null` (SUM peste 0 rânduri → NULL în SQL).
    for section in ("users", "profiles", "swipes", "chats", "reports", "events"):
        assert all(v is not None for v in data[section].values()), (
            f"Secțiunea `{section}` conține `null` — lipsește COALESCE pe un SUM."
        )


@pytest.mark.asyncio
async def test_stats_uses_constant_number_of_queries(client, db_session, engine):
    """Dashboard-ul e AGREGAT în SQL: numărul de query-uri NU crește cu datele.

    Testul de regresie pentru lecția N+1 pe care proiectul a învățat-o deja la
    `GET /chats` (604 query-uri → 6). Un dashboard care numără în Python ar fi
    executat un query per rând.
    """
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    statements: list[str] = []

    def _on_execute(conn, cursor, statement, params, context, executemany):
        statements.append(statement)

    # Măsurăm întâi cu puține date...
    event.listen(engine.sync_engine, "before_cursor_execute", _on_execute)
    await client.get(f"{ADMIN}/stats", headers=headers)
    baseline = len(statements)
    event.remove(engine.sync_engine, "before_cursor_execute", _on_execute)

    # ...apoi umflăm baza de 20 de ori.
    for i in range(20):
        user = User(email=f"bulk{i}@example.com", password_hash="x")
        db_session.add(user)
        await db_session.flush()
        await _make_profile(db_session, user, f"User {i}")
        db_session.add(Like(from_user_id=admin.id, to_user_id=user.id, is_like=True))
        db_session.add(Report(reporter_id=admin.id, reported_id=user.id, category="spam"))
    await db_session.commit()

    statements.clear()
    event.listen(engine.sync_engine, "before_cursor_execute", _on_execute)
    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    scaled = len(statements)
    event.remove(engine.sync_engine, "before_cursor_execute", _on_execute)

    assert resp.status_code == 200
    assert scaled == baseline, (
        f"GET /admin/stats a executat {scaled} query-uri cu 20 de useri, dar "
        f"{baseline} cu 0 → statisticile NU sunt agregate în SQL (N+1)."
    )


@pytest.mark.asyncio
async def test_stats_exposes_flat_dashboard_fields(client, db_session):
    """Cifrele PLATE de pe cardurile panoului (contractul `AdminStats` din types.ts)."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    for key in (
        "users_total",
        "users_active_24h",
        "users_new_7d",
        "users_banned",
        "matches_total",
        "matches_24h",
        "reports_pending",
        "subscriptions_active",
        "revenue_estimated_eur",
    ):
        assert key in data, f"Câmpul plat `{key}` lipsește din contractul panoului."

    # Stratul plat și cel detaliat provin din ACELEAȘI agregate — nu pot diverge.
    assert data["users_total"] == data["users"]["total"]
    assert data["matches_total"] == data["swipes"]["matches"]
    assert data["reports_pending"] == data["reports"]["pending"]


@pytest.mark.asyncio
async def test_timeseries_fills_missing_days_with_zero(client, db_session):
    """Seria are exact `days` puncte, cu TOATE seriile; zilele goale sunt 0."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(
        f"{ADMIN}/stats/timeseries", params={"days": 7}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    points = resp.json()

    assert len(points) == 7, "Zilele goale trebuie completate cu 0, nu omise."
    # UTC, NU `date.today()`: seria e construită server-side în UTC
    # (`admin_service._now()`). Cu ora locală, testul pica în fiecare seară după
    # ora 21:00 pe UTC+3 — data locală trecea în ziua următoare înaintea celei UTC.
    assert points[-1]["date"] == datetime.now(timezone.utc).date().isoformat()
    # Adminul a fost creat azi → ultimul punct are cel puțin un user.
    assert points[-1]["users"] >= 1
    # Un singur apel alimentează toate graficele dashboard-ului.
    for key in ("users", "matches", "reports", "revenue_eur"):
        assert key in points[0]


@pytest.mark.asyncio
async def test_metric_series_and_unknown_metric_rejected(client, db_session):
    """Seria pe O metrică + allowlist: o metrică necunoscută nu ajunge în SQL."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(
        f"{ADMIN}/stats/timeseries/users", params={"days": 5}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["metric"] == "users"
    assert len(data["points"]) == 5
    assert data["total"] == sum(p["count"] for p in data["points"])

    # Metrică inventată / tentativă de injecție → 422, niciodată interpolată.
    resp = await client.get(
        f"{ADMIN}/stats/timeseries/users;DROP TABLE users", headers=headers
    )
    assert resp.status_code == 422, resp.text


# --------------------------------------------------------------------------- #
# 2. Useri
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_list_users_search_and_filters(client, db_session):
    """Căutarea lovește emailul ȘI numele; filtrele se combină."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "ana.pop@example.com")
    await _register(client, "bogdan@example.com")
    ana = await _get_user(db_session, "ana.pop@example.com")
    bogdan = await _get_user(db_session, "bogdan@example.com")
    await _make_profile(db_session, ana, "Ana Maria", verified=True)
    await _make_profile(db_session, bogdan, "Bogdan", completed=False)

    # Căutare după EMAIL.
    resp = await client.get(f"{ADMIN}/users", params={"q": "ana.pop"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert [u["email"] for u in resp.json()] == ["ana.pop@example.com"]

    # Căutare după NUMELE din anketă (userul e găsit deși emailul nu se potrivește).
    resp = await client.get(f"{ADMIN}/users", params={"q": "Bogdan"}, headers=headers)
    assert [u["email"] for u in resp.json()] == ["bogdan@example.com"]

    # Filtru: doar verificați.
    resp = await client.get(f"{ADMIN}/users", params={"verified": True}, headers=headers)
    assert [u["email"] for u in resp.json()] == ["ana.pop@example.com"]

    # Filtru: doar admini.
    resp = await client.get(f"{ADMIN}/users", params={"role": "admin"}, headers=headers)
    assert [u["email"] for u in resp.json()] == ["admin@flrt.md"]


@pytest.mark.asyncio
async def test_list_users_search_wildcards_are_escaped(client, db_session):
    """Un `%` din căutare NU are voie să întoarcă toată tabela (DoS din UI)."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "victim@example.com")

    resp = await client.get(f"{ADMIN}/users", params={"q": "%"}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == [], "`%` a fost interpretat ca wildcard LIKE, nu ca text."


@pytest.mark.asyncio
async def test_user_detail_includes_activity_and_reports(client, db_session):
    """Fișa userului agregă rapoartele (total + raportori DISTINCȚI) și activitatea."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "target@example.com")
    await _register(client, "r1@example.com")
    target = await _get_user(db_session, "target@example.com")
    r1 = await _get_user(db_session, "r1@example.com")
    await _make_profile(db_session, target, "Target")

    # Doi raportori distincți, trei rapoarte (r1 raportează de două ori, alt motiv).
    db_session.add_all(
        [
            Report(reporter_id=r1.id, reported_id=target.id, category="spam"),
            Report(reporter_id=r1.id, reported_id=target.id, category="fake"),
            Report(reporter_id=admin.id, reported_id=target.id, category="spam"),
            Like(from_user_id=target.id, to_user_id=r1.id, is_like=True),
        ]
    )
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/users/{target.id}", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["email"] == "target@example.com"
    assert data["name"] == "Target"
    assert data["reports_count"] == 3
    assert data["distinct_reporters"] == 2, "Raportorii DISTINCȚI, nu rapoartele."
    assert data["likes_sent"] == 1
    assert data["matches_count"] == 0
    assert data["active_sessions"] == 1   # sesiunea creată la register


@pytest.mark.asyncio
async def test_user_detail_404(client, db_session):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    resp = await client.get(f"{ADMIN}/users/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_ban_hides_profile_and_unban_restores(client, db_session):
    """Banul ascunde profilul din feed; unban-ul îl readuce."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "spammer@example.com")
    target = await _get_user(db_session, "spammer@example.com")
    await _make_profile(db_session, target, "Spammer")

    resp = await client.post(
        f"{ADMIN}/users/{target.id}/ban",
        json={"reason": "Spam repetat în chat"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["banned_at"] is not None
    assert data["ban_reason"] == "Spam repetat în chat"
    assert data["profile_hidden"] is True

    # Login-ul contului banat e refuzat.
    resp = await client.post(
        f"{API}/auth/login", json={"email": "spammer@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 403, resp.text

    # Unban → contul redevine funcțional și reapare în feed.
    resp = await client.post(f"{ADMIN}/users/{target.id}/unban", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["banned_at"] is None
    assert data["ban_reason"] is None
    assert data["profile_hidden"] is False

    resp = await client.post(
        f"{API}/auth/login", json={"email": "spammer@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_admin_cannot_ban_or_delete_self(client, db_session):
    """Auto-ban / auto-ștergere → 400: adminul nu se poate încuia singur afară."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.post(
        f"{ADMIN}/users/{admin.id}/ban", json={"reason": "test"}, headers=headers
    )
    assert resp.status_code == 400, resp.text

    resp = await client.delete(f"{ADMIN}/users/{admin.id}", headers=headers)
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_delete_user_purges_personal_data(client, db_session):
    """Ștergerea GDPR refolosește `account_service`: datele personale dispar."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "gone@example.com")
    target = await _get_user(db_session, "gone@example.com")
    await _make_profile(db_session, target, "Gone")
    target_id = target.id

    resp = await client.delete(f"{ADMIN}/users/{target_id}", headers=headers)
    assert resp.status_code == 204, resp.text

    # Profilul e șters, contul e anonimizat (rândul rămâne, ca să nu rupă FK-uri).
    profile = await db_session.scalar(
        select(Profile).where(Profile.user_id == target_id)
    )
    assert profile is None

    user = await db_session.get(User, target_id)
    await db_session.refresh(user)
    assert user.email != "gone@example.com"
    assert user.email.endswith("@deleted.invalid")
    assert user.password_hash == ""   # nicio parolă nu se mai potrivește

    # Vechea parolă nu mai funcționează.
    resp = await client.post(
        f"{API}/auth/login", json={"email": "gone@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 401, resp.text


# --------------------------------------------------------------------------- #
# 3. Moderare
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_reports_queue_puts_pending_first(client, db_session):
    """Coada: rapoartele ÎN AȘTEPTARE primele (SLA-ul Apple de 24h)."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "bad@example.com")
    await _register(client, "reporter@example.com")
    bad = await _get_user(db_session, "bad@example.com")
    reporter = await _get_user(db_session, "reporter@example.com")
    await _make_profile(db_session, bad, "Bad Guy")

    old_resolved = Report(
        reporter_id=reporter.id, reported_id=bad.id, category="fake", status="resolved"
    )
    new_pending = Report(
        reporter_id=admin.id, reported_id=bad.id, category="spam", status="open"
    )
    db_session.add_all([old_resolved, new_pending])
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/reports", headers=headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 2
    # În așteptare primul, chiar dacă ambele au fost create în aceeași clipă.
    assert items[0]["pending"] is True
    assert items[0]["status"] == "open"
    assert items[1]["status"] == "resolved"
    # Profilul raportat vine ALĂTURAT (fără un fetch per rând din panou).
    assert items[0]["reported"]["name"] == "Bad Guy"
    assert items[0]["reported"]["email"] == "bad@example.com"
    assert items[0]["reporters_count"] == 2
    assert items[0]["total_reports"] == 2

    # `?status=open` ascunde cazurile judecate.
    resp = await client.get(f"{ADMIN}/reports", params={"status": "open"}, headers=headers)
    assert len(resp.json()) == 1
    resp = await client.get(
        f"{ADMIN}/reports", params={"status": "resolved"}, headers=headers
    )
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_auto_banned_report_stays_in_queue(client, db_session):
    """`auto_banned` NU e o stare finală: rămâne în coadă, raportat ca `open`.

    Auto-ascunderea (pragul de raportori distincți) e o măsură automată de urgență.
    Apple (Guideline 1.2) cere un răspuns UMAN — deci exact cazurile cele mai grave
    nu au voie să dispară din coada moderatorului.
    """
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "bad@example.com")
    bad = await _get_user(db_session, "bad@example.com")
    await _make_profile(db_session, bad, "Bad")

    db_session.add(
        Report(
            reporter_id=admin.id,
            reported_id=bad.id,
            category="obscene",
            status="auto_banned",
        )
    )
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/reports", params={"status": "open"}, headers=headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1, "Un raport auto_banned a dispărut din coada umană."
    assert items[0]["status"] == "open"
    assert items[0]["pending"] is True


@pytest.mark.asyncio
async def test_resolve_report_ban_closes_all_pending_reports(client, db_session):
    """`ban_user` banează ȘI închide toate rapoartele în așteptare pe acel user."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "bad@example.com")
    await _register(client, "reporter@example.com")
    bad = await _get_user(db_session, "bad@example.com")
    reporter = await _get_user(db_session, "reporter@example.com")
    await _make_profile(db_session, bad, "Bad Guy")

    r1 = Report(reporter_id=reporter.id, reported_id=bad.id, category="spam")
    r2 = Report(reporter_id=admin.id, reported_id=bad.id, category="offensive")
    db_session.add_all([r1, r2])
    await db_session.commit()

    resp = await client.post(
        f"{ADMIN}/reports/{r1.id}/resolve",
        json={"action": "ban_user", "reason": "Conținut abuziv"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["pending"] is False

    # Userul e banat...
    await db_session.refresh(bad)
    assert bad.banned_at is not None
    assert bad.ban_reason == "Conținut abuziv"

    # ...și AMBELE rapoarte sunt închise (nu doar cel pe care s-a dat click).
    resp = await client.get(
        f"{ADMIN}/reports", params={"pending_only": True}, headers=headers
    )
    assert resp.json() == [], "Rapoartele rămase în așteptare umflă artificial coada."


@pytest.mark.asyncio
async def test_resolve_report_dismiss_leaves_user_untouched(client, db_session):
    """`dismiss` închide raportul fără să atingă contul raportat."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "innocent@example.com")
    innocent = await _get_user(db_session, "innocent@example.com")
    await _make_profile(db_session, innocent, "Innocent")

    report = Report(reporter_id=admin.id, reported_id=innocent.id, category="spam")
    db_session.add(report)
    await db_session.commit()

    resp = await client.post(
        f"{ADMIN}/reports/{report.id}/resolve",
        json={"action": "dismiss", "reason": "Raport nefondat"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(innocent)
    assert innocent.banned_at is None, "`dismiss` nu are voie să banéze pe nimeni."


@pytest.mark.asyncio
async def test_resolve_report_hide_profile(client, db_session):
    """`hide_profile` ascunde din feed fără a tăia accesul (măsură blândă)."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "borderline@example.com")
    target = await _get_user(db_session, "borderline@example.com")
    await _make_profile(db_session, target, "Borderline")

    report = Report(reporter_id=admin.id, reported_id=target.id, category="obscene")
    db_session.add(report)
    await db_session.commit()

    resp = await client.post(
        f"{ADMIN}/reports/{report.id}/resolve",
        json={"action": "hide_profile", "reason": "Poză la limită"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    await db_session.refresh(target)
    assert target.banned_at is None, "hide_profile NU banează."

    detail = await client.get(f"{ADMIN}/users/{target.id}", headers=headers)
    assert detail.json()["profile_hidden"] is True


@pytest.mark.asyncio
async def test_user_reports_history(client, db_session):
    """`GET /admin/users/{id}/reports` — istoricul reclamațiilor contra userului."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "bad@example.com")
    bad = await _get_user(db_session, "bad@example.com")
    await _make_profile(db_session, bad, "Bad")

    db_session.add(Report(reporter_id=admin.id, reported_id=bad.id, category="spam"))
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/users/{bad.id}/reports", headers=headers)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 1
    assert items[0]["category"] == "spam"
    assert items[0]["reported_id"] == str(bad.id)


# --------------------------------------------------------------------------- #
# 4. Evenimente (golul funcțional: nu exista NICIO cale de a crea unul)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_event_crud_full_cycle(client, db_session):
    """Creare → apare în `/events` public → editare parțială → ștergere."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    user_headers = await _register(client, "u@example.com")

    starts_at = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "Flirt Party Real",
            "description": "Prima petrecere creată din panou.",
            "starts_at": starts_at,
            "city": "Chișinău",
            "venue": "Club Nova",
            "kind": "flirt_party",
            "lat": 47.0245,
            "lng": 28.8322,
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    event_id = resp.json()["id"]
    assert resp.json()["title"] == "Flirt Party Real"

    # Evenimentul creat din panou e VIZIBIL în API-ul public.
    resp = await client.get(f"{API}/events/", headers=user_headers)
    assert any(e["id"] == event_id for e in resp.json())

    # Editare PARȚIALĂ: schimbăm doar orașul — descrierea NU trebuie ștearsă.
    resp = await client.put(
        f"{ADMIN}/events/{event_id}", json={"city": "Bălți"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["city"] == "Bălți"
    assert resp.json()["description"] == "Prima petrecere creată din panou.", (
        "PUT parțial a șters un câmp netrimis (exclude_unset lipsește)."
    )

    # Ștergere.
    resp = await client.delete(f"{ADMIN}/events/{event_id}", headers=headers)
    assert resp.status_code == 204, resp.text
    resp = await client.get(f"{ADMIN}/events", headers=headers)
    assert all(e["id"] != event_id for e in resp.json())


@pytest.mark.asyncio
async def test_delete_event_removes_attendances(client, db_session):
    """Ștergerea unui eveniment nu lasă participări orfane (SQLite nu cascadează)."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    ev = Event(
        title="Ephemeral",
        starts_at=datetime.now(timezone.utc) + timedelta(days=1),
        city="Chișinău",
        kind="other",
    )
    db_session.add(ev)
    await db_session.flush()
    db_session.add(EventAttendance(event_id=ev.id, user_id=admin.id, going=True))
    await db_session.commit()
    event_id = ev.id

    resp = await client.delete(f"{ADMIN}/events/{event_id}", headers=headers)
    assert resp.status_code == 204, resp.text

    orphans = (
        await db_session.execute(
            select(EventAttendance).where(EventAttendance.event_id == event_id)
        )
    ).scalars().all()
    assert orphans == [], "Participări orfane către un eveniment inexistent."


@pytest.mark.asyncio
async def test_event_validation_rejects_bad_input(client, db_session):
    """Coordonate imposibile / tip necunoscut → 422, nu date corupte în DB."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    starts_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

    resp = await client.post(
        f"{ADMIN}/events",
        json={"title": "X", "starts_at": starts_at, "city": "C", "lat": 500.0},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    resp = await client.post(
        f"{ADMIN}/events",
        json={"title": "X", "starts_at": starts_at, "city": "C", "kind": "hacking"},
        headers=headers,
    )
    assert resp.status_code == 422, resp.text

    # XSS stocat: tag-urile HTML sunt respinse de validatorii proiectului.
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "<script>alert(1)</script>",
            "starts_at": starts_at,
            "city": "C",
        },
        headers=headers,
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_update_event_404_and_empty_payload(client, db_session):
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.put(
        f"{ADMIN}/events/{uuid.uuid4()}", json={"city": "X"}, headers=headers
    )
    assert resp.status_code == 404, resp.text


# --------------------------------------------------------------------------- #
# 5. Abonamente
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_grant_subscription_activates_entitlements(client, db_session):
    """Abonamentul acordat manual produce DREPTURI reale pentru user."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    user_headers = await _register(client, "vip@example.com")
    vip = await _get_user(db_session, "vip@example.com")

    resp = await client.post(
        f"{ADMIN}/users/{vip.id}/grant-subscription",
        json={"plan": "premium", "days": 60, "reason": "Compensație suport"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["plan"] == "premium"
    assert data["is_active"] is True
    assert data["provider"] == "manual", (
        "Abonamentele DĂRUITE nu trebuie confundate cu cele PLĂTITE în raportări."
    )

    # Userul chiar primește drepturile (nu doar un rând în tabelă).
    resp = await client.get(f"{API}/subscriptions/entitlements", headers=user_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["premium"] is True

    # Apare în listarea de abonamente.
    resp = await client.get(f"{ADMIN}/subscriptions", headers=headers)
    assert resp.status_code == 200, resp.text
    assert [s["user_email"] for s in resp.json()] == ["vip@example.com"]


@pytest.mark.asyncio
async def test_grant_subscription_rejects_unknown_plan_and_caps_days(client, db_session):
    """Plan inventat → 400. Durată absurdă → plafonată la `admin_grant_max_days`."""
    from app.core.config import settings

    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    user_headers = await _register(client, "vip@example.com")
    vip = await _get_user(db_session, "vip@example.com")

    resp = await client.post(
        f"{ADMIN}/users/{vip.id}/grant-subscription",
        json={"plan": "gold_infinite"},
        headers=headers,
    )
    assert resp.status_code == 400, resp.text

    # `days=36500` (100 de ani) e plafonat, nu acceptat.
    resp = await client.post(
        f"{ADMIN}/users/{vip.id}/grant-subscription",
        json={"plan": "premium", "days": 36500},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    expires = datetime.fromisoformat(resp.json()["expires_at"])
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    max_expected = datetime.now(timezone.utc) + timedelta(
        days=settings.admin_grant_max_days + 1
    )
    assert expires < max_expected, "Durata acordării nu a fost plafonată."


# --------------------------------------------------------------------------- #
# 6. Login de admin + jurnal de audit
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_admin_login_works_and_is_audited(client, db_session):
    """`POST /admin/login` emite token-uri și scrie `admin.login` în jurnal."""
    await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.post(
        f"{ADMIN}/login", json={"email": "admin@flrt.md", "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    assert "access_token" in resp.json()

    entry = await db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.action == "admin.login")
    )
    assert entry is not None, "Autentificarea de admin nu a fost auditată."
    assert entry.actor_email == "admin@flrt.md"


@pytest.mark.asyncio
async def test_admin_login_rejects_normal_user_with_403(client, db_session):
    """Un user obișnuit cu parolă CORECTĂ nu intră în panou (403, nu 200)."""
    await _register(client, "normal@example.com")

    resp = await client.post(
        f"{ADMIN}/login", json={"email": "normal@example.com", "password": PASSWORD}
    )
    assert resp.status_code == 403, resp.text
    assert "access_token" not in resp.text


@pytest.mark.asyncio
async def test_admin_login_wrong_password_is_401(client, db_session):
    """Credențiale greșite → 401 generic (fără oracol de enumerare)."""
    await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.post(
        f"{ADMIN}/login", json={"email": "admin@flrt.md", "password": "Wrong-Pass1!"}
    )
    assert resp.status_code == 401, resp.text

    # Un email inexistent primește EXACT același răspuns.
    resp2 = await client.post(
        f"{ADMIN}/login", json={"email": "nobody@flrt.md", "password": "Wrong-Pass1!"}
    )
    assert resp2.status_code == 401
    assert resp.json() == resp2.json()


@pytest.mark.asyncio
async def test_admin_me_returns_role(client, db_session):
    """`GET /admin/me` — panoul află rolul (│`/auth/me` NU expune `role`)."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(f"{ADMIN}/me", headers=headers)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data == {"id": str(admin.id), "email": "admin@flrt.md", "role": "admin"}


@pytest.mark.asyncio
async def test_grant_subscription_by_email(client, db_session):
    """`POST /admin/subscriptions` — acordare după EMAIL (forma folosită de panou)."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "vip@example.com")

    resp = await client.post(
        f"{ADMIN}/subscriptions",
        json={"email": "vip@example.com", "plan": "premium", "days": 30},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["user_email"] == "vip@example.com"
    assert resp.json()["is_active"] is True

    # Email inexistent → 404 clar, nu o acordare tăcută către nimeni.
    resp = await client.post(
        f"{ADMIN}/subscriptions",
        json={"email": "nobody@example.com", "plan": "premium", "days": 30},
        headers=headers,
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["ban", "ban_user"])
async def test_resolve_accepts_short_and_long_action_names(client, db_session, action):
    """`ban` (panou) și `ban_user` (spec backend) descriu ACEEAȘI decizie."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "bad@example.com")
    bad = await _get_user(db_session, "bad@example.com")
    await _make_profile(db_session, bad, "Bad")

    report = Report(reporter_id=admin.id, reported_id=bad.id, category="spam")
    db_session.add(report)
    await db_session.commit()

    resp = await client.post(
        f"{ADMIN}/reports/{report.id}/resolve",
        json={"action": action, "reason": "abuz"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "resolved"

    await db_session.refresh(bad)
    assert bad.banned_at is not None


@pytest.mark.asyncio
async def test_audit_log_is_readable_and_filterable(client, db_session):
    """Jurnalul se citește, cu filtre pe acțiune și pe țintă."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "target@example.com")
    target = await _get_user(db_session, "target@example.com")

    await client.post(
        f"{ADMIN}/users/{target.id}/ban", json={"reason": "test"}, headers=headers
    )

    resp = await client.get(f"{ADMIN}/audit-log", headers=headers)
    assert resp.status_code == 200, resp.text
    entries = resp.json()
    assert any(e["action"] == "user.ban" for e in entries)

    # Filtru pe țintă: istoricul acțiunilor asupra unui user anume.
    resp = await client.get(
        f"{ADMIN}/audit-log", params={"target_id": str(target.id)}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert all(e["target_id"] == str(target.id) for e in resp.json())
    assert resp.json()[0]["actor_email"] == "admin@flrt.md"
