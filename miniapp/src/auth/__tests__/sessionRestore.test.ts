/**
 * Regresie: reîncărcarea Mini App-ului nu mai consumă din nou `initData`.
 *
 * Telegram dă ACELAȘI `initData` pe toată durata unei lansări (stă în
 * fragmentul adresei), iar backendul îl acceptă o singură dată (anti-replay,
 * cod `init_data_reused`). Testele de aici trec prin clientul HTTP REAL
 * (interceptori, reînnoire, rotație) — doar transportul e înlocuit — ca să
 * dovedească drumul complet: sesiune salvată → `/auth/me` → eventual
 * `/auth/refresh` → abia la urmă `POST /auth/telegram`.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { tokenStore } from '@/api/tokenStore';
import { installTelegramStub } from '@/test/telegramStub';

import { useAuthStore } from '../authStore';

const KEY = 'flirt.session';
const ME = { id: 'u1', email: 'ana@flrt.md', profile_completed: true };
const originalAdapter = api.defaults.adapter;

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  if (status < 400) {
    return Promise.resolve({ data, status, statusText: '', headers: {}, config });
  }
  return Promise.reject(
    new AxiosError('eroare', 'ERR_BAD_REQUEST', config, null, {
      data,
      status,
      statusText: '',
      headers: {},
      config,
    }),
  );
}

interface Server {
  /** Accesul pe care `/auth/me` îl acceptă. */
  validAccess: string;
  /** Răspunsul la `POST /auth/telegram`. */
  telegram: { status: number; data: unknown };
  calls: string[];
}

/** Un backend minimal, la nivel de transport. */
function installServer(overrides: Partial<Server> = {}): Server {
  const server: Server = {
    validAccess: 'acces-salvat',
    telegram: { status: 200, data: { access_token: 'acces-tg', refresh_token: 'refresh-tg' } },
    calls: [],
    ...overrides,
  };
  api.defaults.adapter = (config) => {
    const url = config.url ?? '';
    server.calls.push(`${config.method?.toUpperCase()} ${url}`);
    if (url === '/auth/telegram') {
      return respond(config, server.telegram.status, server.telegram.data);
    }
    if (url === '/auth/me') {
      const auth = String(config.headers.Authorization ?? '');
      return auth === `Bearer ${server.validAccess}`
        ? respond(config, 200, ME)
        : respond(config, 401, { detail: 'Token invalid' });
    }
    return respond(config, 404, {});
  };
  return server;
}

/** Ce rămâne după o reîncărcare a paginii: doar `sessionStorage`. */
function savedSession(owner: string, access: string, refresh: string) {
  tokenStore.clear();
  window.sessionStorage.setItem(KEY, JSON.stringify({ owner, access, refresh }));
}

const telegramPosts = (server: Server) =>
  server.calls.filter((c) => c === 'POST /auth/telegram').length;

const REPLAY = {
  status: 401,
  data: { detail: 'Telegram init data already used', code: 'init_data_reused' },
};

beforeEach(() => {
  window.sessionStorage.clear();
  useAuthStore.setState({ status: 'idle', user: null, error: null, optimisticName: null });
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

describe('pornirea cu sesiune salvată', () => {
  it('reîncărcarea cu tokenuri salvate NU mai trimite initData', async () => {
    installTelegramStub(); // utilizatorul Telegram cu id 1
    // initData a fost deja consumat la prima pornire: dacă l-am retrimite,
    // serverul ar răspunde cu replay.
    const server = installServer({ telegram: REPLAY });
    savedSession('1', 'acces-salvat', 'refresh-salvat');

    await useAuthStore.getState().signIn();

    expect(telegramPosts(server)).toBe(0);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().user).toEqual(ME);
  });

  it('ignoră tokenurile salvate ale ALTUI cont Telegram', async () => {
    installTelegramStub(); // id 1
    const server = installServer({ validAccess: 'acces-tg' });
    savedSession('999', 'acces-strain', 'refresh-strain');
    const refresh = vi.spyOn(axios, 'post');

    await useAuthStore.getState().signIn();

    // Nicio cerere cu tokenurile străine: nici /auth/me, nici /auth/refresh.
    expect(refresh).not.toHaveBeenCalled();
    expect(telegramPosts(server)).toBe(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}')).toEqual({
      owner: '1',
      access: 'acces-tg',
      refresh: 'refresh-tg',
    });
  });

  it('acces expirat → reînnoire prin /auth/refresh, perechea rotită e salvată', async () => {
    installTelegramStub();
    const server = installServer({ validAccess: 'acces-nou', telegram: REPLAY });
    savedSession('1', 'acces-expirat', 'refresh-salvat');
    const refresh = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'acces-nou', refresh_token: 'refresh-rotit' },
    } as never);

    await useAuthStore.getState().signIn();

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0]?.[0]).toMatch(/\/auth\/refresh$/);
    expect(refresh.mock.calls[0]?.[1]).toEqual({ refresh_token: 'refresh-salvat' });
    expect(telegramPosts(server)).toBe(0);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}')).toEqual({
      owner: '1',
      access: 'acces-nou',
      refresh: 'refresh-rotit',
    });
  });

  it('refresh respins → o SINGURĂ autentificare din initData', async () => {
    installTelegramStub();
    const server = installServer({ validAccess: 'acces-tg' });
    savedSession('1', 'acces-expirat', 'refresh-mort');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'));

    await useAuthStore.getState().signIn();

    expect(telegramPosts(server)).toBe(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(tokenStore.getRefresh()).toBe('refresh-tg');
  });

  it('refresh respins + initData deja folosit → „reused", tokenuri șterse', async () => {
    installTelegramStub();
    const server = installServer({ telegram: REPLAY });
    savedSession('1', 'acces-expirat', 'refresh-mort');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'));

    await useAuthStore.getState().signIn();

    expect(telegramPosts(server)).toBe(1);
    expect(useAuthStore.getState().error).toBe('reused');
    expect(tokenStore.getRefresh()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('refresh respins + initData expirat → „expired", tokenuri șterse', async () => {
    installTelegramStub();
    installServer({ telegram: { status: 401, data: { detail: 'Telegram init data expired' } } });
    savedSession('1', 'vechi-acces', 'vechi-refresh');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('expired');
    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
  });

  it('în afara Telegram nu restaurează nimic, chiar dacă există o sesiune salvată', async () => {
    installTelegramStub({ initData: '' });
    const server = installServer();
    savedSession('1', 'acces-salvat', 'refresh-salvat');

    await useAuthStore.getState().signIn();

    expect(server.calls).toHaveLength(0);
    expect(useAuthStore.getState().error).toBe('outside_telegram');
  });
});

describe('initData deja folosit, fără sesiune salvată', () => {
  it('ajunge „reused", iar o reîncercare nu intră în buclă de cereri', async () => {
    installTelegramStub();
    const server = installServer({ telegram: REPLAY });

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('reused');
    // Un singur drum la server — fără reîncercări automate.
    expect(telegramPosts(server)).toBe(1);
  });
});

describe('apeluri simultane (React StrictMode)', () => {
  it('două signIn simultane → O SINGURĂ cerere /auth/telegram', async () => {
    installTelegramStub();
    const server = installServer({ validAccess: 'acces-tg' });

    const a = useAuthStore.getState().signIn();
    const b = useAuthStore.getState().signIn();
    expect(a).toBe(b);
    await Promise.all([a, b]);

    expect(telegramPosts(server)).toBe(1);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});

describe('stocarea blocată', () => {
  it('merge din memorie când sessionStorage aruncă', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('stocare blocată');
      },
    });

    try {
      installTelegramStub();
      const server = installServer({ validAccess: 'acces-tg' });

      await useAuthStore.getState().signIn();
      expect(useAuthStore.getState().status).toBe('authenticated');

      // O a doua pornire în aceeași pagină refolosește memoria, nu initData.
      await useAuthStore.getState().signIn();
      expect(telegramPosts(server)).toBe(1);
      expect(useAuthStore.getState().status).toBe('authenticated');
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});
