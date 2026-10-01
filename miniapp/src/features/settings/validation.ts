/**
 * Validarea preferințelor de căutare, simetrică cu backend-ul
 * (`account_service._validate_preferences`): pragul de adult, interval coerent,
 * plafoanele din config. O validăm în UI ca utilizatorul să vadă un mesaj clar,
 * nu un 422 sec de la server.
 *
 * REUTILIZEAZĂ `MIN_AGE` și limitele razei din `mobile/src/utils/validation.ts`
 * (fișier pur, fără niciun import). `mobile/src/features/anketa/validation.ts`,
 * unde stau validatoarele de vârstă, NU se poate importa: el trage
 * `@/utils/validation`, iar în Mini App `@/` e `miniapp/src/`, unde modulul nu
 * există — aceeași limită explicată în `features/profile/validation.ts`.
 */
import {
  MAX_SEARCH_RADIUS_KM,
  MIN_AGE,
  MIN_SEARCH_RADIUS_KM,
} from '@mobile/utils/validation';

import { i18n } from '@/i18n';

export { MIN_AGE };

/** Mesajele sunt traduse în limba curentă, din namespace-ul `screens`. */
const tr = (key: string, params?: Record<string, number>) =>
  i18n.t(`screens:validation.search.${key}`, params);

/**
 * Raza de căutare (km): număr întreg între 1 și 1000. Aceeași regulă ca
 * `searchRadiusKm` din modulul mobil, dar cu mesaj tradus — cel mobil întoarce
 * text românesc fix.
 */
export function searchRadiusKm(value?: string | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return tr('radiusRequired');
  const n = Number(v);
  if (!Number.isInteger(n) || n < MIN_SEARCH_RADIUS_KM || n > MAX_SEARCH_RADIUS_KM) {
    return tr('radiusRange', { min: MIN_SEARCH_RADIUS_KM, max: MAX_SEARCH_RADIUS_KM });
  }
  return null;
}

/** Minimul absolut al intervalului căutat: aplicația este 18+ ONLY. */
export const SEARCH_AGE_MIN = MIN_AGE;

/** Plafonul acceptat de backend (`settings.search_age_max_limit`). */
export const SEARCH_AGE_MAX_LIMIT = 120;

/**
 * Citește o vârstă dintr-un câmp text: doar cifre; câmp golit = „nimic ales"
 * (`undefined`), ca validarea să ceară o valoare, nu să reclame un 0 absurd.
 */
export function parseAge(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? undefined : n;
}

/** Cel puțin un gen căutat — altfel feed-ul i-ar arăta pe toți. */
export function validateInterestedIn(value?: string[]): string | null {
  return value && value.length > 0 ? null : tr('interestedRequired');
}

export function validateSearchAgeMin(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return tr('ageMinRequired');
  if (value < SEARCH_AGE_MIN) {
    return tr('ageMinTooLow', { min: SEARCH_AGE_MIN });
  }
  if (value > SEARCH_AGE_MAX_LIMIT) {
    return tr('ageMinTooHigh', { max: SEARCH_AGE_MAX_LIMIT });
  }
  return null;
}

export function validateSearchAgeMax(value?: number, min?: number): string | null {
  if (value == null || Number.isNaN(value)) return tr('ageMaxRequired');
  if (value < SEARCH_AGE_MIN) {
    return tr('ageMaxTooLow', { min: SEARCH_AGE_MIN });
  }
  if (value > SEARCH_AGE_MAX_LIMIT) {
    return tr('ageMaxTooHigh', { max: SEARCH_AGE_MAX_LIMIT });
  }
  if (min != null && !Number.isNaN(min) && value < min) {
    return tr('ageMaxBelowMin');
  }
  return null;
}
