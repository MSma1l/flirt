/**
 * Validarea formularului de profil, simetrică cu backend-ul.
 *
 * REUTILIZEAZĂ integral primitivele pure din `mobile/src/utils/validation.ts`
 * (fișier fără niciun import — nici React Native, nici config), deci regulile și
 * mesajele rămân identice cu aplicația nativă: nume/oraș ≤120 fără marcaje HTML,
 * „despre" ≤500, înălțime 100–250, vârstă ≥18.
 *
 * NU se poate importa `mobile/src/features/anketa/validation.ts` (care ar fi dat
 * și `validateStep`): el importă `@/utils/validation`, iar în Mini App `@/` e
 * `miniapp/src/`, unde modulul nu există. Compunem deci aceleași reguli din
 * aceleași primitive — logica rămâne o singură sursă de adevăr.
 */
import {
  heightCm,
  isAdultAge,
  LIMITS,
  maxLen,
  MIN_AGE,
  noHtml,
} from '@mobile/utils/validation';

import type { AnketaDraft } from './profileApi';

export { LIMITS, MIN_AGE };

/** Lungimea maximă a câmpului „despre" (backend: `settings.about_max_length`). */
export const MAX_ABOUT_LENGTH = LIMITS.about;

/** Un mapping câmp → mesaj de eroare; câmpurile valide lipsesc din obiect. */
export type FieldErrors = Partial<Record<keyof AnketaDraft, string>>;

export function validateName(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu numele tău.';
  return noHtml(value) ?? maxLen(value, LIMITS.name);
}

export function validateBirthDate(value?: string): string | null {
  return isAdultAge(value);
}

export function validateGender(value?: string): string | null {
  return value ? null : 'Alege genul.';
}

export function validateHeight(value?: number): string | null {
  return heightCm(value);
}

export function validateCity(value?: string): string | null {
  if (!value || !value.trim()) return 'Introdu orașul.';
  return noHtml(value) ?? maxLen(value, LIMITS.city);
}

export function validateLanguages(value?: string[]): string | null {
  return value && value.length > 0 ? null : 'Alege cel puțin o limbă.';
}

export function validateAbout(value?: string): string | null {
  if (value && value.length > MAX_ABOUT_LENGTH) {
    return `Textul depășește ${MAX_ABOUT_LENGTH} de caractere.`;
  }
  return noHtml(value);
}

export function validateInterests(value?: string[]): string | null {
  return value && value.length > 0 ? null : 'Alege cel puțin un interes.';
}

/** Câmpuri opționale, dar care ajung tot în coloane plafonate pe server. */
export function validateStreet(value?: string): string | null {
  return noHtml(value) ?? maxLen(value, 200);
}

/**
 * Validează formularul întreg. Ecranul de profil salvează dintr-o singură
 * apăsare (nu are pași ca wizardul de pe mobil), deci verificăm tot deodată.
 */
export function validateProfile(draft: Partial<AnketaDraft>): FieldErrors {
  const errors: FieldErrors = {};
  const add = (key: keyof AnketaDraft, err: string | null) => {
    if (err) errors[key] = err;
  };

  add('name', validateName(draft.name));
  add('birthDate', validateBirthDate(draft.birthDate));
  add('gender', validateGender(draft.gender));
  add('heightCm', validateHeight(draft.heightCm));
  add('city', validateCity(draft.city));
  add('street', validateStreet(draft.street));
  add('languages', validateLanguages(draft.languages));
  add('about', validateAbout(draft.about));
  add('interests', validateInterests(draft.interests));

  return errors;
}

/** True dacă nu există nicio eroare. */
export function isValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
