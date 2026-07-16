/** Funcții pure de validare pentru wizardul de anketă. Mesaje în română.
 * Reutilizează modulul central `@/utils/validation` (simetric cu backend-ul:
 * name/city ≤120, about ≤500, fără marcaje HTML, înălțime 100–250, vârstă ≥18 —
 * aplicația este 18+ ONLY).
 */
import {
  isAdultAge,
  computeAge as computeAgeUtil,
  heightCm as heightCmUtil,
  LIMITS,
  MAX_HEIGHT_CM as MAX_HEIGHT_CM_UTIL,
  maxLen,
  MIN_AGE as MIN_AGE_UTIL,
  MIN_HEIGHT_CM as MIN_HEIGHT_CM_UTIL,
  noHtml,
} from '@/utils/validation';

import { AnketaDraft } from './types';

// Re-export din modulul central pentru compatibilitate cu ecranele existente.
export const MIN_AGE = MIN_AGE_UTIL;
export const MIN_HEIGHT_CM = MIN_HEIGHT_CM_UTIL;
export const MAX_HEIGHT_CM = MAX_HEIGHT_CM_UTIL;
export const MAX_ABOUT_LENGTH = LIMITS.about;
export const MAX_NAME_LENGTH = LIMITS.name;
export const MAX_CITY_LENGTH = LIMITS.city;

/**
 * Limitele intervalului de vârstă căutat, simetrice cu backend-ul
 * (`account_service._validate_preferences`):
 *  - minimul absolut = pragul de adult (18) — aplicația este 18+ ONLY;
 *  - maximul acceptat de backend = `search_age_max_limit`.
 * Le validăm în UI ca utilizatorul să vadă un mesaj clar, nu un 422 de la server.
 */
export const SEARCH_AGE_MIN = MIN_AGE_UTIL;
export const SEARCH_AGE_MAX_LIMIT = 120;

/** Intervalul propus implicit — aceleași valori ca default-urile backend-ului. */
export const DEFAULT_SEARCH_AGE_MIN = SEARCH_AGE_MIN;
export const DEFAULT_SEARCH_AGE_MAX = 99;

/** Calculează vârsta în ani împliniți la data `now`, pe baza datei de naștere. */
export const computeAge = computeAgeUtil;

/** Numele trebuie să fie ne-gol, ≤120 caractere, fără marcaje HTML. */
export function validateName(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu numele tău.';
  return noHtml(value) ?? maxLen(value, MAX_NAME_LENGTH);
}

/** Data nașterii trebuie să fie validă, în trecut, iar vârsta ≥ `MIN_AGE` (18+). */
export function validateBirthDate(value?: string): string | null {
  return isAdultAge(value);
}

/** Genul trebuie ales. */
export function validateGender(value?: string): string | null {
  if (!value) return 'Alege genul.';
  return null;
}

/** Înălțimea (cm) trebuie să fie un număr rezonabil (100–250). */
export function validateHeight(value?: number): string | null {
  return heightCmUtil(value);
}

/** Orașul trebuie să fie ne-gol, ≤120 caractere, fără marcaje HTML. */
export function validateCity(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu orașul.';
  return noHtml(value) ?? maxLen(value, MAX_CITY_LENGTH);
}

/** Cel puțin o limbă de comunicare. */
export function validateLanguages(value?: string[]): string | null {
  if (!value || value.length === 0) return 'Alege cel puțin o limbă.';
  return null;
}

/** Câmpul „despre" este opțional, dar ≤500 caractere și fără marcaje HTML. */
export function validateAbout(value?: string): string | null {
  if (value && value.length > MAX_ABOUT_LENGTH) {
    return `Textul depășește ${MAX_ABOUT_LENGTH} de caractere.`;
  }
  return noHtml(value);
}

/** Cel puțin un interes. */
export function validateInterests(value?: string[]): string | null {
  if (!value || value.length === 0) return 'Alege cel puțin un interes.';
  return null;
}

/** Cel puțin un gen căutat — altfel feed-ul i-ar arăta pe toți. */
export function validateInterestedIn(value?: string[]): string | null {
  if (!value || value.length === 0) return 'Alege cel puțin un gen.';
  return null;
}

/** Vârsta minimă căutată: obligatorie, ≥ 18 (18+ ONLY), ≤ plafonul backend-ului. */
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

/**
 * Vârsta maximă căutată: obligatorie, în aceleași limite ca minima și niciodată
 * sub ea (`age_min <= age_max`, altfel backend-ul respinge intervalul inversat).
 */
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

/** Un mapping câmp → mesaj de eroare (câmpurile fără eroare lipsesc). */
export type FieldErrors = Partial<Record<keyof AnketaDraft, string>>;

/** Validează câmpurile unui pas anume; întoarce erorile găsite. */
export function validateStep(step: number, draft: Partial<AnketaDraft>): FieldErrors {
  const errors: FieldErrors = {};
  const add = (key: keyof AnketaDraft, err: string | null) => {
    if (err) errors[key] = err;
  };

  switch (step) {
    case 0:
      add('name', validateName(draft.name));
      add('birthDate', validateBirthDate(draft.birthDate));
      add('gender', validateGender(draft.gender));
      add('heightCm', validateHeight(draft.heightCm));
      break;
    case 1:
      add('city', validateCity(draft.city));
      add('languages', validateLanguages(draft.languages));
      break;
    case 2:
      add('about', validateAbout(draft.about));
      break;
    case 3:
      add('interests', validateInterests(draft.interests));
      break;
    case 4:
      // „Pe cine cauți" — preferințele de căutare (gen + interval de vârstă).
      add('interestedIn', validateInterestedIn(draft.interestedIn));
      add('ageMin', validateSearchAgeMin(draft.ageMin));
      add('ageMax', validateSearchAgeMax(draft.ageMax, draft.ageMin));
      break;
  }
  return errors;
}

/** True dacă obiectul de erori nu conține nicio eroare. */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
