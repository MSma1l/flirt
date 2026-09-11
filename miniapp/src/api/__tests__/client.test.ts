import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, setReauthHandler, setUnauthorizedHandler } from '../client';
import { tokenStore } from '../tokenStore';

const originalAdapter = api.defaults.adapter;

function ok(config: InternalAxiosRequestConfig, data: unknown = { ok: true }) {
  return Promise.resolve({
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
}

function unauthorized(config: InternalAxiosRequestConfig) {
  return Promise.reject(
    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
      data: {},
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    }),
  );
}

/** Înlocuiește transportul instanței, ca testele să nu atingă rețeaua. */
function useAdapter(adapter: AxiosAdapter) {
  api.defaults.adapter = adapter;
}

beforeEach(() => {
  tokenStore.clear();
  setUnauthorizedHandler(null);
  setReauthHandler(null);
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
  setUnauthorizedHandler(null);
  setReauthHandler(null);
});

describe('interceptorul de cerere', () => {
  it('atașează token-ul din memorie', async () => {
    tokenStore.setAccess('acces-1');
    const adapter = vi.fn(ok);
    useAdapter(adapter);

    await api.get('/feed/');

    expect(adapter.mock.calls[0]?.[0].headers.Authorization).toBe('Bearer acces-1');
  });

  it('nu trimite antet de autorizare fără token', async () => {
    const adapter = vi.fn(ok);
    useAdapter(adapter);

    await api.get('/feed/');

    expect(adapter.mock.calls[0]?.[0].headers.Authorization).toBeUndefined();
  });
});

describe('reînnoirea la 401', () => {
  it('reînnoiește cu refresh token-ul și reia cererea cu token nou', async () => {
    tokenStore.setTokens('acces-vechi', 'refresh-1');
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'acces-nou', refresh_token: 'refresh-2' },
    } as never);

    const adapter = vi.fn((config: InternalAxiosRequestConfig) =>
      config.headers.Authorization === 'Bearer acces-nou' ? ok(config) : unauthorized(config),
    );
    useAdapter(adapter);

    const res = await api.get('/feed/');

    expect(res.data).toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledOnce();
    expect(tokenStore.getAccess()).toBe('acces-nou');
    expect(tokenStore.getRefresh()).toBe('refresh-2');
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('dedublează reînnoirea pentru cereri concurente', async () => {
    tokenStore.setTokens('acces-vechi', 'refresh-1');
    const refresh = vi.spyOn(axios, 'post').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                data: { access_token: 'acces-nou', refresh_token: 'refresh-2' },
              } as never),
            10,
          ),
        ),
    );

    useAdapter((config) =>
      config.headers.Authorization === 'Bearer acces-nou' ? ok(config) : unauthorized(config),
    );

    await Promise.all([api.get('/feed/'), api.get('/chats'), api.get('/profile')]);

    // O singură cerere de reînnoire pentru toate trei: backendul rotește
    // refresh token-ul, deci trei reînnoiri paralele s-ar invalida reciproc.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('cade pe reautentificarea din initData când nu există refresh token', async () => {
    const reauth = vi.fn().mockResolvedValue({
      access_token: 'acces-tg',
      refresh_token: 'refresh-tg',
    });
    setReauthHandler(reauth);
    const refresh = vi.spyOn(axios, 'post');

    useAdapter((config) =>
      config.headers.Authorization === 'Bearer acces-tg' ? ok(config) : unauthorized(config),
    );

    const res = await api.get('/feed/');

    expect(res.status).toBe(200);
    expect(reauth).toHaveBeenCalledOnce();
    // Fără refresh token în memorie nu are rost o cerere către /auth/refresh.
    expect(refresh).not.toHaveBeenCalled();
    expect(tokenStore.getAccess()).toBe('acces-tg');
  });

  it('cere reautentificare dacă și refresh token-ul e respins', async () => {
    tokenStore.setTokens('acces-vechi', 'refresh-mort');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'));
    const reauth = vi.fn().mockResolvedValue({
      access_token: 'acces-tg',
      refresh_token: 'refresh-tg',
    });
    setReauthHandler(reauth);

    useAdapter((config) =>
      config.headers.Authorization === 'Bearer acces-tg' ? ok(config) : unauthorized(config),
    );

    await api.get('/feed/');

    expect(reauth).toHaveBeenCalledOnce();
  });

  it('anunță sesiunea pierdută când nici reautentificarea nu merge', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    setReauthHandler(vi.fn().mockResolvedValue(null));
    tokenStore.setAccess('acces-vechi');

    const adapter = vi.fn(unauthorized);
    useAdapter(adapter);

    await expect(api.get('/feed/')).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    // O singură încercare: fără reînnoire reușită nu se reia nimic.
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('golește tokenurile când nimeni nu s-a înregistrat pentru 401', async () => {
    tokenStore.setTokens('acces-vechi', '');
    useAdapter(unauthorized);

    await expect(api.get('/feed/')).rejects.toBeInstanceOf(AxiosError);
    expect(tokenStore.getAccess()).toBeNull();
  });
});

describe('protecția anti-buclă', () => {
  it('nu reînnoiește pentru rutele de autentificare', async () => {
    tokenStore.setTokens('acces', 'refresh-1');
    const refresh = vi.spyOn(axios, 'post');
    const adapter = vi.fn(unauthorized);
    useAdapter(adapter);

    await expect(api.post('/auth/telegram', { init_data: 'x' })).rejects.toBeInstanceOf(
      AxiosError,
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('reia cererea o SINGURĂ dată, chiar dacă și reluarea ia 401', async () => {
    tokenStore.setTokens('acces-vechi', 'refresh-1');
    vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'acces-nou', refresh_token: 'refresh-2' },
    } as never);

    // Serverul răspunde 401 orice ar fi: fără `_retry` s-ar intra în buclă.
    const adapter = vi.fn(unauthorized);
    useAdapter(adapter);

    await expect(api.get('/feed/')).rejects.toBeInstanceOf(AxiosError);
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
