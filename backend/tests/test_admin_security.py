"""Teste de SECURITATE pentru panoul de administrare.

Un panou de admin spart = tot produsul spart: moderare, date personale ale tuturor
utilizatorilor, ștergeri ireversibile, acordări de abonamente. Fișierul ăsta apără
exact granițele care contează:

  1. AUTORIZARE — user obișnuit → 403, neautentificat → 401, pe FIECARE rută.
     Lista rutelor NU e scrisă de mână: e derivată din OpenAPI-ul aplicației, deci
     o rută de admin adăugată mâine e testată automat, fără să-și amintească
     nimeni să o adauge aici. Exact scenariul „a 21-a rută adăugată vineri seara".
  2. REVOCARE IMEDIATĂ — un admin banat sau retrogradat pierde accesul la
     următoarea cerere, nu la expirarea token-ului.
  3. BAN REAL — banarea revocă efectiv sesiunile: refresh token-ul devine
     inutilizabil ACUM, nu peste 30 de zile.
  4. ZERO SCURGERI — niciun răspuns nu conține hash-uri de parolă sau token-uri.
     Căutăm în JSON-ul BRUT, nu în câmpuri anume: o scurgere apare tocmai acolo
     unde nimeni nu s-a uitat.
  5. PLAFOANE — `?limit=999999` e respins, nu servit (DoS din interior).
  6. AUDIT — fiecare acțiune distructivă lasă o urmă în `AdminAuditLog`.

Rulează OFFLINE, pe SQLite in-memory.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.main import app
from app.models.admin import AdminAuditLog
from app.models.moderation import Report
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.user import ROLE_ADMIN, ROLE_USER, User

API = "/api/v1"
ADMIN = f"{API}/admin"
PASSWORD = "Str0ng-Passw0rd!"

_ADULT_YEAR = date.today().year - 25

# Ruta de login e SINGURA publică din pachet: nu poți cere un token de admin celui
# care tocmai încearcă să obțină unul. E testată separat (rate limit + 403 pentru
# non-admini), în `test_admin.py`.
_PUBLIC_ADMIN_PATHS = {f"{ADMIN}/login"}


# --------------------------------------------------------------------------- #
# Descoperirea AUTOMATĂ a rutelor de admin
# --------------------------------------------------------------------------- #
def _admin_operations() -> list[tuple[str, str]]:
    """Toate operațiile `/api/v1/admin/*` PROTEJATE, citite din OpenAPI.

    DE CE derivăm lista în loc să o scriem de mână: o listă scrisă de mână
    testează rutele pe care ni le AMINTIM. Cea derivată testează rutele care
    EXISTĂ. Diferența dintre ele e exact locul unde apare gaura de securitate —
    o rută nouă, adăugată fără dependency-ul de autorizare, ar trece neobservată
    printr-o listă statică, dar cade instantaneu aici.
    """
    spec = app.openapi()
    operations: list[tuple[str, str]] = []
    for path, methods in spec["paths"].items():
        if not path.startswith(f"{ADMIN}/") and path != ADMIN:
            continue
        if path in _PUBLIC_ADMIN_PATHS:
            continue
        for method in methods:
            operations.append((method.upper(), path))
    assert operations, "Nu am găsit nicio rută de admin în OpenAPI."
    return sorted(operations)


def _concrete(path: str) -> str:
    """Înlocuiește parametrii de cale cu valori valide sintactic.

    Autorizarea se verifică ÎNAINTEA existenței resursei: un UUID inexistent
    trebuie să dea tot 401/403, niciodată 404 (un 404 ar confirma unui atacator
    neautorizat că ruta e reală și l-ar lăsa să enumere id-uri).
    """
    return (
        path.replace("{user_id}", str(uuid.uuid4()))
        .replace("{report_id}", str(uuid.uuid4()))
        .replace("{event_id}", str(uuid.uuid4()))
        .replace("{metric}", "users")
    )


ADMIN_OPERATIONS = _admin_operations()


async def _call(client, method: str, path: str, headers: dict | None = None):
    """Lovește o rută de admin cu un corp gol.

    Corpul gol e intenționat: dependency-urile de autorizare rulează ÎNAINTEA
    validării corpului, deci un 422 în loc de 401/403 ar însemna că poarta de
    acces se deschide înainte de a verifica cine bate la ea.
    """
    return await client.request(method, _concrete(path), headers=headers, json={})


# --------------------------------------------------------------------------- #
# Helperi de date
# --------------------------------------------------------------------------- #
async def _register(client, email: str) -> dict:
    resp = await client.post(
        f"{API}/auth/register", json={"email": email, "password": PASSWORD}
    )
    assert resp.status_code in (200, 201), resp.text
    return resp.json()


async def _headers(client, email: str) -> dict:
    tokens = await _register(client, email)
    return {"Authorization": f"Bearer {tokens['access_token']}"}


async def _get_user(db, email: str) -> User:
    return await db.scalar(select(User).where(User.email == email))


async def _make_admin(client, db, email: str) -> tuple[dict, User]:
    headers = await _headers(client, email)
    user = await _get_user(db, email)
    user.role = ROLE_ADMIN
    await db.commit()
    return headers, user


# --------------------------------------------------------------------------- #
# 1. AUTORIZARE — pe FIECARE rută (parametrizat, nu 20 de teste copiate)
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", ADMIN_OPERATIONS)
async def test_unauthenticated_gets_401(client, method, path):
    """Fără token → 401 pe FIECARE rută de admin."""
    resp = await _call(client, method, path)
    assert resp.status_code == 401, (
        f"{method} {path} a răspuns {resp.status_code} unui client NEAUTENTIFICAT "
        f"(aștept 401). Corp: {resp.text[:200]}"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("method,path", ADMIN_OPERATIONS)
async def test_normal_user_gets_403(client, db_session, method, path):
    """Token valid de user OBIȘNUIT → 403 pe FIECARE rută de admin.

    Nu 200, nu 404, nu 422: 403. Un user autentificat nu are voie să afle nici
    măcar dacă resursa există.
    """
    headers = await _headers(client, "normal@example.com")

    resp = await _call(client, method, path, headers)
    assert resp.status_code == 403, (
        f"{method} {path} a răspuns {resp.status_code} unui USER OBIȘNUIT "
        f"(aștept 403). Corp: {resp.text[:200]}"
    )


@pytest.mark.asyncio
async def test_invalid_and_malformed_tokens_get_401(client):
    """Token fabricat / stricat / de alt tip → 401, niciodată acces."""
    for bad in (
        "Bearer not-a-jwt",
        "Bearer ",
        "Basic YWRtaW46YWRtaW4=",   # basic auth în loc de bearer
        "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZG1pbiJ9.",  # alg=none
    ):
        resp = await client.get(f"{ADMIN}/stats", headers={"Authorization": bad})
        assert resp.status_code == 401, f"Token {bad!r} a primit {resp.status_code}."


# --------------------------------------------------------------------------- #
# 2. REVOCARE IMEDIATĂ a drepturilor
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_demoted_admin_loses_access_immediately(client, db_session):
    """Rol retras → acces pierdut la URMĂTOAREA cerere, cu ACELAȘI token.

    Rolul e citit din DB la fiecare cerere, nu dintr-un claim din JWT. Dacă ar fi
    fost în token, un admin demis ar fi rămas admin până la expirarea lui (15 min).
    """
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    assert (await client.get(f"{ADMIN}/stats", headers=headers)).status_code == 200

    admin.role = ROLE_USER
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    assert resp.status_code == 403, "Un admin retrogradat a păstrat accesul la panou."


@pytest.mark.asyncio
async def test_banned_admin_loses_access_immediately(client, db_session):
    """Admin banat → 403, chiar cu un token emis înainte de ban."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    assert (await client.get(f"{ADMIN}/stats", headers=headers)).status_code == 200

    admin.banned_at = datetime.now(timezone.utc)
    admin.ban_reason = "cont compromis"
    await db_session.commit()

    resp = await client.get(f"{ADMIN}/stats", headers=headers)
    assert resp.status_code == 403, "Un admin BANAT a păstrat accesul la panou."


# --------------------------------------------------------------------------- #
# 3. BANUL E REAL: revocă sesiunile
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_ban_revokes_refresh_sessions(client, db_session):
    """Banarea invalidează REFRESH token-ul, nu doar access token-ul.

    Fără asta, banul ar fi fost teatru: access token-ul expiră în 15 minute, dar
    refresh token-ul e o creanță de 30 de zile. Un cont banat care poate roti
    refresh-ul continuă să folosească aplicația o lună.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    tokens = await _register(client, "spammer@example.com")
    target = await _get_user(db_session, "spammer@example.com")

    # Înainte de ban: refresh-ul funcționează.
    resp = await client.post(
        f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert resp.status_code == 200, resp.text
    fresh_refresh = resp.json()["refresh_token"]
    fresh_access = resp.json()["access_token"]

    # Ban.
    resp = await client.post(
        f"{ADMIN}/users/{target.id}/ban", json={"reason": "spam"}, headers=headers
    )
    assert resp.status_code == 200, resp.text

    # Refresh token-ul PROASPĂT (emis înainte de ban) nu mai merge.
    resp = await client.post(
        f"{API}/auth/refresh", json={"refresh_token": fresh_refresh}
    )
    assert resp.status_code in (401, 403), (
        "Userul banat a putut roti refresh token-ul → banul nu revocă sesiunile."
    )

    # Nici access token-ul emis înainte de ban nu mai e acceptat.
    resp = await client.get(
        f"{API}/auth/me", headers={"Authorization": f"Bearer {fresh_access}"}
    )
    assert resp.status_code == 403

    # Și în DB: nicio sesiune activă rămasă.
    active = (
        await db_session.execute(
            select(RefreshSession).where(
                RefreshSession.user_id == target.id,
                RefreshSession.revoked.is_(False),
            )
        )
    ).scalars().all()
    assert active == [], "Au rămas sesiuni de refresh nerevocate după ban."


# --------------------------------------------------------------------------- #
# 4. ZERO SCURGERI de secrete în răspunsuri
# --------------------------------------------------------------------------- #
# Ce nu are voie să apară NICIODATĂ în JSON-ul panoului. Căutăm în corpul BRUT:
# o scurgere apare exact în câmpul la care nu ne-am uitat.
FORBIDDEN_KEYS = (
    "password_hash",
    "hashed_password",
    "password",
    "token_hash",
    "jti",
    "family_id",
    "refresh_token",
    "secret",
    "private_key",
)


@pytest.mark.asyncio
async def test_no_admin_response_leaks_secrets(client, db_session):
    """Niciun răspuns de admin nu conține hash-uri de parolă sau token-uri.

    Verificăm DOUĂ lucruri, pentru că sunt eșecuri diferite:
      * numele câmpurilor (`password_hash`, `token_hash`, …) — o schemă care
        serializează modelul ORM „în bloc";
      * VALOAREA reală a hash-ului de parolă din DB — o scurgere sub un alt nume
        de câmp, pe care o listă de chei interzise nu ar prinde-o.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "victim@example.com")
    victim = await _get_user(db_session, "victim@example.com")
    db_session.add(
        Profile(
            user_id=victim.id,
            name="Victim",
            birth_date=date(_ADULT_YEAR, 1, 1),
            gender="female",
            height_cm=170,
            city="Chișinău",
            languages=["ro"],
            dating_statuses=[],
            photos=[],
            completed=True,
        )
    )
    db_session.add(
        Report(reporter_id=victim.id, reported_id=victim.id, category="spam")
    )
    await db_session.commit()

    # Hash-ul REAL al parolei victimei, exact cum e stocat în DB.
    real_hash = victim.password_hash
    assert real_hash, "Fixtura e ruptă: userul nu are hash de parolă."

    # Sesiunea de refresh a victimei (hash-ul token-ului) — al doilea secret.
    session_row = await db_session.scalar(
        select(RefreshSession).where(RefreshSession.user_id == victim.id)
    )
    real_token_hash = session_row.token_hash

    endpoints = [
        f"{ADMIN}/me",
        f"{ADMIN}/stats",
        f"{ADMIN}/stats/timeseries?days=3",
        f"{ADMIN}/stats/timeseries/users",
        f"{ADMIN}/users",
        f"{ADMIN}/users/{victim.id}",
        f"{ADMIN}/users/{victim.id}/reports",
        f"{ADMIN}/reports",
        f"{ADMIN}/events",
        f"{ADMIN}/subscriptions",
        f"{ADMIN}/audit-log",
    ]

    for url in endpoints:
        resp = await client.get(url, headers=headers)
        assert resp.status_code == 200, f"{url} → {resp.status_code}: {resp.text[:200]}"
        raw = resp.text
        lowered = raw.lower()

        for key in FORBIDDEN_KEYS:
            assert key not in lowered, f"{url} expune câmpul interzis `{key}`."

        assert real_hash not in raw, (
            f"{url} a scurs HASH-UL DE PAROLĂ al unui user (sub alt nume de câmp)."
        )
        assert real_token_hash not in raw, (
            f"{url} a scurs hash-ul unui refresh token."
        )


@pytest.mark.asyncio
async def test_ban_and_grant_responses_do_not_leak_secrets(client, db_session):
    """Nici răspunsurile rutelor de SCRIERE nu scurg secrete."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "victim@example.com")
    victim = await _get_user(db_session, "victim@example.com")
    real_hash = victim.password_hash

    responses = [
        await client.post(
            f"{ADMIN}/users/{victim.id}/grant-subscription",
            json={"plan": "premium"},
            headers=headers,
        ),
        await client.post(
            f"{ADMIN}/users/{victim.id}/ban",
            json={"reason": "spam"},
            headers=headers,
        ),
        await client.post(f"{ADMIN}/users/{victim.id}/unban", headers=headers),
    ]
    for resp in responses:
        assert resp.status_code == 200, resp.text
        lowered = resp.text.lower()
        for key in FORBIDDEN_KEYS:
            assert key not in lowered, f"Răspuns de scriere cu câmpul `{key}`."
        assert real_hash not in resp.text


# --------------------------------------------------------------------------- #
# 5. PLAFOANE de paginare (DoS din interior)
# --------------------------------------------------------------------------- #
PAGINATED_ENDPOINTS = [
    f"{ADMIN}/users",
    f"{ADMIN}/reports",
    f"{ADMIN}/events",
    f"{ADMIN}/subscriptions",
    f"{ADMIN}/audit-log",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("url", PAGINATED_ENDPOINTS)
async def test_absurd_limit_is_rejected(client, db_session, url):
    """`?limit=999999` e RESPINS (422), nu servit.

    Un admin — sau un cont de admin compromis — nu are voie să ceară „toate cele
    2 milioane de rânduri" dintr-o singură cerere.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(url, params={"limit": 999999}, headers=headers)
    assert resp.status_code == 422, (
        f"{url} a ACCEPTAT limit=999999 ({resp.status_code}) — plafonul lipsește."
    )

    # Nici valorile negative / zero nu trec.
    resp = await client.get(url, params={"limit": 0}, headers=headers)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_limit_is_capped_at_admin_max(client, db_session):
    """Chiar la limita maximă permisă, pagina nu depășește `admin_max_limit`."""
    from app.core.config import settings

    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")

    # Mai mulți useri decât încape într-o pagină maximă.
    for i in range(settings.admin_max_limit + 5):
        db_session.add(User(email=f"bulk{i}@example.com", password_hash="x"))
    await db_session.commit()

    resp = await client.get(
        f"{ADMIN}/users", params={"limit": settings.admin_max_limit}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    assert len(resp.json()) <= settings.admin_max_limit
    # Mai există date → cursorul de continuare e prezent.
    assert resp.headers.get("X-Next-Cursor"), "Lipsește X-Next-Cursor pe o listă trunchiată."


@pytest.mark.asyncio
async def test_forged_cursor_is_rejected(client, db_session):
    """Un cursor fabricat nu poate injecta nimic — 422, nu 500."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(
        f"{ADMIN}/users", params={"cursor": "'; DROP TABLE users;--"}, headers=headers
    )
    assert resp.status_code == 422, resp.text

    # Și userii sunt tot acolo (tabela nu a fost atinsă).
    resp = await client.get(f"{ADMIN}/users", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio
async def test_timeseries_days_is_capped(client, db_session):
    """`?days=1000000` e respins: fiecare zi e un bucket agregat (DoS)."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    resp = await client.get(
        f"{ADMIN}/stats/timeseries", params={"days": 1_000_000}, headers=headers
    )
    assert resp.status_code == 422, resp.text


# --------------------------------------------------------------------------- #
# 6. AUDIT — fiecare acțiune distructivă lasă o urmă
# --------------------------------------------------------------------------- #
async def _audit_actions(db) -> list[str]:
    rows = (await db.execute(select(AdminAuditLog.action))).scalars().all()
    return list(rows)


@pytest.mark.asyncio
async def test_every_destructive_action_is_audited(client, db_session):
    """Ban, unban, resolve, CRUD eveniment, grant, ștergere → toate în jurnal.

    Un singur test care execută TOATE acțiunile care schimbă starea și verifică la
    final că fiecare și-a lăsat urma. Dacă cineva adaugă mâine o acțiune fără
    audit, ea nu apare în lista de mai jos și testul cade.
    """
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "target@example.com")
    await _register(client, "doomed@example.com")
    target = await _get_user(db_session, "target@example.com")
    doomed = await _get_user(db_session, "doomed@example.com")

    report = Report(reporter_id=admin.id, reported_id=target.id, category="spam")
    db_session.add(report)
    await db_session.commit()

    starts_at = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()

    # 1. ban → 2. unban
    assert (
        await client.post(
            f"{ADMIN}/users/{target.id}/ban", json={"reason": "spam"}, headers=headers
        )
    ).status_code == 200
    assert (
        await client.post(f"{ADMIN}/users/{target.id}/unban", headers=headers)
    ).status_code == 200

    # 3. rezolvare raport (dismiss — nu vrem să rebanăm ținta)
    assert (
        await client.post(
            f"{ADMIN}/reports/{report.id}/resolve",
            json={"action": "dismiss", "reason": "nefondat"},
            headers=headers,
        )
    ).status_code == 200

    # 4. creare → 5. editare → 6. ștergere eveniment
    resp = await client.post(
        f"{ADMIN}/events",
        json={"title": "Audit Party", "starts_at": starts_at, "city": "Chișinău"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    event_id = resp.json()["id"]
    assert (
        await client.put(
            f"{ADMIN}/events/{event_id}", json={"city": "Bălți"}, headers=headers
        )
    ).status_code == 200
    assert (
        await client.delete(f"{ADMIN}/events/{event_id}", headers=headers)
    ).status_code == 204

    # 7. acordare abonament
    assert (
        await client.post(
            f"{ADMIN}/users/{target.id}/grant-subscription",
            json={"plan": "premium"},
            headers=headers,
        )
    ).status_code == 200

    # 8. ștergere GDPR
    assert (
        await client.delete(f"{ADMIN}/users/{doomed.id}", headers=headers)
    ).status_code == 204

    actions = await _audit_actions(db_session)
    for expected in (
        "user.ban",
        "user.unban",
        "report.resolve",
        "event.create",
        "event.update",
        "event.delete",
        "subscription.grant",
        "user.delete",
    ):
        assert expected in actions, (
            f"Acțiunea `{expected}` NU a fost auditată. Jurnal: {sorted(set(actions))}"
        )


@pytest.mark.asyncio
async def test_audit_entry_records_who_what_and_why(client, db_session):
    """Intrarea de audit are autorul, ținta, motivul și IP-ul — nu doar `action`."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "target@example.com")
    target = await _get_user(db_session, "target@example.com")

    resp = await client.post(
        f"{ADMIN}/users/{target.id}/ban",
        json={"reason": "Comportament abuziv repetat"},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text

    entry = await db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.action == "user.ban")
    )
    assert entry is not None
    assert entry.actor_id == admin.id
    assert entry.actor_email == "admin@flrt.md"      # denormalizat, supraviețuiește
    assert entry.target_type == "user"
    assert entry.target_id == target.id
    assert entry.meta["reason"] == "Comportament abuziv repetat"
    assert entry.ip is not None

    # Și, mai ales: NICIUN secret în `meta`.
    serialized = str(entry.meta).lower()
    for key in FORBIDDEN_KEYS:
        assert key not in serialized


@pytest.mark.asyncio
async def test_audit_survives_deletion_of_its_target(client, db_session):
    """Jurnalul supraviețuiește ștergerii țintei (fără FK pe `target_id`).

    Dacă `target_id` ar fi avut o cheie externă cu CASCADE, ștergerea unui cont ar
    fi ȘTERS chiar intrarea care o consemnează — adică singura acțiune pe care e
    esențial să o poți audita ar fi fost și singura care nu lasă urmă.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "doomed@example.com")
    doomed = await _get_user(db_session, "doomed@example.com")
    doomed_id = doomed.id

    assert (
        await client.delete(f"{ADMIN}/users/{doomed_id}", headers=headers)
    ).status_code == 204

    entry = await db_session.scalar(
        select(AdminAuditLog).where(AdminAuditLog.action == "user.delete")
    )
    assert entry is not None, "Ștergerea GDPR nu a lăsat nicio urmă în jurnal."
    assert entry.target_id == doomed_id
    # Emailul original e păstrat în jurnal, deși contul a fost anonimizat în DB.
    assert entry.meta["email"] == "doomed@example.com"


@pytest.mark.asyncio
async def test_audit_log_has_no_write_endpoint(client, db_session):
    """Jurnalul e APPEND-ONLY: nu există rută de ștergere sau editare.

    Un jurnal pe care adminul suspect îl poate curăța nu e un jurnal.
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")

    for method in ("DELETE", "PUT", "PATCH", "POST"):
        resp = await client.request(
            method, f"{ADMIN}/audit-log", headers=headers, json={}
        )
        assert resp.status_code == 405, (
            f"{method} /admin/audit-log a răspuns {resp.status_code} — "
            "jurnalul NU trebuie să fie modificabil prin API."
        )


# --------------------------------------------------------------------------- #
# 7. Injecție / input ostil
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_sql_injection_in_search_is_inert(client, db_session):
    """Textul de căutare e un PARAMETRU LEGAT, nu SQL concatenat."""
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "victim@example.com")

    for payload in (
        "'; DROP TABLE users;--",
        "' OR '1'='1",
        "%' OR 1=1--",
        "_",           # wildcard LIKE cu un singur caracter
        "%",           # wildcard LIKE „orice"
    ):
        resp = await client.get(f"{ADMIN}/users", params={"q": payload}, headers=headers)
        assert resp.status_code == 200, f"{payload!r} → {resp.status_code}"
        # Niciun payload nu are voie să întoarcă TOȚI userii.
        assert resp.json() == [], (
            f"Căutarea {payload!r} a întors rânduri → wildcard-ul LIKE nu e escapat "
            "sau inputul ajunge în SQL."
        )

    # Tabela există în continuare.
    resp = await client.get(f"{ADMIN}/users", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 2   # adminul + victima


@pytest.mark.asyncio
async def test_stored_xss_is_rejected_on_admin_writes(client, db_session):
    """Textele scrise din panou sunt curățate: fără HTML/`<script>` stocat.

    Datele astea ajung în UI-ul de admin. Chiar dacă React escapează implicit,
    validarea pe backend e a doua barieră — singura care rezistă când conținutul e
    consumat de altceva decât React (export CSV, email, log).
    """
    headers, _ = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "target@example.com")
    target = await _get_user(db_session, "target@example.com")

    resp = await client.post(
        f"{ADMIN}/users/{target.id}/ban",
        json={"reason": "<script>alert(document.cookie)</script>"},
        headers=headers,
    )
    assert resp.status_code == 422, "Motivul banului a acceptat marcaj HTML."

    starts_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    resp = await client.post(
        f"{ADMIN}/events",
        json={
            "title": "OK",
            "starts_at": starts_at,
            "city": "Chișinău",
            "description": "<img src=x onerror=alert(1)>",
        },
        headers=headers,
    )
    assert resp.status_code == 422, "Descrierea evenimentului a acceptat marcaj HTML."


@pytest.mark.asyncio
async def test_admin_cannot_escalate_via_moderation_on_self(client, db_session):
    """Un admin nu se poate bana/ascunde pe sine printr-un raport (auto-lockout)."""
    headers, admin = await _make_admin(client, db_session, "admin@flrt.md")
    await _register(client, "hater@example.com")
    hater = await _get_user(db_session, "hater@example.com")

    report = Report(reporter_id=hater.id, reported_id=admin.id, category="spam")
    db_session.add(report)
    await db_session.commit()

    resp = await client.post(
        f"{ADMIN}/reports/{report.id}/resolve",
        json={"action": "ban", "reason": "x"},
        headers=headers,
    )
    assert resp.status_code == 400, resp.text

    await db_session.refresh(admin)
    assert admin.banned_at is None
