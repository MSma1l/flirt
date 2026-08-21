/**
 * Mesajele și motivele de eșec ale verificării faciale (TZ 2.2).
 *
 * Sunt funcții PURE, fără module native: ecranul afișează un text gata scris,
 * iar maparea „ce a răspuns serverul → ce citește utilizatorul" e testabilă
 * separat de cameră. Regula de ton: nu învinovățim utilizatorul când vina poate
 * fi a rețelei sau a serviciului — un selfie respins nu înseamnă „ești fals".
 */
import axios from 'axios';

import i18n from '@/i18n';

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
 * Motiv → cheia din catalog.
 *
 * CODUL rămâne contractul (îl produce `faceVerifyReason` din statusul HTTP);
 * doar textul stă în `locales/<limba>/verification.json`. `no_match` acoperă
 * intenționat și cazul în care profilul n-are poze de referință: backend-ul
 * întoarce identic `verified=false, similarity=0` în ambele situații, așa că un
 * mesaj care ar afirma răspicat „nu semeni cu pozele tale" ar putea fi fals.
 */
const REASON_KEY = {
  no_match: 'verification:reasons.no_match',
  no_face: 'verification:reasons.no_face',
  invalid_image: 'verification:reasons.invalid_image',
  too_large: 'verification:reasons.too_large',
  rate_limited: 'verification:reasons.rate_limited',
  no_profile: 'verification:reasons.no_profile',
  unavailable: 'verification:reasons.unavailable',
  network: 'verification:reasons.network',
  unknown: 'verification:reasons.unknown',
} as const satisfies Record<FaceVerifyReason, string>;

/** Mesajele camerei, în afara mapării motivelor de la server. */
const CAMERA_KEY = {
  captureFailed: 'verification:camera.captureFailed',
  permission: 'verification:camera.permission',
  permissionBlocked: 'verification:camera.permissionBlocked',
} as const;

export type CameraMessageKey = keyof typeof CAMERA_KEY;

/**
 * Mesajul camerei, în limba activă.
 *
 * Modulul NU e o componentă (îl folosește și `faceCamera`), deci citește din
 * instanța globală — la FIECARE apel, nu la încărcare: altfel primul mesaj ar
 * îngheța limba pentru toată sesiunea. Același tipar ca `features/billing/iap.ts`
 * și `features/stories/storyLimits.ts`.
 */
export function cameraMessage(key: CameraMessageKey): string {
  return i18n.t(CAMERA_KEY[key]);
}

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

/** Motiv → mesaj afișabil, în limba activă. */
export function faceVerifyMessage(reason: FaceVerifyReason): string {
  return i18n.t(REASON_KEY[reason]);
}
