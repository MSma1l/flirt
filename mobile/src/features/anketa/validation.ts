/** Funcții pure de validare pentru wizardul de anketă. Mesaje în română.
 * Reutilizează modulul central `@/utils/validation` (simetric cu backend-ul:
 * name/city ≤120, about ≤500, fără marcaje HTML, înălțime 100–250, vârstă ≥16).
 */
import {
  age16plus,
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

/** Calculează vârsta în ani împliniți la data `now`, pe baza datei de naștere. */
export const computeAge = computeAgeUtil;

/** Numele trebuie să fie ne-gol, ≤120 caractere, fără marcaje HTML. */
export function validateName(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu numele tău.';
  return noHtml(value) ?? maxLen(value, MAX_NAME_LENGTH);
}

/** Data nașterii trebuie să fie validă, în trecut, iar vârsta ≥ 16 ani. */
export function validateBirthDate(value?: string): string | null {
  return age16plus(value);
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
  }
  return errors;
}

/** True dacă obiectul de erori nu conține nicio eroare. */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
