"""Logica panoului de administrare (`/api/v1/admin/*`).

TREI REGULI care structurează tot fișierul:

1. STATISTICILE SE CALCULEAZĂ ÎN SQL, NU ÎN PYTHON.
   Proiectul a plătit deja lecția asta pe `GET /chats` (604 query-uri → 6).
   Un dashboard care ar face `select(User)` și apoi ar număra în Python ar
   încărca întreaga tabelă `users` în memoria procesului la fiecare refresh al
   panoului. Aici, fiecare contor e un `COUNT`/`SUM(CASE …)` agregat DB-side, iar
   `get_stats()` execută un număr CONSTANT de query-uri, indiferent dacă baza are
   100 sau 10.000.000 de rânduri. Același principiu la listări: profile, contoare
   și raportori se aduc cu `WHERE … IN (:page_ids)`, niciodată în buclă.

2. ORICE ACȚIUNE CARE SCHIMBĂ STAREA SCRIE ÎN `AdminAuditLog`.
   Ban, unban, ștergere, rezolvare de raport, CRUD de evenimente, acordare de
   abonament. Auditul se scrie în ACEEAȘI tranzacție cu acțiunea (`db.add` fără
   commit propriu — commit-ul îl face funcția publică, o singură dată). Dacă
   acțiunea eșuează, nu rămâne o intrare fantomă; dacă auditul eșuează, acțiunea
   nu se comite. Fără excepții, fără „acțiuni mici" nelogate.

3. NIMIC NU SE CONSTRUIEȘTE PRIN FORMATARE DE STRINGURI ÎN SQL.
   Numele, bio-urile și textele de căutare vin de la utilizatori și ajung în
   `WHERE`-uri. Totul trece prin parametri legați; `%` și `_` dintr-un termen de
   căutare sunt escapate explicit (vezi `_like_term`), iar `metric` din
   timeseries e ales dintr-un dicționar-allowlist de coloane, niciodată
   interpolat.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import and_, case, delete, exists, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.ratelimit import client_ip
from app.models.account import AccountDeletionRequest, UserSettings
from app.models.admin import (
    ACTION_EVENT_CREATE,
    ACTION_EVENT_DELETE,
    ACTION_EVENT_UPDATE,
    ACTION_LOGIN,
    ACTION_REPORT_RESOLVE,
    ACTION_SUBSCRIPTION_GRANT,
    ACTION_USER_BAN,
    ACTION_USER_DELETE,
    ACTION_USER_HIDE,
    ACTION_USER_UNBAN,
    AdminAuditLog,
)
from app.models.billing import Subscription
from app.models.chat import Chat, Message
from app.models.event import Event, EventAttendance, FlirtPassportStamp
from app.models.moderation import Report
from app.models.profile import Profile
from app.models.session import RefreshSession
from app.models.swipe import Like, Match
from app.models.ticket_order import STATUS_PAYMENT_DECLARED, TicketOrder
from app.models.user import ROLE_ADMIN, User
from app.schemas.admin import (
    AdminEventIn,
    AdminEventOut,
    AdminEventUpdate,
    AdminReportOut,
    AdminStats,
    AdminSubscriptionOut,
    AdminUserDetail,
    AdminUserOut,
    AuditLogOut,
    ChatStats,
    EventStats,
    GrantSubscriptionIn,
    MetricPoint,
    MetricSeriesOut,
    ProfileStats,
    ReportedProfile,
    ReportStats,
    ResolveIn,
    SubscriptionStats,
    SwipeStats,
    TimeseriesPoint,
    UserStats,
)
from app.services import account_service, billing
from app.services.pagination import (
    ADMIN_MAX_LIMIT,
    ADMIN_PAGE_LIMIT,
    clamp_limit,
    decode_cursor,
    encode_cursor,
)

# --- Stările rapoartelor de moderare -----------------------------------------
# În DB, `Report.status` poate fi:
#   'open'        — raport nou, nimeni nu s-a uitat la el;
#   'auto_banned' — pragul de raportori distincți a declanșat auto-ascunderea
#                   (scris de `moderation_service._auto_ban`);
#   'resolved'    — un OM a decis și a aplicat o măsură;
#   'dismissed'   — un OM a decis că raportul e nefondat.
#
# ATENȚIE la semantica lui `auto_banned`: NU e o stare finală. Auto-ascunderea e o
# măsură automată de urgență, dar Apple (Guideline 1.2) cere un răspuns UMAN la
# raportările de conținut abuziv în ≤24h. Deci `auto_banned` rămâne ÎN COADĂ și e
# raportat panoului ca 'open' — altfel exact cazurile cele mai grave (cele care au
# atins pragul de auto-ban) ar fi dispărut din coada moderatorului.
REPORT_STATUS_OPEN = "open"
REPORT_STATUS_AUTO_BANNED = "auto_banned"
REPORT_STATUS_RESOLVED = "resolved"
REPORT_STATUS_DISMISSED = "dismissed"

# Rapoartele care AȘTEAPTĂ o decizie umană (coada de moderare).
REPORT_PENDING_STATUSES = (REPORT_STATUS_OPEN, REPORT_STATUS_AUTO_BANNED)

# Maparea stare-DB → stare-API (contractul `ReportStatus` din types.ts).
_STATUS_DB_TO_API = {
    REPORT_STATUS_OPEN: "open",
    REPORT_STATUS_AUTO_BANNED: "open",
    REPORT_STATUS_RESOLVED: "resolved",
    REPORT_STATUS_DISMISSED: "dismissed",
}
# Maparea inversă, pentru filtrul `?status=` (o stare API poate acoperi două de DB).
_STATUS_API_TO_DB = {
    "open": REPORT_PENDING_STATUSES,
    "resolved": (REPORT_STATUS_RESOLVED,),
    "dismissed": (REPORT_STATUS_DISMISSED,),
}

# Normalizarea acțiunilor de moderare: numele scurte (frontend) și cele lungi
# (specificația backendului) descriu ACEEAȘI decizie.
_ACTION_ALIASES = {
    "ban": "ban",
    "ban_user": "ban",
    "hide": "hide",
    "hide_profile": "hide",
    "dismiss": "dismiss",
}

# Providerul înscris pe abonamentele acordate manual de suport. Îl distingem de
# 'stub'/'stripe'/'app_store' ca să nu contaminăm raportările de venit REAL cu
# abonamente care n-au adus niciun ban. (`Subscription.provider` = String(16).)
PROVIDER_MANUAL = "manual"

# Caracterul de escape pentru LIKE (aceeași convenție ca în `feed_service`).
_LIKE_ESCAPE = "\\"


# --------------------------------------------------------------------------- #
# Helperi
# --------------------------------------------------------------------------- #
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _calc_age(birth_date: date | None, today: date | None = None) -> int | None:
    """Vârsta în ani împliniți (None dacă userul nu are profil)."""
    if birth_date is None:
        return None
    today = today or date.today()
    return (
        today.year
        - birth_date.year
        - ((today.month, today.day) < (birth_date.month, birth_date.day))
    )


def _like_term(term: str) -> str:
    """Transformă un text de căutare într-un pattern LIKE SIGUR.

    Escapează `\\`, `%` și `_` din inputul userului. Fără asta, o căutare de `%`
    ar returna TOATĂ tabela (un `LIKE '%%%'` face match pe orice) — adică un DoS
    declanșat dintr-un simplu câmp de căutare. Valoarea rămâne un PARAMETRU LEGAT;
    nu se concatenează niciodată în SQL.
    """
    escaped = term.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2)
    escaped = escaped.replace("%", f"{_LIKE_ESCAPE}%").replace("_", f"{_LIKE_ESCAPE}_")
    return f"%{escaped}%"


def _count_of(model) -> select:
    """`SELECT count(*) FROM model` — agregat, nu materializăm rândurile."""
    return select(func.count()).select_from(model)


def _sum_case(condition) -> object:
    """`COALESCE(SUM(CASE WHEN cond THEN 1 ELSE 0 END), 0)`.

    `SUM` peste zero rânduri întoarce NULL (nu 0) atât în SQLite cât și în
    Postgres — fără `COALESCE`, un dashboard pe o bază goală ar întoarce `null`
    în loc de `0` și ar sparge graficele din UI.
    """
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _plan_prices() -> dict[str, float]:
    """Prețul fiecărui plan, din CONFIG prin catalogul `billing` (zero hardcodare)."""
    return {plan.code: plan.price_eur for plan in billing.list_plans()}


def _json_safe(meta: dict) -> dict:
    """Convertește valorile ne-serializabile JSON (UUID, datetime) în stringuri."""
    safe: dict = {}
    for key, value in meta.items():
        if isinstance(value, (uuid.UUID, datetime, date)):
            safe[key] = str(value)
        elif isinstance(value, dict):
            safe[key] = _json_safe(value)
        else:
            safe[key] = value
    return safe


def audit(
    db: AsyncSession,
    actor: User,
    action: str,
    *,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    meta: dict | None = None,
    ip: str | None = None,
) -> None:
    """Scrie o intrare în jurnalul de audit — FĂRĂ commit.

    Commit-ul e lăsat intenționat apelantului: intrarea de audit trebuie să intre
    în ACEEAȘI tranzacție cu acțiunea auditată (vezi contractul din
    `models/admin.py`). `actor_email` e denormalizat ca urma să rămână lizibilă
    chiar dacă adminul își șterge contul.

    `meta` nu conține niciodată secrete: apelanții trec doar parametrii deciziei
    (motiv, plan, câmpuri modificate).
    """
    db.add(
        AdminAuditLog(
            actor_id=actor.id,
            actor_email=actor.email,
            action=action,
            target_type=target_type,
            target_id=target_id,
            meta=_json_safe(meta or {}),
            ip=ip,
        )
    )


def request_ip(request: Request) -> str | None:
    """IP-ul cererii, respectând `X-Forwarded-For` (același helper ca rate-limit)."""
    return client_ip(request)


async def _get_user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


async def _set_profile_hidden(
    db: AsyncSession, user_id: uuid.UUID, hidden: bool
) -> None:
    """Ascunde/afișează profilul în feed (creează setările dacă lipsesc).

    Feed-ul filtrează pe `UserSettings.profile_hidden`, deci ăsta e comutatorul
    care scoate efectiv un cont din circulație. Aceeași abordare ca în
    `moderation_service._auto_ban` — o singură semantică de „ascuns", nu două.
    """
    record = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()
    if record is None:
        record = UserSettings(
            user_id=user_id,
            search_radius_km=settings.search_radius_default_km,
            notifications={},
            profile_hidden=hidden,
        )
        db.add(record)
    else:
        record.profile_hidden = hidden


async def _revoke_sessions(db: AsyncSession, user_id: uuid.UUID) -> None:
    """Revocă TOATE sesiunile de refresh ale unui user (logout global).

    DE CE E OBLIGATORIU LA BAN: access token-ul e respins imediat
    (`get_current_user` verifică `is_banned` în DB la fiecare cerere), dar REFRESH
    token-ul e o creanță de 30 de zile. Fără revocare, un cont banat ar fi putut
    roti la nesfârșit perechea de token-uri și ar fi continuat să folosească
    aplicația. `auth_service.rotate_refresh` verifică și el banul — asta e a doua
    barieră, nu prima: revocăm sesiunile din DB, ca banul să nu depindă de o
    singură verificare.
    """
    await db.execute(
        update(RefreshSession)
        .where(RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False))
        .values(revoked=True)
    )


# --------------------------------------------------------------------------- #
# 1. STATISTICI (SQL agregat)
# --------------------------------------------------------------------------- #
async def get_stats(db: AsyncSession) -> AdminStats:
    """Dashboard-ul complet, în ~11 query-uri AGREGATE, constante ca număr.

    Fiecare bloc e un singur `SELECT` cu `COUNT`/`SUM(CASE …)` peste o tabelă.
    Nimic nu se numără în Python; singurele calcule Python sunt aritmetica pe
    scalarii deja agregați (rata de match, venitul estimat).
    """
    now = _now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    since_24h = now - timedelta(days=1)
    since_7d = now - timedelta(days=7)
    since_30d = now - timedelta(days=30)
    active_since = now - timedelta(days=settings.admin_active_window_days)

    # --- 1. Useri (un singur scan, toate contoarele deodată) ------------------
    users_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(User.created_at >= today_start).label("new_today"),
                _sum_case(User.created_at >= since_7d).label("new_7d"),
                _sum_case(User.created_at >= since_30d).label("new_30d"),
                _sum_case(User.last_active_at >= since_24h).label("active_24h"),
                _sum_case(User.last_active_at >= active_since).label("active"),
                _sum_case(User.banned_at.is_not(None)).label("banned"),
                _sum_case(User.role == ROLE_ADMIN).label("admins"),
            ).select_from(User)
        )
    ).one()

    pending_deletion = await db.scalar(_count_of(AccountDeletionRequest)) or 0

    users = UserStats(
        total=users_row.total,
        new_today=users_row.new_today,
        new_7d=users_row.new_7d,
        new_30d=users_row.new_30d,
        active_24h=users_row.active_24h,
        active=users_row.active,
        banned=users_row.banned,
        pending_deletion=pending_deletion,
        admins=users_row.admins,
    )

    # --- 2. Profiluri ---------------------------------------------------------
    profiles_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Profile.completed.is_(True)).label("completed"),
                _sum_case(Profile.verified.is_(True)).label("verified"),
            ).select_from(Profile)
        )
    ).one()
    hidden = await db.scalar(
        select(func.count())
        .select_from(UserSettings)
        .where(UserSettings.profile_hidden.is_(True))
    )
    profiles = ProfileStats(
        total=profiles_row.total,
        completed=profiles_row.completed,
        # „Incomplete" se raportează la TOȚI userii, nu doar la cei cu un rând în
        # `profiles`: un cont fără niciun profil e cea mai incompletă anketă cu
        # putință, iar dacă i-am fi numărat doar pe cei cu rând, funnel-ul de
        # onboarding ar fi arătat perfect exact când e cel mai rupt.
        incomplete=users.total - profiles_row.completed,
        verified=profiles_row.verified,
        hidden=hidden or 0,
    )

    # --- 3. Swipe-uri + match-uri --------------------------------------------
    likes_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Like.is_like.is_(True)).label("likes"),
            ).select_from(Like)
        )
    ).one()
    matches_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Match.created_at >= since_24h).label("last_24h"),
            ).select_from(Match)
        )
    ).one()
    likes = likes_row.likes
    swipes = SwipeStats(
        swipes=likes_row.total,
        likes=likes,
        dislikes=likes_row.total - likes,
        matches=matches_row.total,
        matches_24h=matches_row.last_24h,
        # Un match consumă DOUĂ like-uri (reciprocitate), dar raportăm rata față
        # de like-urile trimise — e metrica pe care o citește produsul („din 100
        # de like-uri date, câte se transformă în match?").
        match_rate=round(matches_row.total / likes * 100, 2) if likes else 0.0,
    )

    # --- 4. Chat-uri + mesaje -------------------------------------------------
    chats_total = await db.scalar(_count_of(Chat)) or 0
    messages_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Message.was_masked.is_(True)).label("masked"),
            ).select_from(Message)
        )
    ).one()
    chats = ChatStats(
        chats=chats_total,
        messages=messages_row.total,
        masked_messages=messages_row.masked,
    )

    # --- 5. Rapoarte de moderare (coada operațională) -------------------------
    reports_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Report.status.in_(REPORT_PENDING_STATUSES)).label("pending"),
            ).select_from(Report)
        )
    ).one()
    by_category = {
        category: count
        for category, count in (
            await db.execute(
                select(Report.category, func.count()).group_by(Report.category)
            )
        ).all()
    }
    reports = ReportStats(
        total=reports_row.total,
        pending=reports_row.pending,
        resolved=reports_row.total - reports_row.pending,
        by_category=by_category,
    )

    # --- 6. Abonamente + venit estimat ---------------------------------------
    # Activ = status 'active' ȘI (fără expirare SAU expirare în viitor). Aceeași
    # regulă ca `billing._is_active`, dar exprimată în SQL: altfel ar fi trebuit
    # să încărcăm toate abonamentele în Python ca să le filtrăm.
    active_cond = and_(
        Subscription.status == "active",
        or_(Subscription.expires_at.is_(None), Subscription.expires_at > now),
    )
    by_plan = {
        plan: count
        for plan, count in (
            await db.execute(
                select(Subscription.plan, func.count())
                .where(active_cond)
                .group_by(Subscription.plan)
            )
        ).all()
    }
    prices = _plan_prices()
    revenue = sum(prices.get(plan, 0.0) * count for plan, count in by_plan.items())
    subscriptions = SubscriptionStats(
        active=sum(by_plan.values()),
        by_plan=by_plan,
        estimated_revenue_eur=round(revenue, 2),
    )

    # --- 7. Evenimente --------------------------------------------------------
    events_row = (
        await db.execute(
            select(
                func.count().label("total"),
                _sum_case(Event.starts_at >= now).label("upcoming"),
            ).select_from(Event)
        )
    ).one()
    attendances = await db.scalar(
        select(func.count())
        .select_from(EventAttendance)
        .where(EventAttendance.going.is_(True))
    )
    events = EventStats(
        total=events_row.total,
        upcoming=events_row.upcoming,
        attendances=attendances or 0,
    )

    # --- 8. Comenzi de bilet în așteptare de verificare (coada de admin) -------
    pending_ticket_orders = await db.scalar(
        select(func.count())
        .select_from(TicketOrder)
        .where(TicketOrder.status == STATUS_PAYMENT_DECLARED)
    )

    return AdminStats(
        # Stratul PLAT — contractul cu panoul React (aceleași agregate, zero
        # query-uri în plus).
        users_total=users.total,
        users_active_24h=users.active_24h,
        users_new_7d=users.new_7d,
        users_banned=users.banned,
        matches_total=swipes.matches,
        matches_24h=swipes.matches_24h,
        reports_pending=reports.pending,
        subscriptions_active=subscriptions.active,
        revenue_estimated_eur=subscriptions.estimated_revenue_eur,
        pending_ticket_orders=pending_ticket_orders or 0,
        # Stratul DETALIAT — specificația backendului.
        users=users,
        profiles=profiles,
        swipes=swipes,
        chats=chats,
        reports=reports,
        subscriptions=subscriptions,
        events=events,
        generated_at=now,
    )


# Allowlist metrică → coloana de timp pe care se agregă. Un DICȚIONAR, nu un
# `getattr(Model, param)`: numele metricii vine din query string, iar orice cale
# prin care un string de la client ajunge să numească o coloană sau o tabelă e o
# invitație la injecție. Aici, o metrică necunoscută nu ajunge niciodată în SQL.
_TIMESERIES_METRICS: dict[str, object] = {
    "users": User.created_at,
    "swipes": Like.created_at,
    "matches": Match.created_at,
    "messages": Message.created_at,
    "chats": Chat.created_at,
    "reports": Report.created_at,
    "subscriptions": Subscription.created_at,
    "events": Event.created_at,
}

TIMESERIES_METRIC_NAMES = tuple(_TIMESERIES_METRICS)


def _clamp_days(days: int | None) -> int:
    return clamp_limit(
        days,
        settings.admin_timeseries_default_days,
        settings.admin_timeseries_max_days,
    )


def _window(days: int) -> tuple[date, datetime]:
    """Prima zi a ferestrei + momentul de start (UTC). Fereastra include AZI."""
    now = _now()
    first_day = (now - timedelta(days=days - 1)).date()
    since = datetime.combine(first_day, datetime.min.time(), tzinfo=timezone.utc)
    return first_day, since


async def _daily_counts(
    db: AsyncSession, column, since: datetime
) -> dict[str, int]:
    """`GROUP BY date(col)` — o zi = un rând, nu o interogare per zi."""
    # `func.date()` există și în SQLite, și în Postgres → o singură expresie
    # portabilă, fără dialect branching.
    day = func.date(column)
    rows = (
        await db.execute(
            select(day.label("day"), func.count().label("count"))
            .where(column >= since)
            .group_by(day)
        )
    ).all()
    # SQLite întoarce ziua ca string ('2026-07-13'), Postgres ca `date`.
    # Normalizăm la ISO, ca formatul răspunsului să nu depindă de driver.
    return {str(row.day)[:10]: row.count for row in rows}


async def get_timeseries(
    db: AsyncSession, days: int | None = None
) -> list[TimeseriesPoint]:
    """Seriile zilnice ale dashboard-ului, TOATE într-un singur apel.

    Un endpoint „o metrică per cerere" ar fi cerut 4-5 round-trip-uri ca să
    deseneze un ecran care se deschide o dată — pentru exact aceleași agregări
    `GROUP BY`. Aici sunt 5 agregări (una per serie) + una pentru venit, fiecare
    un singur query, indiferent de câte zile se cer.

    Zilele fără activitate NU apar în rezultatul SQL (nu există rânduri), așa că
    le completăm cu 0 în Python: un grafic care sare peste zilele goale minte
    vizual (o zi cu zero înregistrări ar dispărea din axă în loc să apară ca o vale).
    """
    days = _clamp_days(days)
    first_day, since = _window(days)

    users = await _daily_counts(db, User.created_at, since)
    matches = await _daily_counts(db, Match.created_at, since)
    reports = await _daily_counts(db, Report.created_at, since)
    swipes = await _daily_counts(db, Like.created_at, since)
    messages = await _daily_counts(db, Message.created_at, since)

    # Venit pe zi: abonamentele CREATE în ziua respectivă × prețul planului lor.
    # Grupăm după (zi, plan) într-un singur query și înmulțim în Python cu
    # prețurile din config — un `CASE WHEN plan = … THEN <preț>` ar fi însemnat
    # exact hardcodarea prețurilor în SQL, pe care proiectul o interzice.
    day_expr = func.date(Subscription.created_at)
    revenue_rows = (
        await db.execute(
            select(
                day_expr.label("day"),
                Subscription.plan,
                func.count().label("count"),
            )
            .where(Subscription.created_at >= since)
            .group_by(day_expr, Subscription.plan)
        )
    ).all()
    prices = _plan_prices()
    revenue: dict[str, float] = {}
    for row in revenue_rows:
        key = str(row.day)[:10]
        revenue[key] = revenue.get(key, 0.0) + prices.get(row.plan, 0.0) * row.count

    points: list[TimeseriesPoint] = []
    for offset in range(days):
        iso = (first_day + timedelta(days=offset)).isoformat()
        points.append(
            TimeseriesPoint(
                date=iso,
                users=users.get(iso, 0),
                matches=matches.get(iso, 0),
                reports=reports.get(iso, 0),
                revenue_eur=round(revenue.get(iso, 0.0), 2),
                swipes=swipes.get(iso, 0),
                messages=messages.get(iso, 0),
            )
        )
    return points


async def get_metric_series(
    db: AsyncSession, metric: str, days: int | None = None
) -> MetricSeriesOut:
    """Serie temporală pentru O metrică aleasă din allowlist (8 disponibile).

    Completează dashboard-ul: seriile de care are nevoie panoul vin din
    `get_timeseries`, dar analiza ad-hoc („cum au evoluat mesajele?") are nevoie
    de orice metrică, nu doar de cele patru de pe ecranul principal.
    """
    column = _TIMESERIES_METRICS.get(metric)
    if column is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Metrică necunoscută. Valori permise: "
                f"{', '.join(TIMESERIES_METRIC_NAMES)}."
            ),
        )

    days = _clamp_days(days)
    first_day, since = _window(days)
    counts = await _daily_counts(db, column, since)

    points = [
        MetricPoint(
            date=(iso := (first_day + timedelta(days=offset)).isoformat()),
            count=counts.get(iso, 0),
        )
        for offset in range(days)
    ]
    return MetricSeriesOut(
        metric=metric,
        days=days,
        points=points,
        total=sum(point.count for point in points),
    )


# --------------------------------------------------------------------------- #
# 2. USERI
# --------------------------------------------------------------------------- #
async def _reports_against(
    db: AsyncSession, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """(total rapoarte, raportori DISTINCȚI) per user — UN query pentru toată pagina.

    Varianta naivă (un `count` per rând afișat) ar fi fix N+1-ul pe care proiectul
    l-a eliminat deja din `GET /chats`. Aici agregăm o singură dată, cu
    `WHERE reported_id IN (:page_ids)`.
    """
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(
                Report.reported_id,
                func.count().label("total"),
                func.count(func.distinct(Report.reporter_id)).label("distinct"),
            )
            .where(Report.reported_id.in_(user_ids))
            .group_by(Report.reported_id)
        )
    ).all()
    return {row.reported_id: (row.total, row.distinct) for row in rows}


def _to_user_out(
    user: User, profile: Profile | None, reports: tuple[int, int]
) -> AdminUserOut:
    return AdminUserOut(
        id=user.id,
        email=user.email,
        role=user.role,
        created_at=user.created_at,
        last_active_at=user.last_active_at,
        banned_at=user.banned_at,
        ban_reason=user.ban_reason,
        profile_completed=user.profile_completed,
        name=profile.name if profile else None,
        city=profile.city if profile else None,
        reports_count=reports[0],
        age=_calc_age(profile.birth_date) if profile else None,
        gender=profile.gender if profile else None,
        verified=bool(profile.verified) if profile else False,
        photos_count=len(profile.photos or []) if profile else 0,
    )


async def list_users(
    db: AsyncSession,
    *,
    q: str | None = None,
    status_filter: str | None = None,
    role: str | None = None,
    banned: bool | None = None,
    verified: bool | None = None,
    completed: bool | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AdminUserOut], str | None]:
    """Căutare + filtrare + paginare pe cursor peste useri.

    Căutarea `q` lovește emailul (`users.email`) ȘI numele din anketă
    (`profiles.name`) printr-un OUTER JOIN — un moderator caută după oricare
    dintre ele, iar userii fără profil trebuie să rămână găsibili după email
    (de-aia OUTER, nu INNER).

    `status_filter` e filtrul din panou: 'active' | 'banned' | 'reported'.
    'reported' = are cel puțin un raport împotriva lui — un `EXISTS` corelat, nu
    un `JOIN` (care ar fi multiplicat rândurile userilor cu mai multe rapoarte și
    ar fi stricat paginarea).

    Paginare pe `(created_at, id)` descrescător, cu cursorul opac din
    `pagination.py` — aceeași convenție ca restul API-ului, nu una nouă.
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(User, Profile).outerjoin(Profile, Profile.user_id == User.id)

    if q:
        term = _like_term(q.strip())
        # Parametri LEGAȚI + escape explicit. Niciun f-string în SQL.
        stmt = stmt.where(
            or_(
                User.email.ilike(term, escape=_LIKE_ESCAPE),
                Profile.name.ilike(term, escape=_LIKE_ESCAPE),
            )
        )

    if status_filter == "active":
        stmt = stmt.where(User.banned_at.is_(None))
    elif status_filter == "banned":
        stmt = stmt.where(User.banned_at.is_not(None))
    elif status_filter == "reported":
        stmt = stmt.where(
            exists().where(Report.reported_id == User.id)
        )

    if role:
        stmt = stmt.where(User.role == role)
    if banned is not None:
        stmt = stmt.where(
            User.banned_at.is_not(None) if banned else User.banned_at.is_(None)
        )
    if verified is not None:
        stmt = stmt.where(Profile.verified.is_(verified))
    if completed is not None:
        # ATENȚIE: acest filtru înseamnă „ANKETA e completă" (`profiles.completed`),
        # NU „profilul e complet". Cele două NU mai sunt sinonime și pot diverge
        # LEGITIM: `users.profile_completed` (și vizibilitatea în feed) cer în plus
        # cel puțin `settings.min_photos` poze — vezi
        # `profile_service._sync_profile_completed` și `feed_service._min_photos_clause`.
        # Deci un user cu `completed=true` aici poate fi, corect, invizibil în feed
        # fiindcă n-are poze. Filtrul rămâne intenționat pe anketă: adminul are
        # nevoie exact de acest decupaj ca să vadă cine a completat chestionarul.
        stmt = stmt.where(
            Profile.completed.is_(True)
            if completed
            else or_(Profile.completed.is_(False), Profile.id.is_(None))
        )

    if cursor:
        anchor_id = decode_cursor(cursor)
        # Momentul rândului-ancoră, citit DB-side (vezi docstring-ul din
        # `pagination.py`: timestamp-ul NU se plimbă prin cursor).
        anchor_at = (
            select(User.created_at).where(User.id == anchor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                User.created_at < anchor_at,
                and_(User.created_at == anchor_at, User.id < anchor_id),
            )
        )

    rows = (
        await db.execute(
            stmt.order_by(User.created_at.desc(), User.id.desc()).limit(limit + 1)
        )
    ).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return [], None

    reports = await _reports_against(db, [row.User.id for row in rows])
    items = [
        _to_user_out(row.User, row.Profile, reports.get(row.User.id, (0, 0)))
        for row in rows
    ]
    next_cursor = encode_cursor(rows[-1].User.id) if has_more else None
    return items, next_cursor


async def get_user_detail(db: AsyncSession, user_id: uuid.UUID) -> AdminUserDetail:
    """Fișa completă a unui user — număr FIX de query-uri, niciunul per rând."""
    user = await _get_user_or_404(db, user_id)

    profile = (
        await db.execute(select(Profile).where(Profile.user_id == user_id))
    ).scalar_one_or_none()
    user_settings = (
        await db.execute(select(UserSettings).where(UserSettings.user_id == user_id))
    ).scalar_one_or_none()

    reports = (await _reports_against(db, [user_id])).get(user_id, (0, 0))

    # Contoarele de activitate, într-un SINGUR query cu subinterogări scalare —
    # nu patru round-trip-uri separate și, mai ales, nu numărate în Python.
    counters = (
        await db.execute(
            select(
                select(func.count())
                .select_from(Like)
                .where(Like.from_user_id == user_id)
                .scalar_subquery()
                .label("likes_sent"),
                select(func.count())
                .select_from(Match)
                .where(or_(Match.user_a_id == user_id, Match.user_b_id == user_id))
                .scalar_subquery()
                .label("matches"),
                select(func.count())
                .select_from(Message)
                .where(Message.sender_id == user_id)
                .scalar_subquery()
                .label("messages_sent"),
                select(func.count())
                .select_from(RefreshSession)
                .where(
                    RefreshSession.user_id == user_id,
                    RefreshSession.revoked.is_(False),
                )
                .scalar_subquery()
                .label("active_sessions"),
            )
        )
    ).one()

    sub = (
        await db.execute(
            select(Subscription)
            .where(Subscription.user_id == user_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).scalars().first()

    base = _to_user_out(user, profile, reports)
    return AdminUserDetail(
        **base.model_dump(),
        about=profile.about if profile else None,
        photos=list(profile.photos or []) if profile else [],
        matches_count=counters.matches,
        subscription_plan=sub.plan if sub else None,
        subscription_status=sub.status if sub else None,
        subscription_expires_at=sub.expires_at if sub else None,
        languages=list(profile.languages or []) if profile else [],
        dating_statuses=list(profile.dating_statuses or []) if profile else [],
        profile_hidden=bool(user_settings.profile_hidden) if user_settings else False,
        distinct_reporters=reports[1],
        likes_sent=counters.likes_sent,
        messages_sent=counters.messages_sent,
        active_sessions=counters.active_sessions,
    )


def _apply_ban(user: User, reason: str, now: datetime) -> None:
    """Marchează contul ca banat (fără commit, fără audit — vezi apelanții)."""
    if user.banned_at is None:
        user.banned_at = now
    user.ban_reason = reason


async def ban_user(
    db: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    reason: str,
    ip: str | None = None,
) -> AdminUserDetail:
    """Banează un cont — COMPLET, nu doar cu un flag.

    Un „ban" care setează doar `banned_at` e teatru de securitate: userul banat ar
    fi continuat să folosească aplicația până la expirarea access token-ului și ar
    fi putut roti refresh token-ul la nesfârșit. Banul real înseamnă TREI lucruri,
    în aceeași tranzacție:
      1. `banned_at` + motivul  → login refuzat (`auth_service`) și orice cerere
         autentificată respinsă cu 403 (`get_current_user` verifică DB-ul);
      2. revocarea sesiunilor    → refresh token-ul devine inutilizabil ACUM;
      3. `profile_hidden`        → profilul dispare din feed-ul celorlalți.

    NU te poți bana pe tine (te-ai încuia singur afară din panou).
    """
    target = await _get_user_or_404(db, user_id)
    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nu îți poți bana propriul cont de administrator.",
        )

    _apply_ban(target, reason, _now())
    await _revoke_sessions(db, user_id)
    await _set_profile_hidden(db, user_id, True)

    audit(
        db,
        actor,
        ACTION_USER_BAN,
        target_type="user",
        target_id=user_id,
        meta={"reason": reason, "email": target.email},
        ip=ip,
    )
    await db.commit()
    return await get_user_detail(db, user_id)


async def unban_user(
    db: AsyncSession, actor: User, user_id: uuid.UUID, ip: str | None = None
) -> AdminUserDetail:
    """Ridică banul: contul redevine funcțional și reapare în feed.

    Repunem `profile_hidden=False` pentru că banul e cel care l-a ascuns — altfel
    userul deblocat ar rămâne invizibil pentru totdeauna, fără să înțeleagă de ce.
    (Compromis asumat: dacă userul își ascunsese SINGUR profilul înainte de ban,
    deblocarea i-l face din nou vizibil; și-l poate reascunde din `PUT /settings`.)

    Sesiunile revocate NU se „dez-revocă" — userul se autentifică din nou. A
    reînvia o sesiune revocată ar însemna să reactivăm token-uri care au circulat
    cât timp contul era banat.
    """
    target = await _get_user_or_404(db, user_id)
    target.banned_at = None
    target.ban_reason = None
    await _set_profile_hidden(db, user_id, False)

    audit(
        db,
        actor,
        ACTION_USER_UNBAN,
        target_type="user",
        target_id=user_id,
        meta={"email": target.email},
        ip=ip,
    )
    await db.commit()
    return await get_user_detail(db, user_id)


async def delete_user(
    db: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    reason: str | None = None,
    ip: str | None = None,
) -> None:
    """Ștergere GDPR imediată, executată de un admin (IREVERSIBILĂ).

    REFOLOSEȘTE `account_service.purge_user_data` — exact logica pe care o rulează
    și cron-ul de purjare (`scripts/gdpr_purge.py`) la expirarea perioadei de
    grație. Nu rescriem ștergerea: două implementări ale ștergerii GDPR ar diverge,
    iar cea uitată ar lăsa date personale în urmă.

    Contul nu „dispare" din tabelă: e ANONIMIZAT (email `@deleted.invalid`, hash de
    parolă invalid) ca să nu rupă cheile externe păstrate. Auditul supraviețuiește
    ștergerii: `target_id` e un UUID FĂRĂ cheie externă tocmai ca să putem
    înregistra ștergerea propriei ținte.
    """
    target = await _get_user_or_404(db, user_id)
    if target.id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nu îți poți șterge propriul cont de administrator.",
        )

    # Emailul se pierde la anonimizare → îl salvăm ÎNAINTE, pentru jurnal.
    email = target.email

    await account_service.purge_user_data(db, user_id)
    # Cererea de ștergere (dacă userul o depusese) devine fără obiect: contul e
    # deja purjat. O consumăm, ca cron-ul GDPR să nu reproceseze un cont șters.
    await db.execute(
        delete(AccountDeletionRequest).where(AccountDeletionRequest.user_id == user_id)
    )

    audit(
        db,
        actor,
        ACTION_USER_DELETE,
        target_type="user",
        target_id=user_id,
        meta={"email": email, "reason": reason or ""},
        ip=ip,
    )
    await db.commit()


# --------------------------------------------------------------------------- #
# 3. MODERARE
# --------------------------------------------------------------------------- #
def _pending_expr():
    """Expresie SQL: 1 dacă raportul așteaptă decizie umană, 0 dacă e rezolvat."""
    return case((Report.status.in_(REPORT_PENDING_STATUSES), 1), else_=0)


def _build_report_out(
    report: Report,
    user: User | None,
    profile: Profile | None,
    counts: tuple[int, int],
) -> AdminReportOut:
    """Un rând din coada de moderare, cu profilul raportat alăturat.

    Toate datele vin din obiecte DEJA încărcate — funcția nu atinge DB-ul, ca să
    poată fi apelată în buclă peste o pagină fără să reintroducă un N+1.
    """
    total, distinct = counts
    reported = (
        ReportedProfile(
            user_id=report.reported_id,
            email=user.email if user else "",
            name=profile.name if profile else None,
            age=_calc_age(profile.birth_date) if profile else None,
            city=profile.city if profile else None,
            about=profile.about if profile else None,
            photos=list(profile.photos or []) if profile else [],
            banned_at=user.banned_at if user else None,
        )
        if user is not None
        else None
    )
    return AdminReportOut(
        id=report.id,
        reporter_id=report.reporter_id,
        reported_id=report.reported_id,
        category=report.category,
        note=report.note,
        # Starea DB → starea API ('auto_banned' rămâne 'open': cere decizie umană).
        status=_STATUS_DB_TO_API.get(report.status, "open"),
        created_at=report.created_at,
        reporters_count=distinct,
        reported=reported,
        chat_id=report.chat_id,
        total_reports=total,
        pending=report.status in REPORT_PENDING_STATUSES,
    )


async def _report_out(db: AsyncSession, report: Report) -> AdminReportOut:
    """Un SINGUR raport, cu datele alăturate (3 query-uri fixe)."""
    counts = await _reports_against(db, [report.reported_id])
    user = await db.get(User, report.reported_id)
    profile = (
        await db.execute(select(Profile).where(Profile.user_id == report.reported_id))
    ).scalar_one_or_none()
    return _build_report_out(
        report, user, profile, counts.get(report.reported_id, (0, 0))
    )


async def list_reports(
    db: AsyncSession,
    *,
    status_filter: str | None = None,
    pending_only: bool = False,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AdminReportOut], str | None]:
    """Coada de moderare: RAPOARTELE ÎN AȘTEPTARE PRIMELE, apoi cele mai noi.

    Ordinea nu e cosmetică: Apple (Guideline 1.2) cere ca raportările de conținut
    abuziv să primească răspuns în ≤24h. Dacă coada ar fi sortată doar cronologic,
    un raport nerezolvat de acum trei zile ar fi împins la pagina 4 de rapoartele
    deja rezolvate de ieri — exact cazul pe care SLA-ul îl interzice.

    Cheia de sortare e TOTALĂ — `(pending, created_at, id)` — deci paginarea pe
    cursor nu poate nici duplica, nici sări rânduri. `pending` fiind o expresie,
    nu o coloană, valoarea ei pentru rândul-ancoră e recalculată DB-side printr-un
    subquery scalar (aceeași tehnică ca timestamp-ul din `pagination.py`).

    Cost: 4 query-uri pe pagină, indiferent de mărimea paginii (rapoarte, profile,
    useri, agregarea raportorilor) — fără N+1.
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)
    pending = _pending_expr()

    stmt = select(Report)
    if status_filter:
        db_statuses = _STATUS_API_TO_DB.get(status_filter)
        if db_statuses is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Status invalid. Valori permise: open, resolved, dismissed.",
            )
        stmt = stmt.where(Report.status.in_(db_statuses))
    elif pending_only:
        stmt = stmt.where(Report.status.in_(REPORT_PENDING_STATUSES))

    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_pending = (
            select(_pending_expr()).where(Report.id == anchor_id).scalar_subquery()
        )
        anchor_at = (
            select(Report.created_at).where(Report.id == anchor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                pending < anchor_pending,
                and_(
                    pending == anchor_pending,
                    or_(
                        Report.created_at < anchor_at,
                        and_(
                            Report.created_at == anchor_at,
                            Report.id < anchor_id,
                        ),
                    ),
                ),
            )
        )

    reports = list(
        (
            await db.execute(
                stmt.order_by(
                    pending.desc(), Report.created_at.desc(), Report.id.desc()
                ).limit(limit + 1)
            )
        ).scalars().all()
    )

    has_more = len(reports) > limit
    reports = reports[:limit]
    if not reports:
        return [], None

    reported_ids = list({r.reported_id for r in reports})
    counts = await _reports_against(db, reported_ids)
    profiles = {
        p.user_id: p
        for p in (
            await db.execute(select(Profile).where(Profile.user_id.in_(reported_ids)))
        ).scalars().all()
    }
    users = {
        u.id: u
        for u in (
            await db.execute(select(User).where(User.id.in_(reported_ids)))
        ).scalars().all()
    }

    items = [
        _build_report_out(
            report,
            users.get(report.reported_id),
            profiles.get(report.reported_id),
            counts.get(report.reported_id, (0, 0)),
        )
        for report in reports
    ]
    next_cursor = encode_cursor(reports[-1].id) if has_more else None
    return items, next_cursor


async def list_user_reports(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AdminReportOut], str | None]:
    """Istoricul rapoartelor depuse ÎMPOTRIVA unui user (404 dacă nu există).

    Reciproca (ce a raportat EL) nu e ce caută un moderator când deschide fișa unui
    cont: întrebarea e „de câte ori și pentru ce a fost reclamat".
    """
    await _get_user_or_404(db, user_id)
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(Report).where(Report.reported_id == user_id)
    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_at = (
            select(Report.created_at).where(Report.id == anchor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Report.created_at < anchor_at,
                and_(Report.created_at == anchor_at, Report.id < anchor_id),
            )
        )

    reports = list(
        (
            await db.execute(
                stmt.order_by(Report.created_at.desc(), Report.id.desc()).limit(
                    limit + 1
                )
            )
        ).scalars().all()
    )
    has_more = len(reports) > limit
    reports = reports[:limit]
    if not reports:
        return [], None

    # Toate rapoartele sunt împotriva ACELUIAȘI user → userul, profilul și
    # contoarele se aduc O SINGURĂ DATĂ, nu o dată per rând.
    counts = await _reports_against(db, [user_id])
    user = await db.get(User, user_id)
    profile = (
        await db.execute(select(Profile).where(Profile.user_id == user_id))
    ).scalar_one_or_none()

    items = [
        _build_report_out(r, user, profile, counts.get(user_id, (0, 0)))
        for r in reports
    ]
    return items, encode_cursor(reports[-1].id) if has_more else None


async def resolve_report(
    db: AsyncSession,
    actor: User,
    report_id: uuid.UUID,
    data: ResolveIn,
    ip: str | None = None,
) -> AdminReportOut:
    """Decizia umană asupra unui raport: ban / ascundere / respingere.

    Rezolvarea închide TOATE rapoartele în așteptare împotriva aceluiași user, nu
    doar rândul pe care a dat click moderatorul. Altfel, cinci reclamații despre
    aceeași persoană ar cere cinci decizii identice, iar coada — singura măsură a
    SLA-ului de 24h — ar rămâne artificial plină după ce cazul a fost deja judecat.

    `ban` scrie DOUĂ intrări de audit (`report.resolve` + `user.ban`): o căutare pe
    `target=user` trebuie să arate banul, indiferent pe unde a fost declanșat.
    """
    report = await db.get(Report, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Report not found"
        )

    # 'ban' și 'ban_user' sunt același lucru (vezi `_ACTION_ALIASES`).
    action = _ACTION_ALIASES[data.action]
    reported_id = report.reported_id

    if action in ("ban", "hide") and reported_id == actor.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nu poți aplica măsuri de moderare asupra propriului cont.",
        )

    reason = data.reason or ""
    now = _now()

    if action == "ban":
        target = await _get_user_or_404(db, reported_id)
        _apply_ban(target, reason, now)
        await _revoke_sessions(db, reported_id)
        await _set_profile_hidden(db, reported_id, True)
        audit(
            db,
            actor,
            ACTION_USER_BAN,
            target_type="user",
            target_id=reported_id,
            meta={"reason": reason, "via_report": report_id, "email": target.email},
            ip=ip,
        )
    elif action == "hide":
        await _get_user_or_404(db, reported_id)
        await _set_profile_hidden(db, reported_id, True)
        audit(
            db,
            actor,
            ACTION_USER_HIDE,
            target_type="user",
            target_id=reported_id,
            meta={"reason": reason, "via_report": report_id},
            ip=ip,
        )
    # `dismiss` nu atinge contul raportat — doar închide raportul.

    new_status = (
        REPORT_STATUS_DISMISSED if action == "dismiss" else REPORT_STATUS_RESOLVED
    )
    # Închidem toate rapoartele în așteptare împotriva aceluiași user.
    await db.execute(
        update(Report)
        .where(
            Report.reported_id == reported_id,
            Report.status.in_(REPORT_PENDING_STATUSES),
        )
        .values(status=new_status)
    )

    audit(
        db,
        actor,
        ACTION_REPORT_RESOLVE,
        target_type="report",
        target_id=report_id,
        meta={
            "action": action,
            "reason": reason,
            "reported_id": reported_id,
            "category": report.category,
        },
        ip=ip,
    )
    await db.commit()

    # Raportul a fost actualizat printr-un UPDATE în masă → obiectul din sesiune e
    # stale; îl reîncărcăm explicit înainte de a-l serializa.
    await db.refresh(report)
    return await _report_out(db, report)


# --------------------------------------------------------------------------- #
# 4. EVENIMENTE (CRUD — golul funcțional pe care îl închide panoul)
# --------------------------------------------------------------------------- #
async def _attendee_counts(
    db: AsyncSession, event_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """Participanți per eveniment — un query pentru toată pagina (fără N+1)."""
    if not event_ids:
        return {}
    rows = (
        await db.execute(
            select(EventAttendance.event_id, func.count())
            .where(
                EventAttendance.event_id.in_(event_ids),
                EventAttendance.going.is_(True),
            )
            .group_by(EventAttendance.event_id)
        )
    ).all()
    return {event_id: count for event_id, count in rows}


def _to_event_out(event: Event, attendees: int) -> AdminEventOut:
    return AdminEventOut(
        id=event.id,
        title=event.title,
        description=event.description,
        starts_at=event.starts_at,
        city=event.city,
        venue=event.venue,
        lat=event.lat,
        lng=event.lng,
        kind=event.kind,
        cover_url=event.cover_url,
        promo_discount_percent=event.promo_discount_percent,
        promo_code=event.promo_code,
        promo_description=event.promo_description,
        ticket_price=event.ticket_price,
        ticket_currency=event.ticket_currency,
        attendee_count=attendees,
        created_at=event.created_at,
    )


async def list_events(
    db: AsyncSession, *, limit: int | None = None, cursor: str | None = None
) -> tuple[list[AdminEventOut], str | None]:
    """Toate evenimentele — INCLUSIV cele trecute.

    `GET /events` (public) arată doar viitorul, pentru că userul nu are ce face cu
    o petrecere de acum trei luni. Adminul, în schimb, are: le editează, le șterge
    și le folosește ca șablon.
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(Event)
    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_at = (
            select(Event.starts_at).where(Event.id == anchor_id).scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Event.starts_at < anchor_at,
                and_(Event.starts_at == anchor_at, Event.id < anchor_id),
            )
        )

    events = list(
        (
            await db.execute(
                stmt.order_by(Event.starts_at.desc(), Event.id.desc()).limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(events) > limit
    events = events[:limit]
    if not events:
        return [], None

    counts = await _attendee_counts(db, [e.id for e in events])
    items = [_to_event_out(e, counts.get(e.id, 0)) for e in events]
    return items, encode_cursor(events[-1].id) if has_more else None


async def create_event(
    db: AsyncSession, actor: User, data: AdminEventIn, ip: str | None = None
) -> AdminEventOut:
    """Creează un eveniment real.

    Asta închide un GOL FUNCȚIONAL: `POST /events` nu există nicăieri în API-ul
    public, iar seed-ul demo (`event_service.seed_events`) e blocat explicit în
    producție. Până acum, producția nu avea NICIO cale de a crea un eveniment —
    secțiunea Evenimente s-ar fi lansat goală și ar fi rămas goală.
    """
    event = Event(
        title=data.title,
        description=data.description,
        starts_at=data.starts_at,
        city=data.city,
        venue=data.venue,
        lat=data.lat,
        lng=data.lng,
        kind=data.kind,
        cover_url=data.cover_url,
        promo_discount_percent=data.promo_discount_percent,
        promo_code=data.promo_code,
        promo_description=data.promo_description,
        ticket_price=data.ticket_price,
        ticket_currency=data.ticket_currency,
    )
    db.add(event)
    await db.flush()  # obținem event.id înainte de a scrie auditul

    audit(
        db,
        actor,
        ACTION_EVENT_CREATE,
        target_type="event",
        target_id=event.id,
        meta={"title": event.title, "city": event.city, "starts_at": event.starts_at},
        ip=ip,
    )
    await db.commit()
    await db.refresh(event)
    return _to_event_out(event, 0)


async def update_event(
    db: AsyncSession,
    actor: User,
    event_id: uuid.UUID,
    data: AdminEventUpdate,
    ip: str | None = None,
) -> AdminEventOut:
    """Editare PARȚIALĂ: se scriu doar câmpurile trimise efectiv.

    `exclude_unset=True` e esențial — altfel un PUT care schimbă doar ora ar
    trimite `description=None` implicit și ar ȘTERGE descrierea evenimentului.
    """
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    changes = data.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Niciun câmp de actualizat.",
        )
    for field, value in changes.items():
        setattr(event, field, value)

    audit(
        db,
        actor,
        ACTION_EVENT_UPDATE,
        target_type="event",
        target_id=event_id,
        # Logăm CE s-a schimbat (câmpurile + valorile noi), nu doar „s-a schimbat".
        meta={"changes": _json_safe(changes)},
        ip=ip,
    )
    await db.commit()
    await db.refresh(event)

    counts = await _attendee_counts(db, [event.id])
    return _to_event_out(event, counts.get(event.id, 0))


async def delete_event(
    db: AsyncSession, actor: User, event_id: uuid.UUID, ip: str | None = None
) -> None:
    """Șterge un eveniment împreună cu participările și ștampilele lui.

    Ștergem copiii EXPLICIT, nu ne bazăm pe `ON DELETE CASCADE`: pe SQLite
    constrângerile de cheie externă sunt DEZACTIVATE implicit (`PRAGMA
    foreign_keys=OFF`), deci cascada nu se declanșează și ar fi rămas participări
    orfane care arată spre un eveniment inexistent. Explicit = același comportament
    pe SQLite și pe Postgres.
    """
    event = await db.get(Event, event_id)
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Event not found"
        )

    title = event.title
    await db.execute(delete(EventAttendance).where(EventAttendance.event_id == event_id))
    await db.execute(
        delete(FlirtPassportStamp).where(FlirtPassportStamp.event_id == event_id)
    )
    await db.delete(event)

    audit(
        db,
        actor,
        ACTION_EVENT_DELETE,
        target_type="event",
        target_id=event_id,
        meta={"title": title},
        ip=ip,
    )
    await db.commit()


# --------------------------------------------------------------------------- #
# 5. ABONAMENTE
# --------------------------------------------------------------------------- #
def _is_active_sub(sub: Subscription, now: datetime) -> bool:
    """Aceeași regulă ca `billing._is_active`, aplicată pe un rând deja încărcat."""
    if sub.status != "active":
        return False
    if sub.expires_at is None:
        return True
    expires = sub.expires_at
    # SQLite întoarce datetime naive — îl tratăm ca UTC (convenția proiectului).
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return expires > now


def _to_subscription_out(
    sub: Subscription, email: str, now: datetime
) -> AdminSubscriptionOut:
    return AdminSubscriptionOut(
        id=sub.id,
        user_id=sub.user_id,
        user_email=email,
        plan=sub.plan,
        status=sub.status,
        provider=sub.provider,
        created_at=sub.created_at,
        expires_at=sub.expires_at,
        is_active=_is_active_sub(sub, now),
        entries_total=sub.entries_total,
        entries_remaining=sub.entries_remaining,
    )


async def list_subscriptions(
    db: AsyncSession,
    *,
    plan: str | None = None,
    status_filter: str | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AdminSubscriptionOut], str | None]:
    """Abonamentele, paginat, cu emailul userului adus prin JOIN (nu prin N+1)."""
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)
    now = _now()

    stmt = select(Subscription, User).join(User, User.id == Subscription.user_id)
    if plan:
        stmt = stmt.where(Subscription.plan == plan)
    if status_filter:
        stmt = stmt.where(Subscription.status == status_filter)

    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_at = (
            select(Subscription.created_at)
            .where(Subscription.id == anchor_id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                Subscription.created_at < anchor_at,
                and_(
                    Subscription.created_at == anchor_at,
                    Subscription.id < anchor_id,
                ),
            )
        )

    rows = (
        await db.execute(
            stmt.order_by(Subscription.created_at.desc(), Subscription.id.desc()).limit(
                limit + 1
            )
        )
    ).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    if not rows:
        return [], None

    items = [_to_subscription_out(row.Subscription, row.User.email, now) for row in rows]
    next_cursor = encode_cursor(rows[-1].Subscription.id) if has_more else None
    return items, next_cursor


async def grant_subscription(
    db: AsyncSession,
    actor: User,
    user_id: uuid.UUID,
    data: GrantSubscriptionIn,
    ip: str | None = None,
) -> AdminSubscriptionOut:
    """Acordă manual un abonament (suport clienți: compensații, VIP, teste).

    Planul e validat contra CATALOGULUI real (`billing.PLANS`) — nu acceptăm un
    plan inventat, care ar produce un abonament fără niciun drept asociat și un
    user furios că a plătit degeaba.

    Durata e plafonată la `admin_grant_max_days`: un `days=36500` scris din
    greșeală într-un formular de suport nu are voie să devină un abonament pe
    viață. Providerul e marcat `manual`, ca abonamentele DĂRUITE să nu se amestece
    cu cele PLĂTITE în raportările de venit.
    """
    target = await _get_user_or_404(db, user_id)

    if data.plan not in billing.PLANS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Plan necunoscut: '{data.plan}'. Valori permise: "
            f"{', '.join(sorted(billing.PLANS))}.",
        )

    days = clamp_limit(
        data.days, settings.admin_grant_default_days, settings.admin_grant_max_days
    )
    now = _now()
    expires_at = now + timedelta(days=days)

    # Upsert pe cel mai recent abonament al userului (aceeași semantică ca
    # `billing._activate`) — un user are un singur abonament curent.
    sub = (
        await db.execute(
            select(Subscription)
            .where(Subscription.user_id == user_id)
            .order_by(Subscription.created_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if sub is None:
        sub = Subscription(user_id=user_id)
        db.add(sub)

    sub.plan = data.plan
    sub.status = "active"
    sub.provider = PROVIDER_MANUAL
    sub.expires_at = expires_at
    # Card de reduceri acordat manual: (re)încarcă intrările; orice alt plan le
    # șterge (NULL). Aceeași semantică ca `billing._activate`.
    entries = billing.card_entries_for_plan(data.plan)
    sub.entries_total = entries
    sub.entries_remaining = entries

    audit(
        db,
        actor,
        ACTION_SUBSCRIPTION_GRANT,
        target_type="subscription",
        target_id=user_id,
        meta={
            "plan": data.plan,
            "days": days,
            "expires_at": expires_at,
            "reason": data.reason or "",
            "email": target.email,
        },
        ip=ip,
    )
    await db.commit()
    await db.refresh(sub)
    return _to_subscription_out(sub, target.email, now)


async def grant_subscription_by_email(
    db: AsyncSession,
    actor: User,
    email: str,
    data: GrantSubscriptionIn,
    ip: str | None = None,
) -> AdminSubscriptionOut:
    """Ca `grant_subscription`, dar identifică userul după EMAIL (forma din panou).

    Suportul lucrează cu emailul pe care i-l dă clientul, nu cu un UUID pe care
    ar trebui să-l caute întâi. 404 dacă emailul nu există — un mesaj clar, nu o
    acordare tăcută către neantul.
    """
    normalized = email.strip().lower()
    user = await db.scalar(select(User).where(User.email == normalized))
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Nu există niciun cont cu emailul '{normalized}'.",
        )
    return await grant_subscription(db, actor, user.id, data, ip=ip)


# --------------------------------------------------------------------------- #
# 6. JURNAL DE AUDIT (citire — append-only, fără ștergere/editare)
# --------------------------------------------------------------------------- #
async def list_audit_log(
    db: AsyncSession,
    *,
    action: str | None = None,
    target_id: uuid.UUID | None = None,
    limit: int | None = None,
    cursor: str | None = None,
) -> tuple[list[AuditLogOut], str | None]:
    """Jurnalul de audit, cele mai noi intrări primele.

    NU există endpoint de ștergere sau editare — jurnalul e APPEND-ONLY prin
    contract (vezi `models/admin.py`). Un jurnal pe care adminul suspect îl poate
    curăța nu e un jurnal, e o decorațiune.
    """
    limit = clamp_limit(limit, ADMIN_PAGE_LIMIT, ADMIN_MAX_LIMIT)

    stmt = select(AdminAuditLog)
    if action:
        stmt = stmt.where(AdminAuditLog.action == action)
    if target_id:
        stmt = stmt.where(AdminAuditLog.target_id == target_id)

    if cursor:
        anchor_id = decode_cursor(cursor)
        anchor_at = (
            select(AdminAuditLog.created_at)
            .where(AdminAuditLog.id == anchor_id)
            .scalar_subquery()
        )
        stmt = stmt.where(
            or_(
                AdminAuditLog.created_at < anchor_at,
                and_(
                    AdminAuditLog.created_at == anchor_at,
                    AdminAuditLog.id < anchor_id,
                ),
            )
        )

    entries = list(
        (
            await db.execute(
                stmt.order_by(
                    AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc()
                ).limit(limit + 1)
            )
        ).scalars().all()
    )
    has_more = len(entries) > limit
    entries = entries[:limit]
    if not entries:
        return [], None

    items = [
        AuditLogOut(
            id=e.id,
            actor_id=e.actor_id,
            actor_email=e.actor_email,
            action=e.action,
            target_type=e.target_type,
            target_id=e.target_id,
            meta=e.meta or {},
            ip=e.ip,
            created_at=e.created_at,
        )
        for e in entries
    ]
    return items, encode_cursor(entries[-1].id) if has_more else None


async def record_login(db: AsyncSession, actor: User, ip: str | None = None) -> None:
    """Înregistrează o autentificare reușită în panoul de admin.

    Autentificările de admin sunt evenimente de securitate în sine: dacă un cont de
    admin e compromis, prima întrebare a anchetei e „de unde și când s-a logat", nu
    „ce a apăsat".
    """
    audit(db, actor, ACTION_LOGIN, target_type="user", target_id=actor.id, ip=ip)
    await db.commit()
