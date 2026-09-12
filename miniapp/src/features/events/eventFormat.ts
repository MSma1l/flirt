/**
 * Formatări comune modulului de evenimente (listă, detaliu, passport, bilete).
 *
 * PORT al helperelor pure din `mobile/src/features/events/EventCard.tsx`. Acolo
 * ele stau lipite de o componentă React Native (import `react-native`), deci NU
 * pot fi reutilizate prin `@mobile/` — le rescriem aici, dar cu ACELEAȘI reguli,
 * ca data unui eveniment să arate identic în ambele aplicații.
 *
 * Etichetele tipurilor de eveniment sunt în română, exact ca pe mobil: în
 * cataloagele i18n (`mobile/src/i18n/locales/<lang>/events.json`) NU există chei
 * pentru ele, iar sarcina interzice atât modificarea cataloagelor mobile, cât și
 * pe a celui local. Cheile lipsă sunt raportate separat.
 */
import i18n from '@/i18n';

/** Eticheta afișată pentru un tip de eveniment. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'flirt_party':
      return 'Flirt Party';
    case 'concert':
      return 'Concert';
    default:
      return 'Eveniment';
  }
}

/**
 * Variabila CSS de culoare pentru coperta/badge-ul unui tip de eveniment.
 * Întoarce un `var(--…)`, nu o culoare fixă: paleta e scrisă de `applyTheme`
 * din tema clientului Telegram și se schimbă sub picioarele noastre.
 */
export function kindColorVar(kind: string): string {
  switch (kind) {
    case 'flirt_party':
      return 'var(--color-accent)';
    case 'concert':
      return 'var(--color-link)';
    default:
      return 'var(--color-surface-hover)';
  }
}

/**
 * Data unui eveniment, scrisă în limba INTERFEȚEI (nu fix `ro-RO`).
 *
 * Regula vine de pe mobil: un utilizator care ține aplicația în rusă vedea luna
 * scrisă românește, și pe cardul de eveniment, și pe ștampilele din passport.
 * Funcția nu e componentă, deci citește limba din instanța globală `i18n`.
 *
 * O dată nevalidă se întoarce ca atare: mai bine un șir ciudat de la server
 * decât „Invalid Date" pe ecran.
 */
export function formatEventDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

/** Doar ziua (fără oră) — folosită de ștampilele Flirt Passport. */
export function formatStampDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return date.toISOString();
  }
}
