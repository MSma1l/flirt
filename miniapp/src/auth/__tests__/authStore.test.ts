import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { tokenStore } from '@/api/tokenStore';
import { installTelegramStub } from '@/test/telegramStub';

import { useAuthStore } from '../authStore';
import { classifyAuthError } from '../telegramAuth';

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;

function httpError(status: number, detail?: string) {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data: detail ? { detail } : {},
    status,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

function networkError() {
  return new AxiosError('Network Error', 'ERR_NETWORK', CONFIG, {});
}

const TOKENS = { access_token: 'acces', refresh_token: 'refresh' };
const ME = { id: 'u1', email: 'ana@flrt.md', profile_completed: true };

beforeEach(() => {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    error: null,
    optimisticName: null,
  });
  tokenStore.clear();
});

describe('autentificare reușită', () => {
  it('schimbă initData pe tokenuri și aduce utilizatorul', async () => {
    const { webApp } = installTelegramStub();
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);
    vi.spyOn(api, 'get').mockResolvedValue({ data: ME } as never);

    await useAuthStore.getState().signIn();

    // Trimitem șirul BRUT, exact cum l-a dat clientul — singura formă pe care
    // serverul o poate verifica.
    expect(post).toHaveBeenCalledWith('/auth/telegram', { init_data: webApp.initData });
    const state = useAuthStore.getState();
    expect(state.status).toBe('authenticated');
    expect(state.user).toEqual(ME);
    expect(tokenStore.getAccess()).toBe('acces');
  });

  it('arată numele nesigur cât timp cererea e în zbor', async () => {
    installTelegramStub();
    let seen: string | null = null;
    vi.spyOn(api, 'post').mockImplementation(async () => {
      seen = useAuthStore.getState().optimisticName;
      return { data: TOKENS } as never;
    });
    vi.spyOn(api, 'get').mockResolvedValue({ data: ME } as never);

    await useAuthStore.getState().signIn();

    expect(seen).toBe('Ana');
  });
});

describe('cazuri de eroare', () => {
  it('în afara Telegram nu trimite nimic', async () => {
    const post = vi.spyOn(api, 'post');

    await useAuthStore.getState().signIn();

    expect(post).not.toHaveBeenCalled();
    expect(useAuthStore.getState().error).toBe('outside_telegram');
    expect(useAuthStore.getState().status).toBe('error');
  });

  it('tratează SDK-ul prezent, dar fără initData, tot ca „în afara Telegram"', async () => {
    installTelegramStub({ initData: '' });
    const post = vi.spyOn(api, 'post');

    await useAuthStore.getState().signIn();

    expect(post).not.toHaveBeenCalled();
    expect(useAuthStore.getState().error).toBe('outside_telegram');
  });

  it('date expirate', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(401, 'init data expired'));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('expired');
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('date invalide (semnătură greșită)', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(401, 'invalid hash'));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('invalid');
  });

  it('lipsă de rețea', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(networkError());

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('network');
  });

  it('eroare de server', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(500));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('server');
  });

  it('token valid dar /auth/me picat → eroare de server, nu de identitate', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);
    vi.spyOn(api, 'get').mockRejectedValue(httpError(500));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('server');
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('răspuns fără tokenuri e tratat ca eroare de server', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockResolvedValue({ data: {} } as never);

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('server');
  });
});

describe('classifyAuthError — mesajele reale ale backendului', () => {
  it.each([
    ['Telegram init data expired', 'expired'],
    ['Invalid Telegram init data signature', 'invalid'],
    ['Invalid Telegram init data', 'invalid'],
    ['Malformed Telegram init data', 'invalid'],
    // Replay: aceeași soluție ca expirarea — redeschizi Mini App-ul.
    ['Telegram init data already used', 'expired'],
  ])('„%s" → %s', (detail, expected) => {
    expect(classifyAuthError(httpError(401, detail))).toBe(expected);
  });

  it('503 „login neconfigurat" e o problemă de server, nu de identitate', () => {
    expect(classifyAuthError(httpError(503, 'Telegram login is not configured'))).toBe(
      'server',
    );
  });
});

describe('classifyAuthError', () => {
  it('fără răspuns înseamnă rețea', () => {
    expect(classifyAuthError(networkError())).toBe('network');
  });

  it('401 fără detaliu clar e tratat ca expirat (varianta cu soluție)', () => {
    expect(classifyAuthError(httpError(401))).toBe('expired');
  });

  it('o eroare care nu vine de la axios e eroare de server', () => {
    expect(classifyAuthError(new Error('boom'))).toBe('server');
  });
});

describe('deconectare', () => {
  it('golește tokenurile și starea', () => {
    tokenStore.setTokens('a', 'r');
    useAuthStore.setState({ status: 'authenticated', user: ME, error: null });

    useAuthStore.getState().signOut();

    expect(tokenStore.getAccess()).toBeNull();
    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().user).toBeNull();
  });
});
