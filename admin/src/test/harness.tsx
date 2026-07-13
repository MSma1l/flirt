/**
 * Unelte de test: un `fetch` fals cu tabel de rute (mock-uri simple, fără MSW) +
 * un `render` care montează aceleași provider-e ca aplicația reală.
 *
 * Rutele de admin se construiesc în paralel pe backend; testele rulează pe acest
 * dublu, care respectă contractul convenit (inclusiv cursorul din `X-Next-Cursor`).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';
import type { ReactNode } from 'react';

import { AuthProvider } from '../auth/AuthContext';
import { setAccessToken, setRefreshToken } from '../auth/tokenStore';
import { ThemeProvider } from '../theme/ThemeContext';

export interface MockResponse {
  status?: number;
  body?: unknown;
  /** Header-e suplimentare (ex. `X-Next-Cursor`). */
  headers?: Record<string, string>;
}

export interface RouteCall {
  method: string;
  url: string;
  body: unknown;
}

/** `POST /auth/login` → handler. Calea e cea de după `/api/v1`. */
export type Routes = Record<string, MockResponse | ((call: RouteCall) => MockResponse)>;

export interface FetchMock {
  fetch: Mock;
  calls: RouteCall[];
  /** Toate apelurile către o rută (`POST /admin/users/1/ban`). */
  callsTo: (key: string) => RouteCall[];
}

export function mockFetch(routes: Routes): FetchMock {
  const calls: RouteCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input.toString();
    const url = new URL(rawUrl);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const key = `${method} ${path}`;
    const body: unknown =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;

    const call: RouteCall = { method, url: rawUrl, body };
    calls.push(call);

    const handler = routes[key];
    if (handler === undefined) {
      return new Response(JSON.stringify({ detail: `Rută nemocată: ${key}` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = typeof handler === 'function' ? handler(call) : handler;
    const status = result.status ?? 200;
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...(result.headers ?? {}),
    });
    if (status === 204) return new Response(null, { status, headers });
    return new Response(JSON.stringify(result.body ?? null), { status, headers });
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetch: fetchMock,
    calls,
    callsTo: (key: string) =>
      calls.filter((call) => {
        const path = new URL(call.url).pathname.replace(/^\/api\/v1/, '');
        return `${call.method} ${path}` === key;
      }),
  };
}

/** Simulează o sesiune de admin deja autentificată. */
export function seedAdminSession(): void {
  setAccessToken('access-token-test');
  setRefreshToken('refresh-token-test');
}

export function renderWithProviders(
  ui: ReactNode,
  { route = '/' }: { route?: string } = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>{ui}</AuthProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** Statistici implicite pentru rutele care le cer în fundal (bara laterală). */
export const STATS_FIXTURE = {
  users_total: 1284,
  users_active_24h: 312,
  users_new_7d: 96,
  users_banned: 7,
  matches_total: 4210,
  matches_24h: 88,
  reports_pending: 3,
  subscriptions_active: 145,
  revenue_estimated_eur: 1450,
};

export const ADMIN_ME_FIXTURE = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'admin@flirt.app',
  role: 'admin',
};
