/**
 * Validarea formularului de profil, simetrică cu backend-ul.
 *
 * Regulile vin din primitivele pure din `mobile/src/utils/validation.ts`, prin
 * `features/onboarding/validation.ts`: nume/oraș ≤120 fără marcaje HTML,
 * „despre" ≤500, înălțime 100–250, vârstă ≥18. MESAJELE nu se iau de pe mobil
 * (acolo sunt texte românești fixe), ci din `miniapp:onboarding.errors.*`, în
 * limba curentă — în ro/ru/en.
 *
 * NU se poate importa `mobile/src/features/anketa/validation.ts` (care ar fi dat
 * și `validateStep`): el importă `@/utils/validation`, iar în Mini App `@/` e
 * `miniapp/src/`, unde modulul nu există. Compunem deci aceleași reguli din
 * aceleași primitive — logica rămâne o singură sursă de adevăr.
 */
import { hasHtml, LIMITS, MIN_AGE } from '@mobile/utils/validation';

import * as rules from '@/features/onboarding/validation';
import type { FieldError } from '@/features/onboarding/validation';
import { i18n } from '@/i18n';

import type { AnketaDraft } from './profileApi';

export { LIMITS, MIN_AGE };

/** Lungimea maximă a câmpului „despre" (backend: `settings.about_max_length`). */
export const MAX_ABOUT_LENGTH = LIMITS.about;

/** Un mapping câmp → mesaj de eroare; câmpurile valide lipsesc din obiect. */
export type FieldErrors = Partial<Record<keyof AnketaDraft, string>>;

/**
 * Regulile sunt cele din `features/onboarding/validation.ts` (aceleași câmpuri,
 * aceleași limite); aici doar traducem cheia în limba curentă, din namespace-ul
 * `miniapp`, ca ecranul de profil să afișeze direct textul.
 */
function tr(error: FieldError | null): string | null {
  return error ? i18n.t(`miniapp:${error.key}`, error.params ?? {}) : null;
}

export function validateName(value?: string): string | null {
  return tr(rules.validateName(value));
}

export function validateBirthDate(value?: string): string | null {
  return tr(rules.validateBirthDate(value));
}

export function validateGender(value?: string): string | null {
  return tr(rules.validateGender(value));
}

export function validateHeight(value?: number): string | null {
  return tr(rules.validateHeight(value));
}

export function validateCity(value?: string): string | null {
  return tr(rules.validateCity(value));
}

export function validateLanguages(value?: string[]): string | null {
  return tr(rules.validateLanguages(value));
}

export function validateAbout(value?: string): string | null {
  if (value && value.length > MAX_ABOUT_LENGTH) {
    return tr({ key: 'onboarding.errors.tooLong', params: { max: MAX_ABOUT_LENGTH } });
  }
  return tr(rules.validateAbout(value));
}

export function validateInterests(value?: string[]): string | null {
  return tr(rules.validateInterests(value));
}

/** Plafonul străzii pe server (coloană de 200 de caractere). */
const MAX_STREET_LENGTH = 200;

/** Câmpuri opționale, dar care ajung tot în coloane plafonate pe server. */
export function validateStreet(value?: string): string | null {
  if (!value) return null;
  if (hasHtml(value)) return tr({ key: 'onboarding.errors.noHtml' });
  if (value.length > MAX_STREET_LENGTH) {
    return tr({ key: 'onboarding.errors.tooLong', params: { max: MAX_STREET_LENGTH } });
  }
  return null;
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
