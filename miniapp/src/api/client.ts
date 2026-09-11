/**
 * Client HTTP cu JWT Bearer + reînnoire automată la 401.
 *
 * Port al lui `mobile/src/services/api.ts`. Păstrate identic:
 *  - o singură instanță axios, fără `Content-Type` implicit (altfel `FormData`
 *    ar fi serializat ca JSON de axios 1.x și uploadul ar pleca fără fișier);
 *  - interceptorul de cerere care atașează token-ul din memorie;
 *  - reînnoirea la 401, o SINGURĂ dată per cerere (`_retry`), niciodată pentru
 *    rutele `/auth/` (altfel un login greșit ar intra în buclă);
 *  - dedublarea cererilor concurente de reînnoire printr-o promisiune comună.
 *
 * Diferența față de mobil: când nu există refresh token (cazul normal la
 * pornire, fiindcă nu persistăm nimic — vezi `tokenStore.ts`), reînnoirea cade
 * pe reautentificarea din `initData` Telegram, înregistrată de `auth/`.
 */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { config } from '@/config';

import { tokenStore } from './tokenStore';

export const api = axios.create({
  baseURL: config.apiUrl,
  timeout: 60000,
});

api.interceptors.request.use((cfg) => {
  const token = tokenStore.getAccess();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/**
 * Sesiune expirată: cine reacționează când reînnoirea eșuează definitiv.
 * Store-ul de autentificare își înregistrează handlerul la încărcare, ca aici
 * să nu avem nevoie de un import invers (care ar închide un ciclu).
 */
type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

/**
 * Reautentificare din `initData` Telegram, înregistrată de modulul de
 * autentificare. Întoarce perechea de tokenuri sau `null` dacă nu se poate.
 *
 * ATENȚIE, limită reală: backendul are protecție anti-replay — același
 * `initData` nu poate fi folosit de două ori. Cum Telegram dă un singur șir per
 * deschidere, reautentificarea reușește practic DOAR la prima folosire. E o
 * plasă de siguranță, nu un mecanism pe care să te bazezi: în sesiune,
 * reînnoirea normală merge prin refresh token-ul din memorie. Când și acesta
 * cade, utilizatorul ajunge la ecranul „sesiune expirată", care îi spune exact
 * ce să facă — să redeschidă Mini App-ul din chat.
 */
type ReauthHandler = () => Promise<{ access_token: string; refresh_token: string } | null>;
let reauthHandler: ReauthHandler | null = null;

export function setReauthHandler(fn: ReauthHandler | null): void {
  reauthHandler = fn;
}

async function onUnauthorized(): Promise<void> {
  if (unauthorizedHandler) {
    await unauthorizedHandler();
    return;
  }
  tokenStore.clear();
}

// Reînnoire în curs. O singură promisiune pentru toate cererile care au luat 401
// în același timp: altfel zece cereri paralele ar trimite zece refresh-uri, iar
// backendul (care rotește refresh token-ul) le-ar invalida pe rând.
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = tokenStore.getRefresh();

  if (refresh) {
    try {
      const { data } = await axios.post(`${config.apiUrl}/auth/refresh`, {
        refresh_token: refresh,
      });
      tokenStore.setTokens(data.access_token, data.refresh_token);
      return data.access_token as string;
    } catch {
      // Refresh-ul e mort; mai avem o carte: `initData` de la Telegram.
    }
  }

  if (reauthHandler) {
    try {
      const pair = await reauthHandler();
      if (pair) {
        tokenStore.setTokens(pair.access_token, pair.refresh_token);
        return pair.access_token;
      }
    } catch {
      /* tratat mai jos ca sesiune pierdută */
    }
  }

  await onUnauthorized();
  return null;
}

/** Rulează o singură reînnoire, oricâte cereri ar cere-o simultan. */
function refreshOnce(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    // Rutele de autentificare nu se reîncearcă: un 401 acolo ÎNSEAMNĂ credențiale
    // respinse, iar o reîncercare ar fi o buclă garantată.
    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      const newToken = await refreshOnce();
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export { tokenStore };
