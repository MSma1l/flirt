/**
 * Funcții pure de validare pentru formularele de autentificare.
 *
 * Întorc CHEI de traducere (`validation.emailInvalid`), nu propoziții. Sunt
 * funcții pure, apelate în afara randării, unde `t` nu există — iar eroarea
 * păstrată în state se re-traduce singură dacă userul comută limba cu ea pe
 * ecran. Traducerea se face la afișare, în `login.tsx` / `register.tsx`.
 *
 * REGULILE (regex de email, marcaje HTML) rămân în modulul central
 * `@/utils/validation`, simetric cu backend-ul: de acolo luăm predicatele
 * `looksLikeEmail` / `hasHtml`, ca să nu ne copiem propriile regex-uri.
 * Restul aplicației folosește în continuare variantele care întorc mesaje —
 * migrarea lor pe i18n e o sarcină separată.
 */
import { hasHtml, looksLikeEmail } from '@/utils/validation';

/** Lungimea minimă a parolei, simetrică cu backend-ul (`PasswordStr`, min 8). */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Cheile de eroare, ca uniune literală: `t()` e tipizat pe cataloagele reale,
 * deci o cheie ștearsă din JSON pică la `tsc`, nu pe ecran.
 *
 * `validation.passwordTooShort` folosește interpolarea `{{min}}` — apelantul îi
 * dă `MIN_PASSWORD_LENGTH`, ca pragul să nu fie scris de mână în trei cataloage.
 */
export type AuthValidationKey =
  | 'validation.emailRequired'
  | 'validation.emailInvalid'
  | 'validation.passwordRequired'
  | 'validation.passwordTooShort'
  | 'validation.confirmRequired'
  | 'validation.passwordsMismatch'
  | 'validation.noHtml';

/** Cheia erorii sau `null` dacă emailul e valid (non-gol, format, fără marcaje). */
export function validateEmail(value: string): AuthValidationKey | null {
  const v = (value ?? '').trim();
  if (!v) return 'validation.emailRequired';
  if (!looksLikeEmail(v)) return 'validation.emailInvalid';
  if (hasHtml(v)) return 'validation.noHtml';
  return null;
}

/** Cheia erorii sau `null` dacă parola respectă cerințele (non-gol, min 8, fără marcaje). */
export function validatePassword(value: string): AuthValidationKey | null {
  if (!value) return 'validation.passwordRequired';
  if (value.length < MIN_PASSWORD_LENGTH) return 'validation.passwordTooShort';
  if (hasHtml(value)) return 'validation.noHtml';
  return null;
}

/** Cheia erorii sau `null` dacă cele două parole coincid. */
export function validatePasswordMatch(a: string, b: string): AuthValidationKey | null {
  if (!b) return 'validation.confirmRequired';
  if (a !== b) return 'validation.passwordsMismatch';
  return null;
}
