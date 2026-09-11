/**
 * Validarea preferințelor de căutare, simetrică cu backend-ul
 * (`account_service._validate_preferences`): pragul de adult, interval coerent,
 * plafoanele din config. O validăm în UI ca utilizatorul să vadă un mesaj clar,
 * nu un 422 sec de la server.
 *
 * REUTILIZEAZĂ `searchRadiusKm` și `MIN_AGE` din `mobile/src/utils/validation.ts`
 * (fișier pur, fără niciun import). `mobile/src/features/anketa/validation.ts`,
 * unde stau validatoarele de vârstă, NU se poate importa: el trage
 * `@/utils/validation`, iar în Mini App `@/` e `miniapp/src/`, unde modulul nu
 * există — aceeași limită explicată în `features/profile/validation.ts`.
 */
import { MIN_AGE, searchRadiusKm } from '@mobile/utils/validation';

export { MIN_AGE, searchRadiusKm };

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
  return value && value.length > 0 ? null : 'Alege cel puțin un gen.';
}

export function validateSearchAgeMin(value?: number): string | null {
  if (value == null || Number.isNaN(value)) return 'Introdu vârsta minimă.';
  if (value < SEARCH_AGE_MIN) {
    return `Vârsta minimă nu poate fi sub ${SEARCH_AGE_MIN} ani (aplicația este 18+).`;
  }
  if (value > SEARCH_AGE_MAX_LIMIT) {
    return `Vârsta minimă nu poate depăși ${SEARCH_AGE_MAX_LIMIT} de ani.`;
  }
  return null;
}

export function validateSearchAgeMax(value?: number, min?: number): string | null {
  if (value == null || Number.isNaN(value)) return 'Introdu vârsta maximă.';
  if (value < SEARCH_AGE_MIN) {
    return `Vârsta maximă nu poate fi sub ${SEARCH_AGE_MIN} ani (aplicația este 18+).`;
  }
  if (value > SEARCH_AGE_MAX_LIMIT) {
    return `Vârsta maximă nu poate depăși ${SEARCH_AGE_MAX_LIMIT} de ani.`;
  }
  if (min != null && !Number.isNaN(min) && value < min) {
    return 'Vârsta maximă nu poate fi mai mică decât cea minimă.';
  }
  return null;
}
