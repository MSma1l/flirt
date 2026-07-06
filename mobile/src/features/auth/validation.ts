/** Funcții pure de validare pentru formularele de autentificare. Mesaje în română. */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returnează un mesaj de eroare sau `null` dacă emailul este valid. */
export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return 'Introdu adresa de email.';
  if (!EMAIL_REGEX.test(email)) return 'Adresa de email nu este validă.';
  return null;
}

/** Returnează un mesaj de eroare sau `null` dacă parola respectă cerințele (min 8). */
export function validatePassword(value: string): string | null {
  if (!value) return 'Introdu o parolă.';
  if (value.length < 8) return 'Parola trebuie să aibă cel puțin 8 caractere.';
  return null;
}

/** Returnează un mesaj de eroare sau `null` dacă cele două parole coincid. */
export function validatePasswordMatch(a: string, b: string): string | null {
  if (!b) return 'Confirmă parola.';
  if (a !== b) return 'Parolele nu coincid.';
  return null;
}
