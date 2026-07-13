/**
 * Depozitul de token-uri al panoului de admin.
 *
 * DECIZIE DE SECURITATE (și de ce):
 *
 *  1. ACCESS TOKEN → DOAR ÎN MEMORIE (variabilă de modul). Nu ajunge NICIODATĂ
 *     în `localStorage`/`sessionStorage`: un XSS ar putea citi storage-ul
 *     instantaneu și ar pleca cu un token de ADMIN (ban, ștergere GDPR).
 *     În memorie, token-ul moare odată cu contextul JS al paginii.
 *
 *  2. REFRESH TOKEN → `sessionStorage`, nu `localStorage`, și NU cookie.
 *     Varianta ideală (refresh în cookie `httpOnly`+`Secure`+`SameSite=Strict`)
 *     NU e posibilă azi: `POST /api/v1/auth/login` întoarce perechea în CORPUL
 *     JSON (`TokenPair`), iar `POST /api/v1/auth/refresh` cere refresh-ul în
 *     corpul cererii — backend-ul nu setează și nu citește niciun cookie.
 *     Fără persistență, orice reîncărcare de pagină ar deloga adminul în mijlocul
 *     cozii de moderare (Apple cere răspuns în ≤24h — nu ne permitem fricțiune).
 *     `sessionStorage` este compromisul: se șterge la închiderea tab-ului, nu e
 *     partajat între tab-uri și nu supraviețuiește repornirii browserului.
 *     Rămâne citibil de un XSS — de aceea nu folosim NICĂIERI
 *     `dangerouslySetInnerHTML`, iar rotația refresh-ului cu reuse-detection
 *     există deja pe backend (`auth_service.rotate_refresh`).
 *
 *  DE FĂCUT PE BACKEND (raportat separat): suport pentru refresh în cookie
 *  `httpOnly` → atunci ștergem complet punctul 2 și nu mai atingem storage-ul.
 */

const REFRESH_KEY = 'flirt_admin_refresh';

/** Access token — exclusiv în memorie. */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage blocat (mod privat / politici stricte) — mergem mai departe fără persistență.
    return null;
  }
}

export function getRefreshToken(): string | null {
  try {
    return storage()?.getItem(REFRESH_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  const store = storage();
  if (!store) return;
  try {
    if (token === null) store.removeItem(REFRESH_KEY);
    else store.setItem(REFRESH_KEY, token);
  } catch {
    // Ignorăm: lipsa persistenței degradează UX-ul, nu securitatea.
  }
}

/** Șterge ambele token-uri (logout, 401 nerecuperabil, 403 fără rol de admin). */
export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}
