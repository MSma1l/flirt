/**
 * Mesajele și motivele de eșec ale verificării faciale (TZ 2.2).
 *
 * Sunt funcții PURE, fără module native: ecranul afișează un text gata scris,
 * iar maparea „ce a răspuns serverul → ce citește utilizatorul" e testabilă
 * separat de cameră. Regula de ton: nu învinovățim utilizatorul când vina poate
 * fi a rețelei sau a serviciului — un selfie respins nu înseamnă „ești fals".
 */
import axios from 'axios';

/** De ce nu a reușit verificarea (sau de ce nici nu a plecat pe rețea). */
export type FaceVerifyReason =
  /** Serverul a răspuns, dar fața nu se potrivește cu pozele de profil. */
  | 'no_match'
  /** Nu s-a detectat nicio față în selfie. */
  | 'no_face'
  /** Fișierul trimis nu e o imagine validă / e gol / are tip nepermis. */
  | 'invalid_image'
  /** Selfie-ul depășește limita de upload a backend-ului (413). */
  | 'too_large'
  /** Prea multe încercări într-un interval scurt (429). */
  | 'rate_limited'
  /** Profilul nu există încă (404) — nu ai cu ce compara selfie-ul. */
  | 'no_profile'
  /** Serviciul de verificare nu răspunde (5xx). */
  | 'unavailable'
  /** Cererea nu a ajuns la server (internet căzut, timeout). */
  | 'network'
  /** Orice altceva neașteptat. */
  | 'unknown';

/**
 * Textele afișate utilizatorului. `no_match` acoperă intenționat și cazul în
 * care profilul n-are poze de referință: backend-ul întoarce identic
 * `verified=false, similarity=0` în ambele situații, așa că un mesaj care ar
 * afirma răspicat „nu semeni cu pozele tale" ar putea fi pur și simplu fals.
 */
export const FACE_MESSAGES: Record<FaceVerifyReason, string> = {
  no_match:
    'Nu am putut confirma că ești tu. Asigură-te că fața ta e clar vizibilă și ' +
    'bine luminată, iar pozele din profil te arată la față. Poți încerca din nou.',
  no_face:
    'Nu am găsit nicio față în selfie. Ține telefonul la nivelul ochilor și ' +
    'încadrează-ți fața complet, apoi încearcă din nou.',
  invalid_image:
    'Selfie-ul nu a putut fi citit. Încearcă să faci altul, cu lumină mai bună.',
  too_large: 'Selfie-ul e prea mare pentru încărcare. Încearcă din nou.',
  rate_limited:
    'Ai încercat de prea multe ori. Așteaptă câteva minute și revino.',
  no_profile:
    'Ai nevoie de un profil cu poze înainte de verificare. Completează-ți profilul, apoi revino.',
  unavailable:
    'Serviciul de verificare nu răspunde acum. Nu e din vina ta — încearcă din nou peste câteva minute.',
  network: 'Conexiune întreruptă. Verifică internetul și încearcă din nou.',
  unknown: 'Verificarea nu a reușit. Încearcă din nou.',
};

/** Detaliul de eroare trimis de FastAPI (`{"detail": "..."}`), dacă există. */
function errorDetail(error: unknown): string {
  if (!axios.isAxiosError(error)) return '';
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  return typeof detail === 'string' ? detail.toLowerCase() : '';
}

/**
 * Traduce eroarea unei cereri în motivul de afișat.
 *
 * Statusurile vin din backend (`app/api/v1/profiles.py` → `_validate_image_upload`):
 * 413 = prea mare, 422 = imagine invalidă/tip nepermis/câmp lipsă, 404 = fără profil.
 */
export function faceVerifyReason(error: unknown): FaceVerifyReason {
  if (!axios.isAxiosError(error)) return 'unknown';

  const status = error.response?.status;
  // Fără răspuns → cererea n-a ajuns la server (internet căzut, DNS, timeout).
  if (status === undefined) return 'network';

  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'no_profile';
  if (status === 422) {
    // Dacă backend-ul ajunge să distingă „nicio față detectată", o prindem aici
    // fără să mai schimbăm ecranul; azi 422 înseamnă imagine invalidă.
    return /față|fata|face/.test(errorDetail(error)) ? 'no_face' : 'invalid_image';
  }
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

/** Motiv → mesaj afișabil. */
export function faceVerifyMessage(reason: FaceVerifyReason): string {
  return FACE_MESSAGES[reason];
}

/** Mesajul când camera nu a putut face poza (eroare neașteptată de sistem). */
export const CAPTURE_FAILED_MESSAGE =
  'Nu am putut face selfie-ul. Încearcă din nou.';

/** Permisiune refuzată, dar sistemul mai poate afișa dialogul o dată. */
export const CAMERA_PERMISSION_MESSAGE =
  'Avem nevoie de cameră ca să faci selfie-ul de verificare. ' +
  'Fără acces, verificarea nu poate fi făcută.';

/**
 * Refuz definitiv: sistemul nu mai arată dialogul, singura cale rămasă e
 * ecranul de Setări — de aceea nu lăsăm utilizatorul într-un ecran mort.
 */
export const CAMERA_PERMISSION_BLOCKED_MESSAGE =
  'Accesul la cameră este oprit. Deschide setările și activează camera pentru FLIRT, ' +
  'apoi revino la verificare.';
