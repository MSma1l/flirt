/**
 * Stratul HTTP al panoului de admin.
 *
 *  * Baza API-ului vine din mediu (`VITE_API_URL`) — NU e hardcodată.
 *  * Access token-ul se atașează ca `Authorization: Bearer` din memorie.
 *  * La 401 se încearcă O SINGURĂ rotație de refresh (single-flight), apoi se reia
 *    cererea; dacă și asta cade, sesiunea e ștearsă și se emite `auth:expired`.
 *  * La 403 aruncăm o eroare tipizată `ApiError` cu `status = 403` — ecranul de
 *    login o traduce în „contul nu are drepturi de administrator", nu în
 *    „eroare necunoscută".
 *  * Paginarea citește cursorul din header-ul `X-Next-Cursor` (convenția proiectului).
 */
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '../auth/tokenStore';
import type { Page, TokenPair } from './types';

const RAW_BASE =
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_API_BASE_URL ??
  'http://localhost:8000';

export const API_PREFIX = '/api/v1';

/**
 * Baza normalizată: fără `/` final ȘI fără `/api/v1` duplicat.
 *
 * BUG REAL, prins în producție: `VITE_API_URL` fusese setat pe
 * `https://api.flrt.md/api/v1` (forma folosită de aplicația MOBILĂ, unde
 * `EXPO_PUBLIC_API_URL` E baza completă, cu prefix). Clientul ăsta adaugă însă
 * `API_PREFIX` singur, deci ieșea `https://api.flrt.md/api/v1/api/v1/admin/login`
 * — adică `/api/v1` de DOUĂ ori → **404 la fiecare cerere**, inclusiv la login.
 *
 * Cele două convenții (mobil = bază CU prefix, admin = bază FĂRĂ prefix) sunt o
 * capcană garantată. În loc să ne bazăm pe faptul că cine setează variabila își
 * amintește care e care, o tăiem aici: dacă baza se termină deja în `/api/v1`,
 * o eliminăm. Ambele forme funcționează acum.
 */
export const API_BASE = RAW_BASE.replace(/\/+$/, '').replace(
  new RegExp(`${API_PREFIX}$`),
  '',
);

export const NEXT_CURSOR_HEADER = 'X-Next-Cursor';
/** Eveniment emis când sesiunea nu mai poate fi reînnoită. */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }

  /** Contul e autentificat, dar nu are rolul `admin` (sau e banat). */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Eroare de rețea / backend indisponibil — status 0. */
export class NetworkError extends ApiError {
  constructor(message = 'Serverul nu răspunde. Verifică conexiunea.') {
    super(0, message);
    this.name = 'NetworkError';
  }
}

type Json = Record<string, unknown> | unknown[] | null;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: Json;
  query?: Record<string, string | number | boolean | undefined>;
  /** Nu atașa `Authorization` și nu încerca refresh (folosit de /auth/login). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${API_BASE}${API_PREFIX}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Extrage un mesaj lizibil din corpul de eroare FastAPI (`{detail: ...}`). */
async function extractDetail(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object' && 'detail' in data) {
      const detail = (data as { detail: unknown }).detail;
      if (typeof detail === 'string') return detail;
      // FastAPI 422: listă de erori de validare.
      if (Array.isArray(detail)) {
        const first = detail[0];
        if (first && typeof first === 'object' && 'msg' in first) {
          const msg = (first as { msg: unknown }).msg;
          if (typeof msg === 'string') return msg;
        }
      }
    }
  } catch {
    // corp gol sau non-JSON
  }
  return `Eroare ${response.status}`;
}

/* ---------------------------- refresh single-flight -------------------------- */

let refreshInFlight: Promise<string | null> | null = null;

async function rotateRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  const response = await fetch(buildUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) return null;

  const pair = (await response.json()) as TokenPair;
  setAccessToken(pair.access_token);
  setRefreshToken(pair.refresh_token);
  return pair.access_token;
}

/** O singură rotație concurentă, oricâte cereri ar primi 401 simultan. */
function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= rotateRefresh()
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

function onSessionExpired(): void {
  clearTokens();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
  }
}

/* --------------------------------- fetch core -------------------------------- */

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, anonymous, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const token = getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal) init.signal = signal;

  try {
    return await fetch(buildUrl(path, query), init);
  } catch {
    throw new NetworkError();
  }
}

async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  let response = await send(path, options);

  if (response.status === 401 && !options.anonymous) {
    const token = await refreshOnce();
    if (token === null) {
      onSessionExpired();
      throw new ApiError(401, 'Sesiune expirată. Autentifică-te din nou.');
    }
    response = await send(path, options);
    if (response.status === 401) {
      onSessionExpired();
      throw new ApiError(401, 'Sesiune expirată. Autentifică-te din nou.');
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractDetail(response));
  }
  return response;
}

/** Cerere care întoarce JSON tipizat. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Cerere fără corp de răspuns (204 No Content). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await request(path, options);
}

/**
 * Cerere paginată: corpul e o listă simplă, cursorul următor vine în
 * `X-Next-Cursor`. Acceptă și forma `{items, next_cursor}` dacă backend-ul
 * întoarce obiectul (unele rute folosesc `EventPage`) — ambele sunt tratate.
 */
export async function apiPage<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Page<T>> {
  const response = await request(path, options);
  const headerCursor = response.headers.get(NEXT_CURSOR_HEADER);
  const data: unknown = response.status === 204 ? [] : await response.json();

  if (Array.isArray(data)) {
    return { items: data as T[], next_cursor: headerCursor };
  }
  if (data && typeof data === 'object' && 'items' in data) {
    const envelope = data as { items: T[]; next_cursor?: string | null };
    return {
      items: envelope.items,
      next_cursor: headerCursor ?? envelope.next_cursor ?? null,
    };
  }
  return { items: [], next_cursor: null };
}
