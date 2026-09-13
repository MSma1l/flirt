/**
 * Formatări comune modulului de evenimente (listă, detaliu, passport, bilete).
 *
 * PORT al helperelor pure din `mobile/src/features/events/EventCard.tsx`. Acolo
 * ele stau lipite de o componentă React Native (import `react-native`), deci NU
 * pot fi reutilizate prin `@mobile/` — le rescriem aici, dar cu ACELEAȘI reguli,
 * ca data unui eveniment să arate identic în ambele aplicații.
 *
 * Etichetele tipurilor de eveniment NU există în cataloagele mobile
 * (`mobile/src/i18n/locales/<lang>/events.json`), deci stau în catalogul propriu
 * al Mini App-ului, sub `screens:events.kind.*`. Funcțiile nu sunt componente,
 * deci citesc din instanța globală `i18n`, exact ca `formatEventDate` de mai jos.
 */
import i18n from '@/i18n';

/** Eticheta afișată pentru un tip de eveniment, în limba interfeței. */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'flirt_party':
      // Numele produsului nu se traduce; cheia există totuși în toate limbile,
      // ca textul să treacă prin aceeași cale ca restul etichetelor.
      return i18n.t('screens:events.kind.flirt_party');
    case 'concert':
      return i18n.t('screens:events.kind.concert');
    default:
      return i18n.t('screens:events.kind.other');
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
