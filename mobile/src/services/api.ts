/** Client HTTP cu JWT Bearer + refresh automat la 401. */
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

import { config } from '@/config';
import { tokenStore } from '@/services/tokenStore';

/**
 * NU seta `Content-Type` implicit aici.
 *
 * Axios 1.x, la `transformRequest`: dacă instanța are deja un content-type JSON,
 * un `FormData` NU mai e trimis ca multipart — e serializat cu
 * `JSON.stringify(formDataToJSON(data))`. Adică uploadul de poze de pe WEB
 * pleca fără fișier, serverul răspundea 500, iar 500-ul (excepție neprinsă) vine
 * fără antetele CORS → browserul blochează răspunsul → axios nu vede niciun
 * răspuns → utilizatorul citea „Conexiune întreruptă", deși internetul era bun.
 *
 * Fără default, axios pune singur `application/json` pentru obiecte simple și
 * lasă browserul să compună `multipart/form-data; boundary=...` pentru FormData.
 */
export const api = axios.create({
  baseURL: config.apiUrl,
  // Uploadul de poze merge prin aceeași instanță: 15s erau prea puțini pentru o
  // poză de câțiva MB pe un uplink lent.
  timeout: 60000,
});

api.interceptors.request.use((cfg) => {
  const token = tokenStore.getAccess();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/**
 * Sesiune expirată: cine reacționează când refresh-ul eșuează definitiv.
 *
 * `authStore` importă `api`, deci un import invers de aici ar închide un ciclu.
 * În schimb, store-ul își înregistrează handlerul la încărcare (vezi authStore),
 * iar noi îl chemăm fără să știm nimic despre el.
 */
type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  unauthorizedHandler = fn;
}

async function onUnauthorized(): Promise<void> {
  if (unauthorizedHandler) {
    // Handlerul (forceLogout) curăță tokenurile ȘI scoate userul din aplicație.
    await unauthorizedHandler();
    return;
  }
  // Nimeni înregistrat: măcar nu păstrăm tokenuri moarte.
  await tokenStore.clear();
}

// Refresh automat: la primul 401, încearcă /auth/refresh o singură dată.
let refreshing: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const refresh = await tokenStore.getRefresh();
  if (!refresh) {
    // 401 fără refresh token = sesiune pierdută la fel de sigur ca un refresh eșuat.
    await onUnauthorized();
    return null;
  }
  try {
    const { data } = await axios.post(`${config.apiUrl}/auth/refresh`, {
      refresh_token: refresh,
    });
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    return data.access_token as string;
  } catch {
    await onUnauthorized();
    return null;
  }
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isAuthCall = original?.url?.includes('/auth/');
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      refreshing = refreshing ?? doRefresh();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);
