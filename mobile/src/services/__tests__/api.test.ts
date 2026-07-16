/**
 * Interceptorul de 401: ce se întâmplă când sesiunea nu mai poate fi salvată.
 *
 * Testăm prin adapterul lui axios (răspunsuri simulate), nu prin rețea reală.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { api, setUnauthorizedHandler } from '../api';
import { tokenStore } from '../tokenStore';

/** Adapter care răspunde mereu 401 la cererile instanței `api`. */
function respondUnauthorized(config: InternalAxiosRequestConfig): Promise<never> {
  return Promise.reject(
    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
      status: 401,
      statusText: 'Unauthorized',
      data: {},
      headers: {},
      config,
    }),
  );
}

describe('api — 401 cu refresh eșuat', () => {
  beforeEach(async () => {
    api.defaults.adapter = respondUnauthorized;
    setUnauthorizedHandler(null);
    await tokenStore.clear();
    jest.restoreAllMocks();
  });

  afterAll(() => {
    setUnauthorizedHandler(null);
  });

  it('cheamă handlerul de sesiune expirată când /auth/refresh eșuează', async () => {
    await tokenStore.setTokens('access-mort', 'refresh-mort');
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh respins'));
    const handler = jest.fn(() => Promise.resolve());
    setUnauthorizedHandler(handler);

    await expect(api.get('/settings')).rejects.toBeDefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('cheamă handlerul și când nu mai există niciun refresh token', async () => {
    const handler = jest.fn(() => Promise.resolve());
    setUnauthorizedHandler(handler);

    await expect(api.get('/settings')).rejects.toBeDefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fără handler înregistrat, golește oricum tokenurile', async () => {
    await tokenStore.setTokens('access-mort', 'refresh-mort');
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('refresh respins'));

    await expect(api.get('/settings')).rejects.toBeDefined();

    expect(tokenStore.getAccess()).toBeNull();
    await expect(tokenStore.getRefresh()).resolves.toBeNull();
  });

  it('refresh reușit: reia cererea originală cu tokenul nou', async () => {
    await tokenStore.setTokens('access-vechi', 'refresh-bun');
    jest.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'access-nou', refresh_token: 'refresh-nou' },
    });
    const handler = jest.fn(() => Promise.resolve());
    setUnauthorizedHandler(handler);

    // Prima cerere primește 401, a doua (după refresh) trece.
    let calls = 0;
    api.defaults.adapter = (config) => {
      calls += 1;
      if (calls === 1) return respondUnauthorized(config);
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        data: { ok: true },
        headers: {},
        config,
      });
    };

    const res = await api.get('/settings');

    expect(res.data).toEqual({ ok: true });
    // Sesiunea a fost salvată — userul NU trebuie deconectat.
    expect(handler).not.toHaveBeenCalled();
    expect(tokenStore.getAccess()).toBe('access-nou');
  });
});
