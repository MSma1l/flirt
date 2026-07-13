/**
 * Contractul de date dintre panoul de admin și backend (`/api/v1/admin/*`).
 *
 * Sursa adevărului: modelele SQLAlchemy din `backend/app/models` (user, moderation,
 * event, billing) + rutele de admin. Tipurile de mai jos sunt DTO-uri de citire —
 * NU conțin niciodată secrete (hash-uri de parolă, token-uri).
 *
 * ATENȚIE: toate câmpurile de tip text care provin de la utilizatori (`name`,
 * `about`, `note`, `ban_reason`, `email`) sunt input NETRUSTED. Se afișează
 * exclusiv ca text (React escapează implicit); `dangerouslySetInnerHTML` este
 * interzis în tot proiectul.
 */

export type Uuid = string;
/** Dată-timp ISO 8601 (UTC), așa cum o serializează FastAPI. */
export type IsoDateTime = string;

/* ---------------- Auth ---------------- */

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AdminMe {
  id: Uuid;
  email: string;
  role: string;
}

/* ---------------- Statistici ---------------- */

export interface AdminStats {
  users_total: number;
  users_active_24h: number;
  users_new_7d: number;
  users_banned: number;
  matches_total: number;
  matches_24h: number;
  reports_pending: number;
  subscriptions_active: number;
  revenue_estimated_eur: number;
}

/** Un punct din seria temporală: o zi, cu contoarele ei. */
export interface TimeseriesPoint {
  date: string; // YYYY-MM-DD
  users: number;
  matches: number;
  reports: number;
  revenue_eur: number;
}

/* ---------------- Moderare ---------------- */

export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/** Acțiunile de rezolvare a unui raport. Toate cele distructive cer confirmare. */
export type ResolveAction = 'ban' | 'hide' | 'dismiss';

export interface ReportedProfile {
  user_id: Uuid;
  email: string;
  name: string | null;
  age: number | null;
  city: string | null;
  about: string | null;
  photos: string[];
  banned_at: IsoDateTime | null;
}

export interface AdminReport {
  id: Uuid;
  reporter_id: Uuid;
  reported_id: Uuid;
  category: string;
  note: string | null;
  status: ReportStatus;
  created_at: IsoDateTime;
  /** Câți utilizatori distincți au raportat același profil. */
  reporters_count: number;
  reported: ReportedProfile | null;
}

export interface ResolveReportBody {
  action: ResolveAction;
  reason?: string;
}

/* ---------------- Utilizatori ---------------- */

export interface AdminUser {
  id: Uuid;
  email: string;
  role: string;
  name: string | null;
  city: string | null;
  created_at: IsoDateTime;
  last_active_at: IsoDateTime | null;
  banned_at: IsoDateTime | null;
  ban_reason: string | null;
  profile_completed: boolean;
  reports_count: number;
}

export interface AdminUserDetail extends AdminUser {
  age: number | null;
  about: string | null;
  photos: string[];
  matches_count: number;
  subscription_plan: string | null;
}

export type UserStatusFilter = 'all' | 'active' | 'banned' | 'reported';

export interface UsersQuery {
  q?: string;
  status?: UserStatusFilter;
  cursor?: string;
  limit?: number;
}

export interface BanUserBody {
  reason: string;
}

/* ---------------- Evenimente ---------------- */

export interface AdminEvent {
  id: Uuid;
  title: string;
  description: string | null;
  starts_at: IsoDateTime;
  city: string;
  venue: string | null;
  lat: number | null;
  lng: number | null;
  kind: string;
  cover_url: string | null;
  attendee_count: number;
}

/** Payload de creare/editare — exact câmpurile scriibile ale modelului `Event`. */
export interface EventInput {
  title: string;
  description: string | null;
  starts_at: IsoDateTime;
  city: string;
  venue: string | null;
  lat: number | null;
  lng: number | null;
  kind: string;
  cover_url: string | null;
}

export const EVENT_KINDS = [
  'party',
  'concert',
  'bar',
  'sport',
  'culture',
  'other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/* ---------------- Abonamente ---------------- */

export type SubscriptionStatus = 'active' | 'expired' | 'canceled';

export interface AdminSubscription {
  id: Uuid;
  user_id: Uuid;
  user_email: string;
  plan: string;
  status: SubscriptionStatus;
  provider: string;
  created_at: IsoDateTime;
  expires_at: IsoDateTime | null;
}

/**
 * Planurile REALE din catalog (`backend/app/services/billing.py` → `PLANS`, TZ 9).
 * Prețurile vin din config (`price_*`), nu de aici.
 *
 * ATENȚIE: aici erau `plus` și `vip` — planuri care NU EXISTĂ în backend. Orice
 * încercare de a acorda unul dintre ele primea 400. Dacă adaugi un plan nou, el
 * se adaugă ÎNTÂI în catalogul backend-ului, apoi aici.
 */
export const SUBSCRIPTION_PLANS = [
  'premium',
  'no_ads',
  'ai_bot',
  'all_inclusive',
] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

/** Acordare manuală de abonament (provider = `manual` pe backend). */
export interface GrantSubscriptionBody {
  email: string;
  plan: string;
  days: number;
}

/* ---------------- Paginare ---------------- */

/**
 * Convenția de paginare a proiectului: corpul răspunsului e o LISTĂ simplă, iar
 * cursorul următor vine în header-ul `X-Next-Cursor` (expus prin CORS în
 * `backend/app/main.py`). `next_cursor === null` înseamnă ultima pagină.
 */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}
