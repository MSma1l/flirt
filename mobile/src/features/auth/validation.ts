/** Funcții pure de validare pentru formularele de autentificare. Mesaje în română.
 * Reutilizează modulul central `@/utils/validation` (simetric cu backend-ul);
 * API-ul rămâne cel folosit de ecranele de login / register.
 */
import { isEmail, noHtml } from '@/utils/validation';

/** Returnează un mesaj de eroare sau `null` dacă emailul este valid (non-gol, format, fără marcaje). */
export function validateEmail(value: string): string | null {
  return isEmail(value);
}

/** Returnează un mesaj de eroare sau `null` dacă parola respectă cerințele (non-gol, min 8, fără marcaje). */
export function validatePassword(value: string): string | null {
  if (!value) return 'Introdu o parolă.';
  if (value.length < 8) return 'Parola trebuie să aibă cel puțin 8 caractere.';
  return noHtml(value);
}

/** Returnează un mesaj de eroare sau `null` dacă cele două parole coincid. */
export function validatePasswordMatch(a: string, b: string): string | null {
  if (!b) return 'Confirmă parola.';
  if (a !== b) return 'Parolele nu coincid.';
  return null;
}
