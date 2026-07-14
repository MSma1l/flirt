/**
 * Modul central de validare de input — funcții pure reutilizabile pe frontend,
 * simetrice cu validarea din backend (`app/core/validators.py`): anti-XSS stocat,
 * lungimi plafonate, non-gol, format (email / URL). Fiecare funcție întoarce un
 * mesaj de eroare în română sau `null` dacă valoarea este validă.
 */

// Tag-uri HTML / <script> — respinse în text simplu (anti-XSS), simetric backend.
const HTML_RE = /<[^>]*>/;
// Email: fără spații, un singur @, domeniu cu punct.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// URL de storage propriu: doar https, fără spații / marcaje, max 500 (simetric backend).
const HTTPS_URL_RE = /^https:\/\/[^\s<>"']{1,500}$/;

/** Limite de lungime aliniate cu backend-ul (sursă unică de adevăr pe frontend). */
export const LIMITS = {
  name: 120,
  city: 120,
  about: 500,
  message: 2000,
  note: 500,
  caption: 500,
  mediaUrl: 500,
} as const;

// APLICAȚIA E 18+ ONLY (cerință App Store / Google Play pentru dating).
// Simetric cu backend-ul: MIN_REGISTRATION_AGE / ADULT_AGE din config.
export const MIN_AGE = 18;
export const MIN_HEIGHT_CM = 100;
export const MAX_HEIGHT_CM = 250;
export const MIN_SEARCH_RADIUS_KM = 1;
export const MAX_SEARCH_RADIUS_KM = 1000;

/** Valoarea trebuie să fie ne-goală după eliminarea spațiilor. */
export function required(value?: string | null): string | null {
  if (!value || !value.trim()) return 'Acest câmp este obligatoriu.';
  return null;
}

/** Lungimea (numărul de caractere) nu poate depăși `n`. */
export function maxLen(value: string | null | undefined, n: number): string | null {
  if (value != null && value.length > n) {
    return `Textul depășește ${n} de caractere.`;
  }
  return null;
}

/** Lungimea (după trim) trebuie să fie de cel puțin `n` caractere. */
export function minLen(value: string | null | undefined, n: number): string | null {
  const v = (value ?? '').trim();
  if (v.length < n) {
    return `Textul trebuie să aibă cel puțin ${n} caractere.`;
  }
  return null;
}

/** Respinge textul care conține marcaje HTML / `<script>` (anti-XSS). */
export function noHtml(value?: string | null): string | null {
  if (value && HTML_RE.test(value)) {
    return 'Textul nu poate conține marcaje HTML.';
  }
  return null;
}

/** Adresă de email validă (ne-goală, format corect, fără marcaje). */
export function isEmail(value?: string | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return 'Introdu adresa de email.';
  if (!EMAIL_RE.test(v)) return 'Adresa de email nu este validă.';
  return noHtml(v);
}

/** URL https valid (ne-gol, doar schema https, fără spații / marcaje, ≤500). */
export function isHttpsUrl(value?: string | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return 'Introdu un URL.';
  if (!HTTPS_URL_RE.test(v)) return 'URL invalid (se acceptă doar https).';
  return null;
}

/** Înălțimea (cm) trebuie să fie un număr rezonabil (100–250). */
export function heightCm(value?: number | null): string | null {
  if (value == null || Number.isNaN(value)) return 'Introdu înălțimea în cm.';
  if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM) {
    return `Înălțimea trebuie să fie între ${MIN_HEIGHT_CM} și ${MAX_HEIGHT_CM} cm.`;
  }
  return null;
}

/**
 * Calculează vârsta în ani împliniți la data `now`, pe baza datei de naștere.
 *
 * Citim AMBELE date în UTC (`getUTC*`) — consecvent, independent de fusul orar al
 * mașinii. `isAdultAge` parsează data nașterii cu `new Date("YYYY-MM-DD")` =
 * miezul nopții UTC; dacă am amesteca getterele LOCALE, în fusurile negative
 * (toată America) ziua calendaristică s-ar muta înapoi și vârsta ar ieși cu o zi
 * mai mare → un minor ar trece de poarta 18+. UTC pe ambele elimină acest risc.
 */
export function computeAge(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

/** Data nașterii (ISO YYYY-MM-DD): validă, în trecut, vârsta ≥ `MIN_AGE` (18). */
export function isAdultAge(
  birthDate?: string | null,
  now: Date = new Date(),
): string | null {
  const v = (birthDate ?? '').trim();
  if (!v) return 'Introdu data nașterii.';
  const date = new Date(v);
  if (Number.isNaN(date.getTime())) return 'Data nașterii nu este validă.';
  if (date.getTime() > now.getTime()) return 'Data nașterii nu poate fi în viitor.';
  if (computeAge(date, now) < MIN_AGE) {
    return `Trebuie să ai cel puțin ${MIN_AGE} ani.`;
  }
  return null;
}

/** Raza de căutare (km): număr întreg pozitiv rezonabil (1–1000). */
export function searchRadiusKm(value?: string | null): string | null {
  const v = (value ?? '').trim();
  if (!v) return 'Introdu raza de căutare.';
  const n = Number(v);
  if (
    !Number.isInteger(n) ||
    n < MIN_SEARCH_RADIUS_KM ||
    n > MAX_SEARCH_RADIUS_KM
  ) {
    return `Raza trebuie să fie între ${MIN_SEARCH_RADIUS_KM} și ${MAX_SEARCH_RADIUS_KM} km.`;
  }
  return null;
}

/** Întoarce primul mesaj de eroare ne-nul dintr-o listă de verificări. */
export function firstError(...checks: (string | null)[]): string | null {
  for (const c of checks) {
    if (c) return c;
  }
  return null;
}
