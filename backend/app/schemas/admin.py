"""Scheme Pydantic v2 pentru panoul de administrare (`/api/v1/admin/*`).

REGULA DE AUR A ACESTUI FIȘIER: schemele de ieșire enumeră EXPLICIT fiecare câmp
expus. Niciun `ConfigDict(from_attributes=True)` peste un model ORM întreg, niciun
`**user.__dict__`. Motivul e concret: `User` are `password_hash`, iar
`RefreshSession` are `token_hash` — dacă o schemă de admin ar serializa modelul
„în bloc", hash-urile ar ajunge în JSON-ul panoului, de acolo în cache-ul
browserului, în log-urile proxy-ului și în orice screenshot făcut de suport.
Un panou de admin spart = tot produsul spart.

Prin urmare: NICIUN câmp de mai jos nu conține parole, hash-uri, token-uri, chei
sau secrete — nici în listări, nici în detalii.

CONTRACT CU FRONTENDUL: numele câmpurilor respectă `admin/src/api/types.ts`
(panoul React e deja scris pe ele). Unde răspunsul conține și câmpuri în plus
față de tipul TS, sunt exact asta — în plus: TypeScript ignoră cheile
necunoscute, iar ele servesc consumatori mai bogați (raportare internă).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.core.validators import optional_safe_str, safe_str

# Plafoane de lungime aliniate cu coloanele din modele (convenția proiectului:
# vezi `schemas/moderation.py`, `schemas/billing.py`). Aliniate cu:
#   Event.title = String(200), Event.city = String(120), Event.venue = String(200),
#   Event.cover_url = String(500), User.ban_reason = String(500).
EVENT_TITLE_MAX_LENGTH = 200
EVENT_CITY_MAX_LENGTH = 120
EVENT_VENUE_MAX_LENGTH = 200
EVENT_COVER_URL_MAX_LENGTH = 500
# Event.description e `Text` (nemărginit în DB). Îl plafonăm oricum în schemă:
# un câmp fără limită e un vector de umflare a bazei și a răspunsurilor.
EVENT_DESCRIPTION_MAX_LENGTH = 2000
# Motivul banului / al deciziei de moderare (aliniat cu User.ban_reason).
REASON_MAX_LENGTH = 500
# Textul de căutare din `GET /admin/users?q=` — plafonat (anti-DoS pe LIKE).
SEARCH_MAX_LENGTH = 120
PLAN_MAX_LENGTH = 32

# Tipurile de eveniment acceptate. Reuniunea dintre catalogul frontendului
# (`EVENT_KINDS` din types.ts: party, concert, bar, sport, culture, other) și
# valoarea deja existentă în DB din seed-ul demo ('flirt_party') — pe care nu o
# putem scoate fără să invalidăm rândurile scrise înainte de panou.
EventKind = Literal[
    "flirt_party", "party", "concert", "bar", "sport", "culture", "other"
]

# Deciziile de moderare. Acceptăm ATÂT numele scurte din frontend
# ('ban'|'hide'|'dismiss'), CÂT ȘI cele lungi, explicite, din specificația
# backendului ('ban_user'|'hide_profile'). Serviciul le normalizează într-un
# singur set intern — un API care refuză un sinonim evident nu apără nimic, doar
# rupe clientul.
ResolveAction = Literal["ban", "hide", "dismiss", "ban_user", "hide_profile"]

# Starea unui raport, așa cum o vede PANOUL (vezi maparea din `admin_service`):
#   DB 'open' / 'auto_banned'  → API 'open'      (așteaptă decizie umană)
#   DB 'resolved'              → API 'resolved'  (măsură aplicată)
#   DB 'dismissed'             → API 'dismissed' (raport nefondat)
ReportStatus = Literal["open", "resolved", "dismissed"]

# Filtrul de status pentru listarea userilor (`UserStatusFilter` din types.ts).
UserStatusFilter = Literal["active", "banned", "reported"]


# --- Identitatea adminului curent ---------------------------------------------
class AdminMeOut(BaseModel):
    """`GET /admin/me` — cine sunt și ce rol am.

    Ruta există pentru că `GET /auth/me` (`UserOut`) NU expune `role`: panoul nu
    are din ce să decidă dacă utilizatorul logat e administrator. Fiind în
    spatele lui `require_admin`, un răspuns 200 e în sine dovada rolului.
    """

    id: uuid.UUID
    email: str
    role: str


# --- Useri --------------------------------------------------------------------
class AdminUserOut(BaseModel):
    """Un user în LISTAREA de admin (rând de tabel).

    Fără `password_hash`. Fără token-uri. Doar ce e nevoie ca să iei o decizie
    de moderare dintr-o privire.
    """

    id: uuid.UUID
    email: str
    role: str
    created_at: datetime
    last_active_at: datetime | None = None
    # Ban de moderare: `banned_at` NULL = cont în regulă.
    banned_at: datetime | None = None
    ban_reason: str | None = None
    profile_completed: bool
    name: str | None = None
    city: str | None = None
    # Câte rapoarte s-au depus ÎMPOTRIVA lui (semnal de risc în listă).
    reports_count: int = 0
    # Câmpuri suplimentare (nu sunt în tipul TS, dar sunt utile în triaj).
    age: int | None = None
    gender: str | None = None
    verified: bool = False
    photos_count: int = 0


class AdminUserDetail(AdminUserOut):
    """Fișa completă a unui user.

    Extinde listarea cu contoare de activitate și abonamentul curent. Tot fără
    niciun secret: sesiunile apar DOAR ca număr, niciodată cu `token_hash`/`jti`.
    """

    about: str | None = None
    photos: list[str] = Field(default_factory=list)
    matches_count: int = 0
    subscription_plan: str | None = None
    # Suplimentare față de tipul TS.
    languages: list[str] = Field(default_factory=list)
    dating_statuses: list[str] = Field(default_factory=list)
    profile_hidden: bool = False
    # Raportori DISTINCȚI împotriva lui (pragul de auto-ban se aplică pe ei).
    distinct_reporters: int = 0
    likes_sent: int = 0
    messages_sent: int = 0
    active_sessions: int = 0
    subscription_status: str | None = None
    subscription_expires_at: datetime | None = None


class BanIn(BaseModel):
    """Payload la banarea unui user. Motivul e OBLIGATORIU — un ban fără motiv
    e imposibil de contestat și de auditat."""

    reason: safe_str(REASON_MAX_LENGTH)


class DeleteUserIn(BaseModel):
    """Payload OPȚIONAL la ștergerea GDPR a unui cont.

    Motivul e opțional pentru că `DELETE` cu corp nu e universal suportat de
    clienți HTTP (frontendul actual nu trimite niciunul), dar CÂND e trimis intră
    în jurnalul de audit. O ștergere ireversibilă cu motiv e mereu preferabilă
    uneia fără — dar nu merită să blocăm ștergerea pentru asta.
    """

    reason: optional_safe_str(REASON_MAX_LENGTH) | None = None


# --- Moderare -----------------------------------------------------------------
class ReportedProfile(BaseModel):
    """Profilul RAPORTAT, alăturat raportului (`reported` din types.ts).

    Vine deja cu raportul ca să nu forțeze panoul să facă un fetch per rând —
    exact N+1-ul, mutat pe partea de client.
    """

    user_id: uuid.UUID
    email: str
    name: str | None = None
    age: int | None = None
    city: str | None = None
    about: str | None = None
    photos: list[str] = Field(default_factory=list)
    banned_at: datetime | None = None


class AdminReportOut(BaseModel):
    """Un raport din coada de moderare.

    `reporters_count` e numărul de raportori DISTINCȚI împotriva aceluiași user
    (nu al rapoartelor): trei rapoarte de la același om nu înseamnă nimic, trei
    rapoarte de la trei oameni înseamnă foarte mult.
    """

    id: uuid.UUID
    reporter_id: uuid.UUID
    reported_id: uuid.UUID
    category: str
    note: str | None = None
    status: ReportStatus
    created_at: datetime
    reporters_count: int = 0
    reported: ReportedProfile | None = None
    # Suplimentare față de tipul TS.
    chat_id: uuid.UUID | None = None
    total_reports: int = 0
    # True cât timp raportul așteaptă o decizie umană (coada Apple ≤24h).
    pending: bool = True


class ResolveIn(BaseModel):
    """Decizia moderatorului asupra unui raport.

    `action`:
      * `ban`  (`ban_user`)     — banează contul (revocă sesiunile, îl scoate din feed);
      * `hide` (`hide_profile`) — îl ascunde din feed fără a-i tăia accesul;
      * `dismiss`               — raport nefondat, nicio măsură.
    """

    action: ResolveAction
    # Opțional la `dismiss`, dar recomandat mereu (intră în jurnalul de audit).
    reason: optional_safe_str(REASON_MAX_LENGTH) | None = None


# --- Evenimente ---------------------------------------------------------------
class AdminEventIn(BaseModel):
    """Payload la CREAREA unui eveniment (`POST /admin/events`).

    Aici se închide un gol funcțional REAL: până acum evenimentele existau doar
    din seed-ul demo, iar seed-ul e blocat în producție (`event_service.seed_events`).
    Adică producția nu avea NICIO cale de a crea un eveniment.
    """

    title: safe_str(EVENT_TITLE_MAX_LENGTH)
    starts_at: datetime
    city: safe_str(EVENT_CITY_MAX_LENGTH)
    kind: EventKind = "other"
    description: optional_safe_str(EVENT_DESCRIPTION_MAX_LENGTH) | None = None
    venue: optional_safe_str(EVENT_VENUE_MAX_LENGTH) | None = None
    # Coordonate pentru harta Live Events — validate în intervalele geografice
    # reale (o latitudine de 500 nu e o eroare de utilizator, e o eroare de date).
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)
    cover_url: str | None = Field(default=None, max_length=EVENT_COVER_URL_MAX_LENGTH)


class AdminEventUpdate(BaseModel):
    """Payload la EDITAREA unui eveniment — actualizare PARȚIALĂ.

    Toate câmpurile sunt opționale; se scriu doar cele trimise efectiv
    (`model_dump(exclude_unset=True)`), ca un PUT cu un singur câmp să nu
    șteargă restul evenimentului. (Panoul trimite oricum obiectul complet.)
    """

    title: safe_str(EVENT_TITLE_MAX_LENGTH) | None = None
    starts_at: datetime | None = None
    city: safe_str(EVENT_CITY_MAX_LENGTH) | None = None
    kind: EventKind | None = None
    description: optional_safe_str(EVENT_DESCRIPTION_MAX_LENGTH) | None = None
    venue: optional_safe_str(EVENT_VENUE_MAX_LENGTH) | None = None
    lat: float | None = Field(default=None, ge=-90.0, le=90.0)
    lng: float | None = Field(default=None, ge=-180.0, le=180.0)
    cover_url: str | None = Field(default=None, max_length=EVENT_COVER_URL_MAX_LENGTH)


class AdminEventOut(BaseModel):
    """Un eveniment în panoul de admin (inclusiv cele TRECUTE, spre deosebire de
    `GET /events`, care arată doar viitorul)."""

    id: uuid.UUID
    title: str
    description: str | None = None
    starts_at: datetime
    city: str
    venue: str | None = None
    lat: float | None = None
    lng: float | None = None
    kind: str
    cover_url: str | None = None
    attendee_count: int = 0
    created_at: datetime


# --- Abonamente ---------------------------------------------------------------
class AdminSubscriptionOut(BaseModel):
    """Un abonament în panoul de admin, cu emailul userului DENORMALIZAT.

    `user_email` vine dintr-un JOIN făcut o singură dată pe pagină — nu dintr-un
    fetch per rând (N+1 mutat în client).
    """

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    plan: str
    status: str
    provider: str
    created_at: datetime
    expires_at: datetime | None = None
    # True dacă e 'active' ȘI nu a expirat (calculat, ca să nu-l recalculeze UI-ul).
    is_active: bool = False


class GrantSubscriptionIn(BaseModel):
    """Acordare manuală pe id de user (`POST /admin/users/{id}/grant-subscription`)."""

    plan: safe_str(PLAN_MAX_LENGTH)
    days: int | None = Field(default=None, ge=1)
    reason: optional_safe_str(REASON_MAX_LENGTH) | None = None


class GrantSubscriptionByEmailIn(BaseModel):
    """Acordare manuală pe EMAIL (`POST /admin/subscriptions`) — forma folosită
    de panou, care lucrează cu emailul, nu cu UUID-ul userului."""

    email: EmailStr
    plan: safe_str(PLAN_MAX_LENGTH)
    days: int | None = Field(default=None, ge=1)
    reason: optional_safe_str(REASON_MAX_LENGTH) | None = None


# --- Statistici ---------------------------------------------------------------
class UserStats(BaseModel):
    """Contoare de utilizatori — TOATE agregate în SQL, niciunul numărat în Python."""

    total: int = 0
    new_today: int = 0
    new_7d: int = 0
    new_30d: int = 0
    active_24h: int = 0
    # „Activ" pe fereastra din config (`admin_active_window_days`).
    active: int = 0
    banned: int = 0
    # Conturi cu cerere de ștergere în curs (perioada de grație GDPR).
    pending_deletion: int = 0
    admins: int = 0


class ProfileStats(BaseModel):
    total: int = 0
    completed: int = 0
    incomplete: int = 0
    verified: int = 0
    hidden: int = 0


class SwipeStats(BaseModel):
    swipes: int = 0
    likes: int = 0
    dislikes: int = 0
    matches: int = 0
    matches_24h: int = 0
    # matches / likes, în procente (0 dacă nu există like-uri — fără ZeroDivision).
    match_rate: float = 0.0


class ChatStats(BaseModel):
    chats: int = 0
    messages: int = 0
    masked_messages: int = 0


class ReportStats(BaseModel):
    total: int = 0
    # `pending` e contorul care contează operațional: Apple (Guideline 1.2) cere
    # răspuns la rapoartele de conținut abuziv în ≤24h.
    pending: int = 0
    resolved: int = 0
    by_category: dict[str, int] = Field(default_factory=dict)


class SubscriptionStats(BaseModel):
    active: int = 0
    by_plan: dict[str, int] = Field(default_factory=dict)
    # Venit lunar ESTIMAT: Σ(abonamente active pe plan × prețul planului din config).
    # E o estimare, nu contabilitate: nu ține cont de proration, taxe sau refund-uri.
    estimated_revenue_eur: float = 0.0


class EventStats(BaseModel):
    total: int = 0
    upcoming: int = 0
    attendances: int = 0


class AdminStats(BaseModel):
    """Dashboard-ul complet — un singur apel, ~11 query-uri agregate, constante.

    Răspunsul are DOUĂ straturi, deliberat:

      * CÂMPURILE PLATE (`users_total`, `matches_24h`, …) — contractul exact cu
        panoul React (`AdminStats` din types.ts). Sunt cele 9 cifre de pe cardurile
        din capul dashboard-ului.
      * OBIECTELE IMBRICATE (`users`, `profiles`, `swipes`, …) — detaliul complet
        cerut de specificația backendului (profiluri complete/verificate, rata de
        match, mesaje mascate, rapoarte pe categorii, abonamente pe plan, evenimente).

    Nu e redundanță gratuită: aceleași agregate SQL alimentează ambele straturi
    (zero query-uri în plus), iar TypeScript ignoră cheile pe care nu le declară.
    Alternativa — două endpoint-uri de statistici — ar fi însemnat două scanări
    ale acelorași tabele pentru un singur ecran.
    """

    # Stratul PLAT (contractul frontendului).
    users_total: int = 0
    users_active_24h: int = 0
    users_new_7d: int = 0
    users_banned: int = 0
    matches_total: int = 0
    matches_24h: int = 0
    reports_pending: int = 0
    subscriptions_active: int = 0
    revenue_estimated_eur: float = 0.0

    # Stratul DETALIAT (specificația backendului).
    users: UserStats
    profiles: ProfileStats
    swipes: SwipeStats
    chats: ChatStats
    reports: ReportStats
    subscriptions: SubscriptionStats
    events: EventStats
    generated_at: datetime


class TimeseriesPoint(BaseModel):
    """O zi din dashboard, cu TOATE seriile ei (`TimeseriesPoint` din types.ts).

    Toate graficele ecranului principal se alimentează dintr-un SINGUR apel. Un
    endpoint „o metrică per cerere" ar fi cerut 4 round-trip-uri pentru un ecran
    care se deschide o dată — pentru exact aceleași 4 agregări `GROUP BY`.
    """

    date: str  # ISO 'YYYY-MM-DD' — format stabil, independent de driver-ul DB
    users: int = 0
    matches: int = 0
    reports: int = 0
    revenue_eur: float = 0.0
    # Suplimentare față de tipul TS.
    swipes: int = 0
    messages: int = 0


class MetricPoint(BaseModel):
    """Un punct dintr-o serie temporală CU O SINGURĂ metrică."""

    date: str
    count: int


class MetricSeriesOut(BaseModel):
    """Serie temporală pentru O metrică aleasă (`/admin/stats/timeseries/{metric}`).

    Zilele fără activitate sunt completate cu 0: un grafic care sare peste zilele
    goale minte vizual (o zi cu zero înregistrări ar dispărea din axă în loc să
    apară ca o vale).
    """

    metric: str
    days: int
    points: list[MetricPoint] = Field(default_factory=list)
    total: int = 0


# --- Jurnal de audit ----------------------------------------------------------
class AuditLogOut(BaseModel):
    """O intrare din jurnalul de audit (append-only).

    `meta` conține parametrii deciziei (motiv, plan, câmpuri schimbate) — NICIODATĂ
    secrete (vezi contractul din `models/admin.py`).
    """

    id: uuid.UUID
    actor_id: uuid.UUID | None = None
    actor_email: str
    action: str
    target_type: str | None = None
    target_id: uuid.UUID | None = None
    meta: dict = Field(default_factory=dict)
    ip: str | None = None
    created_at: datetime
