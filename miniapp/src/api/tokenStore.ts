/**
 * Stocarea sesiunii — DOAR în memorie, ambele tokenuri.
 *
 * Pe mobil, access-ul stă în memorie și refresh-ul e persistat (SecureStore).
 * Aici NU persistăm nimic, deliberat:
 *
 *  1. WebView-ul Telegram își poate reseta stocarea între deschideri (curățare
 *     de cache, sesiuni separate per platformă, mod incognito pe Telegram Web),
 *     deci un refresh token din `localStorage` e un mecanism pe care nu te poți
 *     baza: jumătate din porniri ar cădea oricum pe reautentificare.
 *  2. Spre deosebire de mobil, avem MEREU o dovadă de identitate proaspătă la
 *     pornire: `initData` semnat de Telegram. Reautentificarea e o singură
 *     cerere și nu cere nimic de la utilizator.
 *  3. `localStorage` e citibil de orice script din pagină; un token de lungă
 *     durată acolo e un risc gratuit când alternativa costă o cerere.
 *
 * Consecință: la fiecare pornire se cheamă `POST /auth/telegram`. Refresh-ul din
 * memorie rămâne util în sesiune, pentru un 401 apărut între timp.
 */

let accessToken: string | null = null;
let refreshToken: string | null = null;

export const tokenStore = {
  getAccess: (): string | null => accessToken,
  getRefresh: (): string | null => refreshToken,
  setAccess: (t: string | null): void => {
    accessToken = t;
  },
  setTokens: (access: string, refresh: string): void => {
    accessToken = access;
    refreshToken = refresh;
  },
  clear: (): void => {
    accessToken = null;
    refreshToken = null;
  },
};
