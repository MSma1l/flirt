/**
 * Limitele de poze, CITITE din configurația backendului, nu presupuse.
 *
 * Sursa exactă — `backend/app/core/config.py`:
 *   min_photos: int = 2                      (l. 71)
 *   max_photos: int = 9                      (l. 72)
 *   max_upload_bytes: int = 8_388_608        (l. 326)  → 8 MB, răspuns 413 peste
 *   allowed_image_types = "image/jpeg,image/png,image/webp"  (l. 327) → 422 altfel
 *
 * ATENȚIE, limită reală a acestor constante: `settings` se poate suprascrie din
 * mediu pe server, deci valorile de aici sunt doar pentru MESAJE și pentru
 * pregătirea pozei înainte de trimitere. DECIZIA dacă onboardingul s-a terminat
 * NU se ia după ele, ci după `profile_completed` întors de `GET /auth/me` —
 * singurul semnal pe care backendul îl recalculează el însuși
 * (`profile_service._sync_profile_completed`).
 */

export const PHOTO_LIMITS = {
  /** Minimul cerut de backend ca profilul să conteze drept complet. */
  min: 2,
  /** Peste atâtea poze, `POST /profiles/photos` răspunde 422. */
  max: 9,
  /** Peste atâția octeți, backendul răspunde 413 — de aici vine recompresia. */
  maxUploadBytes: 8_388_608,
  /** Tipurile acceptate de backend (verificate și prin magic-bytes, nu doar header). */
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
} as const;

/**
 * Parametrii recompresiei în browser. Nu vin din backend: sunt alegerea noastră
 * pentru ca o poză de telefon (5–12 MB, 4000×3000) să intre sub limită fără să
 * arate rău. Aceleași trepte ca pe mobil (`mobile/src/features/photos`), plus o
 * treaptă de dimensiune în minus, pe care mobilul nu o are.
 */
export const COMPRESSION = {
  /** Latura mare, în trepte: coborâm doar dacă nici calitatea minimă n-a ajuns. */
  dimensions: [1920, 1440, 1080, 720] as readonly number[],
  /** Calitatea JPEG, de la cea mai bună la cea mai slabă acceptabilă. */
  qualities: [0.8, 0.7, 0.6, 0.5] as readonly number[],
  /** Formatul de ieșire — mereu unul din `PHOTO_LIMITS.allowedTypes`. */
  outputType: 'image/jpeg' as const,
} as const;

/** Formatează octeți în MB, cu o zecimală (pentru mesajele către utilizator). */
export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}
