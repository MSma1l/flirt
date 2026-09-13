/**
 * Config runtime. NIMIC hardcodat în ecrane — adresa API vine din mediu.
 *
 * Port al regulii din `mobile/src/config.ts`: lipsa variabilei sau o adresă
 * necriptată la build de PRODUCȚIE opresc pornirea cu o eroare clară, în loc să
 * lase aplicația să pornească și să eșueze pe fiecare ecran. Într-un Mini App
 * motivul e și mai dur decât pe mobil: Telegram servește pagina doar peste
 * HTTPS, iar o cerere HTTP din interiorul ei e blocată de browser ca
 * „mixed content" — adică fiecare ecran ar arăta „fără rețea".
 */

/** Forma minimă de mediu de care avem nevoie. Separată, ca să fie testabilă. */
export interface RuntimeEnv {
  VITE_API_URL?: string | undefined;
  /** Suprascrieri pentru paginile legale (vezi `resolveLegalUrls`). */
  VITE_TERMS_URL?: string | undefined;
  VITE_PRIVACY_URL?: string | undefined;
  VITE_SUPPORT_URL?: string | undefined;
  DEV?: boolean;
}

/** Adresa folosită în dezvoltare când `VITE_API_URL` lipsește. */
export const DEV_FALLBACK_API_URL = 'http://localhost:8000/api/v1';

/**
 * Rezolvă și validează adresa API.
 * Exportată separat de `config` ca testele să o poată chema cu medii fabricate,
 * fără să reîncarce modulul.
 */
export function resolveApiUrl(env: RuntimeEnv): string {
  const fromEnv = env.VITE_API_URL?.trim();
  const isDev = env.DEV === true;

  if (!fromEnv) {
    if (isDev) return DEV_FALLBACK_API_URL;
    throw new Error(
      'VITE_API_URL lipsește din build-ul de producție. ' +
        'Setează-l înainte de `npm run build`, altfel Mini App-ul pornește fără backend.',
    );
  }

  if (!isDev && !fromEnv.startsWith('https://')) {
    throw new Error(
      `VITE_API_URL trebuie să fie HTTPS în producție (primit: ${fromEnv}). ` +
        'Telegram servește Mini App-ul peste HTTPS, iar cererile HTTP sunt blocate ca mixed content.',
    );
  }

  return fromEnv;
}

export const config = {
  apiUrl: resolveApiUrl(import.meta.env),
};

/* ————————————————————————————————————————————————————————————————————————
 * PAGINILE LEGALE — termeni, confidențialitate, suport.
 *
 * Există deja, servite de backend din `backend/app/api/legal.py`: un router cu
 * prefixul `/legal`, montat la RĂDĂCINĂ (nu sub `api_v1_prefix`), fără nicio
 * dependență de autentificare. Aceleași pagini pe care le folosește și
 * aplicația nativă (`mobile/src/config.ts` → `config.legal`).
 *
 * DE CE LE DERIVĂM din adresa API, în loc să le scriem de mână: adresa API e
 * deja obligatorie și validată, iar paginile stau pe ACELAȘI host (build-ul
 * compune `VITE_API_URL="https://$DOMAIN$API_V1_PREFIX"` — vezi
 * `backend/scripts/build_miniapp.sh`). O a doua constantă hardcodată ar putea
 * rămâne în urmă la o schimbare de domeniu și ar trimite utilizatorul — și
 * recenzentul din magazin — la o pagină moartă.
 *
 * Suprascrierile din mediu rămân posibile pentru ziua în care documentele vor
 * fi găzduite pe site-ul public, nu pe API.
 * ———————————————————————————————————————————————————————————————————————— */

/** Adresele documentelor legale. `null` = nu avem o adresă în care să credem. */
export interface LegalUrls {
  termsUrl: string | null;
  privacyUrl: string | null;
  supportUrl: string | null;
}

/** Rutele exacte din `backend/app/api/legal.py`. */
const LEGAL_PATHS = {
  termsUrl: '/legal/terms',
  privacyUrl: '/legal/privacy',
  supportUrl: '/legal/support',
} as const;

/**
 * O suprascriere acceptată doar dacă e o adresă web absolută.
 * `javascript:` și prietenii nu au ce căuta într-un `href` construit din mediu.
 */
function webUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Adresele paginilor legale pentru o adresă API dată.
 * Pură și exportată separat de `config`, ca testele să o poată chema cu medii
 * fabricate. Când originea nu se poate deduce (adresă relativă), întoarce
 * `null`-uri, iar interfața ascunde legăturile — aceeași regulă ca la butonul
 * botului: mai bine niciun link decât unul rupt.
 */
export function resolveLegalUrls(apiUrl: string, env: RuntimeEnv = {}): LegalUrls {
  let origin: string | null = null;
  try {
    origin = new URL(apiUrl).origin;
  } catch {
    origin = null;
  }

  const pick = (override: string | undefined, path: string): string | null =>
    webUrl(override) ?? (origin ? `${origin}${path}` : null);

  return {
    termsUrl: pick(env.VITE_TERMS_URL, LEGAL_PATHS.termsUrl),
    privacyUrl: pick(env.VITE_PRIVACY_URL, LEGAL_PATHS.privacyUrl),
    supportUrl: pick(env.VITE_SUPPORT_URL, LEGAL_PATHS.supportUrl),
  };
}

/**
 * Adresele legale ale build-ului curent.
 * Funcție, nu constantă — exact ca `getBotUsername()`: testele înlocuiesc
 * `import.meta.env` cu `vi.stubEnv`, iar o valoare citită la încărcarea
 * modulului ar rămâne blocată pe prima.
 */
export function getLegalUrls(): LegalUrls {
  return resolveLegalUrls(config.apiUrl, import.meta.env);
}

/* ————————————————————————————————————————————————————————————————————————
 * Numele botului — singura cale prin care un utilizator ajuns pe pagină în
 * afara Telegram se poate întoarce unde trebuie.
 *
 * Vine din `VITE_TELEGRAM_BOT_USERNAME`, injectat la build de
 * `backend/scripts/build_miniapp.sh` (care îl ia din `TELEGRAM_BOT_USERNAME`).
 * NU e hardcodat nicăieri: un nume greșit în bundle ar duce utilizatorul la un
 * chat inexistent, iar el n-ar avea cum să-și dea seama de ce.
 *
 * REGULA: dacă variabila lipsește sau nu e un nume valid de bot, întoarcem
 * `null` și interfața ASCUNDE butonul. Mai bine fără buton decât cu unul care
 * duce la „user not found".
 * ———————————————————————————————————————————————————————————————————————— */

/** Telegram: 5–32 de caractere, litere/cifre/underscore, terminat în „bot". */
const BOT_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * Curăță și validează numele botului.
 * Acceptă și forma cu `@` sau adresa completă `https://t.me/nume`, fiindcă
 * variabila de mediu e completată de om și oricare dintre ele e plauzibilă.
 */
export function resolveBotUsername(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\/(t|telegram)\.me\//i, '')
    .replace(/^@/, '')
    .replace(/\/+$/, '');
  return BOT_USERNAME_RE.test(trimmed) ? trimmed : null;
}

/** Adresa chatului botului, sau `null` dacă numele nu e configurat. */
export function botChatUrl(username: string | null): string | null {
  return username ? `https://t.me/${username}` : null;
}

/**
 * Numele botului din mediul de build.
 * Funcție, nu constantă: testele pot înlocui `import.meta.env` (`vi.stubEnv`),
 * iar o valoare citită la încărcarea modulului ar rămâne blocată pe prima.
 */
export function getBotUsername(): string | null {
  return resolveBotUsername(import.meta.env.VITE_TELEGRAM_BOT_USERNAME);
}

/** Adresa chatului botului pentru build-ul curent, sau `null`. */
export function getBotChatUrl(): string | null {
  return botChatUrl(getBotUsername());
}
