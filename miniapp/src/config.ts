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
