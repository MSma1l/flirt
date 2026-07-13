/**
 * Rutele de admin (`/api/v1/admin/*`), tipizate.
 *
 * Toate cer un access token de la un cont cu `role: "admin"`; altfel backend-ul
 * întoarce 403 (vezi `require_admin`).
 */
import { ApiError, apiFetch, apiPage, apiVoid } from './client';
import type {
  AdminEvent,
  AdminMe,
  AdminReport,
  AdminStats,
  AdminSubscription,
  AdminUser,
  AdminUserDetail,
  BanUserBody,
  EventInput,
  GrantSubscriptionBody,
  Page,
  ResolveAction,
  TimeseriesPoint,
  TokenPair,
  Uuid,
  UsersQuery,
} from './types';

/* ------------------------------- Auth ------------------------------- */

/**
 * Login de admin pe `/admin/login`, NU pe `/auth/login`.
 *
 * Diferența contează: `/admin/login` are rate limit STRICT (3 încercări/minut,
 * față de 5 la login-ul normal) și scrie fiecare încercare în audit log. Un cont
 * de admin spart înseamnă tot produsul spart, iar numărul de admini e mic — deci
 * un prag mic nu deranjează pe nimeni legitim, dar strânge șurubul pe brute-force.
 * Rolul e verificat DUPĂ parolă (fără oracol de enumerare) și ÎNAINTE de emiterea
 * token-urilor (fără sesiune orfană de 30 de zile pentru un non-admin).
 */
export function login(email: string, password: string): Promise<TokenPair> {
  return apiFetch<TokenPair>('/admin/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  });
}

export function logout(refreshToken: string): Promise<void> {
  return apiVoid('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

/**
 * Verifică faptul că token-ul curent aparține unui ADMIN.
 *
 * `GET /api/v1/auth/me` NU expune rolul (`UserOut` = id/email/profile_completed),
 * deci nu putem decide din el. Sursa de adevăr rămâne backend-ul: `/admin/me`
 * răspunde doar administratorilor. Dacă ruta nu există încă (404), cădem elegant
 * pe `/admin/stats`, care e protejată de aceeași gardă și dă tot 403 pentru
 * non-admini.
 */
export async function fetchAdminMe(): Promise<AdminMe> {
  try {
    return await apiFetch<AdminMe>('/admin/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await apiFetch<AdminStats>('/admin/stats');
      return { id: '', email: '', role: 'admin' };
    }
    throw error;
  }
}

/* ---------------------------- Statistici ---------------------------- */

export function fetchStats(): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats');
}

export function fetchTimeseries(days: number): Promise<TimeseriesPoint[]> {
  return apiFetch<TimeseriesPoint[]>('/admin/stats/timeseries', { query: { days } });
}

/* ------------------------------ Moderare ---------------------------- */

export function fetchReports(params: {
  status?: string;
  cursor?: string;
}): Promise<Page<AdminReport>> {
  return apiPage<AdminReport>('/admin/reports', {
    query: { status: params.status, cursor: params.cursor },
  });
}

export function resolveReport(
  id: Uuid,
  action: ResolveAction,
  reason?: string,
): Promise<void> {
  return apiVoid(`/admin/reports/${id}/resolve`, {
    method: 'POST',
    body: reason === undefined ? { action } : { action, reason },
  });
}

/* ---------------------------- Utilizatori --------------------------- */

export function fetchUsers(query: UsersQuery): Promise<Page<AdminUser>> {
  return apiPage<AdminUser>('/admin/users', {
    query: {
      q: query.q,
      status: query.status === 'all' ? undefined : query.status,
      cursor: query.cursor,
      limit: query.limit,
    },
  });
}

export function fetchUser(id: Uuid): Promise<AdminUserDetail> {
  return apiFetch<AdminUserDetail>(`/admin/users/${id}`);
}

export function banUser(id: Uuid, body: BanUserBody): Promise<void> {
  return apiVoid(`/admin/users/${id}/ban`, { method: 'POST', body: { ...body } });
}

export function unbanUser(id: Uuid): Promise<void> {
  return apiVoid(`/admin/users/${id}/unban`, { method: 'POST' });
}

/** Ștergere GDPR — IREVERSIBILĂ. UI-ul cere confirmare dublă. */
export function deleteUser(id: Uuid): Promise<void> {
  return apiVoid(`/admin/users/${id}`, { method: 'DELETE' });
}

/* ---------------------------- Evenimente ---------------------------- */

export function fetchEvents(cursor?: string): Promise<Page<AdminEvent>> {
  return apiPage<AdminEvent>('/admin/events', { query: { cursor } });
}

export function createEvent(input: EventInput): Promise<AdminEvent> {
  return apiFetch<AdminEvent>('/admin/events', { method: 'POST', body: { ...input } });
}

export function updateEvent(id: Uuid, input: EventInput): Promise<AdminEvent> {
  return apiFetch<AdminEvent>(`/admin/events/${id}`, { method: 'PUT', body: { ...input } });
}

export function deleteEvent(id: Uuid): Promise<void> {
  return apiVoid(`/admin/events/${id}`, { method: 'DELETE' });
}

/* ---------------------------- Abonamente ---------------------------- */

export function fetchSubscriptions(params: {
  status?: string;
  cursor?: string;
}): Promise<Page<AdminSubscription>> {
  return apiPage<AdminSubscription>('/admin/subscriptions', {
    query: { status: params.status, cursor: params.cursor },
  });
}

export function grantSubscription(body: GrantSubscriptionBody): Promise<AdminSubscription> {
  return apiFetch<AdminSubscription>('/admin/subscriptions', {
    method: 'POST',
    body: { ...body },
  });
}
