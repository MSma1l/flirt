import { describe, expect, it } from 'vitest';

import { ApiError, apiFetch, apiPage } from './client';
import { getAccessToken, setAccessToken, setRefreshToken } from '../auth/tokenStore';
import { mockFetch } from '../test/harness';

describe('client HTTP', () => {
  it('citește cursorul din header-ul X-Next-Cursor, nu din corp', async () => {
    setAccessToken('acc');
    mockFetch({
      'GET /admin/users': { body: [{ id: 'u-1' }], headers: { 'X-Next-Cursor': 'c-2' } },
    });

    const page = await apiPage<{ id: string }>('/admin/users');
    expect(page.items).toHaveLength(1);
    expect(page.next_cursor).toBe('c-2');
  });

  it('atașează Bearer token-ul din memorie', async () => {
    setAccessToken('acc-123');
    const api = mockFetch({ 'GET /admin/stats': { body: {} } });

    await apiFetch('/admin/stats');

    const init = api.fetch.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer acc-123');
  });

  it('la 401 rotește refresh-ul o singură dată și reia cererea', async () => {
    setAccessToken('expirat');
    setRefreshToken('ref-1');

    let statsCalls = 0;
    const api = mockFetch({
      'GET /admin/stats': () => {
        statsCalls += 1;
        return statsCalls === 1
          ? { status: 401, body: { detail: 'expired' } }
          : { body: { users_total: 5 } };
      },
      'POST /auth/refresh': {
        body: { access_token: 'acc-nou', refresh_token: 'ref-2', token_type: 'bearer' },
      },
    });

    const stats = await apiFetch<{ users_total: number }>('/admin/stats');

    expect(stats.users_total).toBe(5);
    expect(api.callsTo('POST /auth/refresh')).toHaveLength(1);
    expect(getAccessToken()).toBe('acc-nou');
  });

  it('propagă 403 ca ApiError.isForbidden', async () => {
    setAccessToken('acc');
    mockFetch({ 'GET /admin/stats': { status: 403, body: { detail: 'Admin role required' } } });

    await expect(apiFetch('/admin/stats')).rejects.toSatisfy(
      (error: unknown) => error instanceof ApiError && error.isForbidden,
    );
  });
});
