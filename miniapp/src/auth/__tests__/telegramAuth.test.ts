/**
 * Testele pentru partea de CLIENT a autentificării Telegram.
 *
 * `authStore.test.ts` verifică STAREA (ce vede ecranul după login). Aici
 * verificăm ce pleacă pe fir și cum se traduce fiecare răspuns al serverului —
 * adică exact zona în care un defect nu se vede decât pe telefonul unui om
 * real: șirul `initData` modificat pe drum, SDK-ul neîncărcat, sau un 401 de
 * semnătură prezentat utilizatorului ca „mai încearcă".
 *
 * REGULA FIȘIERULUI: `initData` e un șir SEMNAT. Orice atingere — tăiere de
 * spații, reserializare, recodificare, trimiterea câmpurilor separat — rupe
 * semnătura. Testele de mai jos compară BYTE cu BYTE ce a dat clientul Telegram
 * cu ce a plecat la server.
 */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { tokenStore } from '@/api/tokenStore';
import { installTelegramStub } from '@/test/telegramStub';

import { useAuthStore } from '../authStore';
import {
  authenticateWithTelegram,
  classifyAuthError,
  TelegramAuthError,
} from '../telegramAuth';

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;
const TOKENS = { access_token: 'acces', refresh_token: 'refresh' };

function httpError(status: number, detail?: string) {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data: detail === undefined ? {} : { detail },
    status,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

function networkError() {
  return new AxiosError('Network Error', 'ERR_NETWORK', CONFIG, {});
}

/**
 * Un `initData` REAL ca formă: `user` cu nume chirilic și emoji (deci
 * procent-codificat), `photo_url`, `is_premium`, `chat_instance`, `start_param`
 * gol și câmpul `signature` al clienților noi. Exact genul de șir care a picat
 * în producție — îl folosim ca să dovedim că pleacă NEATINS.
 */
const REAL_INIT_DATA =
  'query_id=AAHdF6IQAAAAAN0XohDhrOrc&' +
  'user=%7B%22id%22%3A612345678%2C%22first_name%22%3A%22%D0%90%D0%BD%D0%B0%20' +
  '%F0%9F%92%83%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22ana_md%22%2C' +
  '%22language_code%22%3A%22ro%22%2C%22is_premium%22%3Atrue%2C' +
  '%22allows_write_to_pm%22%3Atrue%2C%22photo_url%22%3A%22https%3A%2F%2Ft.me%2Fi%2F' +
  'userpic%2F320%2FAbCdEf-_1.jpg%22%7D&' +
  'chat_instance=-3887044060699754599&chat_type=private&start_param=&' +
  'auth_date=1735689600&' +
  'signature=s3c8jWJ1bpYcVJx8n0hVQ0wWbZ4rQJ1mKQ0ZzPzk3nWQ&' +
  'hash=1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f809';

/** Corpul trimis la `/auth/telegram` de apelul `n` al spionului. */
function sentBody(
  post: { mock: { calls: unknown[][] } },
  index = 0,
): { init_data: string } {
  const call = post.mock.calls[index];
  if (!call) throw new Error(`api.post nu a fost chemat de ${index + 1} ori`);
  return call[1] as { init_data: string };
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'idle',
    user: null,
    error: null,
    optimisticName: null,
  });
  tokenStore.clear();
});

// --------------------------------------------------------------------------- //
// Șirul semnat pleacă NEATINS
// --------------------------------------------------------------------------- //

describe('initData pleacă exact cum l-a dat Telegram', () => {
  it('trimite șirul real byte cu byte, fără reserializare', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);

    await authenticateWithTelegram();

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('/auth/telegram');
    // Egalitate STRICTĂ: o singură recodificare (`%20` → `+`, `%2C` → `,`) ar
    // schimba `data_check_string` și serverul ar răspunde „semnătură invalidă".
    expect(sentBody(post)).toEqual({ init_data: REAL_INIT_DATA });
    expect(sentBody(post).init_data).toBe(REAL_INIT_DATA);
  });

  it('nu trimite NIMIC în plus pe lângă `init_data`', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);

    await authenticateWithTelegram();

    // `initDataUnsafe` NU are voie să ajungă pe fir: serverul nu-l poate
    // verifica, deci prezența lui ar fi doar o invitație să fie crezut.
    expect(Object.keys(sentBody(post))).toEqual(['init_data']);
  });

  it('păstrează câmpul `signature` al clienților noi', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);

    await authenticateWithTelegram();

    const sent = sentBody(post).init_data;
    expect(sent).toContain('signature=');
    expect(sent).toContain('start_param=&'); // parametrul gol rămâne prezent
  });

  it('nu taie spațiile de la capete (ar rupe semnătura)', async () => {
    // Nu e o formă pe care Telegram o produce, dar e exact „curățenia" pe care
    // cineva ar adăuga-o din reflex într-un refactor.
    const padded = `${REAL_INIT_DATA} `;
    installTelegramStub({ initData: padded });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);

    await authenticateWithTelegram();

    expect(sentBody(post).init_data).toBe(padded);
  });

  it('reautentificarea refolosește ACELAȘI șir — vezi limita anti-replay', async () => {
    // Telegram dă un singur `initData` per deschidere a Mini App-ului, iar
    // backendul consumă hash-ul o singură dată (anti-replay). Deci a doua
    // autentificare din aceeași sesiune va primi „already used". Testul fixează
    // faptul ăsta ca să nu fie descoperit din nou în producție: reautentificarea
    // din `initData` e o plasă de siguranță, nu un mecanism de reînnoire.
    installTelegramStub({ initData: REAL_INIT_DATA });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);

    await authenticateWithTelegram();
    await authenticateWithTelegram();

    expect(post).toHaveBeenCalledTimes(2);
    expect(sentBody(post, 1).init_data).toBe(sentBody(post, 0).init_data);
  });
});

// --------------------------------------------------------------------------- //
// Programul Telegram lipsește sau e încărcat pe jumătate
// --------------------------------------------------------------------------- //

describe('clientul Telegram lipsește sau e incomplet', () => {
  it('fără `window.Telegram` nu se face nicio cerere', async () => {
    const post = vi.spyOn(api, 'post');

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'outside_telegram',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('`window.Telegram` gol (SDK neîncărcat complet) → „în afara Telegram"', async () => {
    // Scriptul `telegram-web-app.js` creează globalul înainte de a-l popula;
    // o pagină deschisă în fereastra aia de câteva milisecunde nu are voie să
    // trimită o cerere fără date.
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: {} };
    const post = vi.spyOn(api, 'post');

    await expect(authenticateWithTelegram()).rejects.toBeInstanceOf(TelegramAuthError);
    expect(post).not.toHaveBeenCalled();
  });

  it('SDK prezent, dar `initData` gol → nicio cerere', async () => {
    installTelegramStub({ initData: '' });
    const post = vi.spyOn(api, 'post');

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'outside_telegram',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('SDK prezent, dar `initData` absent → nicio cerere', async () => {
    installTelegramStub({ initData: undefined as unknown as string });
    const post = vi.spyOn(api, 'post');

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'outside_telegram',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('un SDK care aruncă la citirea lui `initData` nu dărâmă aplicația', async () => {
    const webApp = {
      ready: () => undefined,
      get initData(): string {
        throw new Error('clientul a închis puntea');
      },
    };
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: webApp };
    const post = vi.spyOn(api, 'post');

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'outside_telegram',
    });
    expect(post).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------- //
// Fiecare tip de răspuns al serverului
// --------------------------------------------------------------------------- //

describe('fiecare eroare a backendului are un motiv propriu', () => {
  it.each([
    // `detail`-urile REALE din `backend/app/services/telegram_auth.py`.
    [401, 'Invalid Telegram init data signature', 'invalid'],
    [401, 'Invalid Telegram init data', 'invalid'],
    [401, 'Malformed Telegram init data', 'invalid'],
    [401, 'Telegram init data expired', 'expired'],
    [401, 'Telegram init data already used', 'expired'],
    // 503: login-ul Telegram nu e configurat pe server (token lipsă).
    [503, 'Telegram login is not configured', 'server'],
    // 422: schema a respins payload-ul (șir gol sau peste 4096 de caractere).
    [422, 'String should have at most 4096 characters', 'expired'],
    // 429: rate limit — nu e o problemă de identitate.
    [429, 'Too many requests, please retry later', 'server'],
    [500, undefined, 'server'],
    [502, undefined, 'server'],
  ])('%i „%s" → %s', async (status, detail, expected) => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(status, detail));

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: expected,
    });
  });

  it('cererea nu ajunge la server → „rețea", nu „identitate"', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(networkError());

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('o eroare care nu vine de la axios → „server"', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('boom'));

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it.each([
    ['răspuns gol', {}],
    ['fără access_token', { refresh_token: 'r' }],
    ['fără refresh_token', { access_token: 'a' }],
    ['access_token gol', { access_token: '', refresh_token: 'r' }],
  ])('%s → eroare de server, nu sesiune „reușită"', async (_label, data) => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockResolvedValue({ data } as never);

    await expect(authenticateWithTelegram()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it.each([
    // Ban de moderare: `_BANNED_EXC` din `backend/app/services/auth_service.py`
    // (`login_with_telegram`) și `backend/app/core/deps.py`. 403, nu 401.
    ['Account is banned'],
    // Același 403, cu mesajul tradus — clasificarea NU are voie să depindă de text.
    ['Contul este interzis'],
    ['Аккаунт заблокирован'],
  ])('403 „%s" → cont interzis, nu „date expirate"', async (detail) => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(403, detail));

    await expect(authenticateWithTelegram()).rejects.toMatchObject({ kind: 'banned' });
  });

  it('un ban descoperit abia la `/auth/me` dă tot ecranul de cont interzis', async () => {
    // `deps.get_current_user` verifică banul la FIECARE cerere, nu doar la
    // login: tokenul poate fi emis, iar contul blocat o clipă mai târziu.
    installTelegramStub();
    vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);
    vi.spyOn(api, 'get').mockRejectedValue(httpError(403, 'Account is banned'));

    await useAuthStore.getState().signIn();

    expect(useAuthStore.getState().error).toBe('banned');
  });

  it('403 fără `detail` rămâne „cont interzis" — codul e semnalul', () => {
    expect(classifyAuthError(httpError(403))).toBe('banned');
  });

  it('un 403 care vorbește despre `initData` NU e luat drept ban', () => {
    // Portiță pentru viitor: dacă backendul mută vreodată o eroare de semnătură
    // pe 403, textul decide, iar utilizatorul primește ecranul cu reîncercare.
    expect(classifyAuthError(httpError(403, 'Invalid Telegram init data signature'))).toBe(
      'invalid',
    );
  });

  it('contul interzis ajunge ca atare în starea aplicației', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(403, 'Account is banned'));

    await useAuthStore.getState().signIn();

    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('banned');
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('`classifyAuthError` nu se lasă păcălit de un `detail` care nu e text', () => {
    const weird = httpError(401);
    (weird.response as { data: unknown }).data = { detail: { code: 42 } };
    // Fără text de interpretat, varianta prudentă e cea cu soluție pentru om.
    expect(classifyAuthError(weird)).toBe('expired');
  });

  it('eroarea aruncată e mereu un `TelegramAuthError`, nu eroarea brută', async () => {
    installTelegramStub();
    vi.spyOn(api, 'post').mockRejectedValue(httpError(401, 'Invalid Telegram init data'));

    await expect(authenticateWithTelegram()).rejects.toBeInstanceOf(TelegramAuthError);
  });
});

// --------------------------------------------------------------------------- //
// `initDataUnsafe` NU e dovadă de identitate
// --------------------------------------------------------------------------- //

describe('datele NEVERIFICATE nu autentifică niciodată', () => {
  const UNSAFE = {
    user: { id: 777, first_name: 'Mallory', username: 'mallory' },
  };

  it('un `initDataUnsafe` bogat, cu `initData` gol, nu produce o sesiune', async () => {
    // Scenariul atacatorului: pagina e deschisă în afara Telegram, cu un
    // `window.Telegram` fabricat de mână. `initDataUnsafe` poate spune orice —
    // singurul lucru pe care serverul îl poate verifica lipsește.
    installTelegramStub({ initData: '', initDataUnsafe: UNSAFE as never });
    const post = vi.spyOn(api, 'post');

    await useAuthStore.getState().signIn();

    expect(post).not.toHaveBeenCalled();
    const state = useAuthStore.getState();
    expect(state.status).toBe('error');
    expect(state.user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
  });

  it('numele nesigur se arată, dar nu devine niciodată utilizatorul conectat', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA, initDataUnsafe: UNSAFE as never });
    vi.spyOn(api, 'post').mockRejectedValue(
      httpError(401, 'Invalid Telegram init data signature'),
    );

    await useAuthStore.getState().signIn();

    const state = useAuthStore.getState();
    expect(state.optimisticName).toBe('Mallory'); // doar afișare
    expect(state.user).toBeNull(); // identitatea rămâne necunoscută
    expect(state.status).toBe('error');
    expect(state.error).toBe('invalid');
  });

  it('utilizatorul conectat vine de la `/auth/me`, nu din `initDataUnsafe`', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA, initDataUnsafe: UNSAFE as never });
    const me = { id: 'u-real', email: 'telegram_612345678@ext.flirt', profile_completed: false };
    vi.spyOn(api, 'post').mockResolvedValue({ data: TOKENS } as never);
    vi.spyOn(api, 'get').mockResolvedValue({ data: me } as never);

    await useAuthStore.getState().signIn();

    const state = useAuthStore.getState();
    expect(state.user).toEqual(me);
    // Nimic din obiectul nesigur nu s-a strecurat în identitate.
    expect(JSON.stringify(state.user)).not.toContain('777');
    expect(JSON.stringify(state.user)).not.toContain('mallory');
  });

  it('tokenurile se șterg la orice eșec, ca nimic să nu rămână „pe jumătate logat"', async () => {
    installTelegramStub({ initData: REAL_INIT_DATA });
    tokenStore.setTokens('vechi-acces', 'vechi-refresh');
    vi.spyOn(api, 'post').mockRejectedValue(httpError(401, 'Telegram init data expired'));

    await useAuthStore.getState().signIn();

    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
  });
});
