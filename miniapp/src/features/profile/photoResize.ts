/**
 * Pregătirea unei poze pentru upload, în BROWSER: redimensionare + recompresie
 * cu `canvas.toBlob()`.
 *
 * De ce e obligatoriu: o poză făcută cu un telefon modern are 5–12 MB, iar
 * backend-ul respinge orice depășește `max_upload_bytes` (8 MB) cu 413. Pe mobil
 * treaba asta o face `mobile/src/features/photos/photoPicker.ts` prin
 * `expo-image-manipulator`; aici replicăm EXACT același algoritm — max 1920px pe
 * latura mare, JPEG, iar dacă tot nu intră în limită scădem calitatea până la
 * pragul minim și abia atunci renunțăm, cu mesaj clar.
 *
 * Modulul mobil NU se poate importa: `photoPicker.ts` trage `expo-file-system`,
 * `expo-image-manipulator`, `expo-image-picker` și `react-native`, iar
 * `photos/validation.ts` (unde stau limitele) importă `@/config`, care în Mini
 * App e configul de aici, fără secțiunea `photos`. Rămâne portat, nu copiat:
 * aceiași pași, scriși pentru DOM.
 */

/**
 * Limitele de poze, simetrice cu backend-ul (`app/core/config.py`:
 * `min_photos=2`, `max_photos=9`, `max_upload_bytes=8 MB`,
 * `allowed_image_types=image/jpeg,image/png,image/webp`).
 *
 * `maxDimension`, `compressQuality` și pragurile de recompresie sunt EXCLUSIV
 * client-side (aceleași valori ca `mobile/src/config.ts` → `photos`).
 */
export const PHOTO_LIMITS = {
  min: 2,
  max: 9,
  maxUploadBytes: 8_388_608,
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] as readonly string[],
  maxDimension: 1920,
  compressQuality: 0.8,
  minCompressQuality: 0.4,
  compressQualityStep: 0.1,
} as const;

/** Tipurile pe care `<input type="file">` le poate întoarce de pe iPhone. */
export const CONVERTIBLE_TYPES: readonly string[] = ['image/heic', 'image/heif'];

/** Tipul rezultat mereu după recompresie (acceptat de backend). */
export const OUTPUT_MIME_TYPE = 'image/jpeg';

/** Formatează bytes în MB, cu o zecimală. */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/**
 * Dimensiunea țintă când latura mare depășește `maxDimension`.
 * `null` = poza e deja destul de mică — nu o mărim niciodată.
 * Port al lui `resizeTarget` din `mobile/src/features/photos/validation.ts`.
 */
export function resizeTarget(
  width: number,
  height: number,
  maxDimension: number = PHOTO_LIMITS.maxDimension,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxDimension) return null;
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Mai încape o poză? Întoarce mesajul de eroare dacă nu. */
export function validateCanAddPhoto(currentCount: number): string | null {
  if (currentCount >= PHOTO_LIMITS.max) {
    return `Ai atins numărul maxim de ${PHOTO_LIMITS.max} poze. Șterge una ca să adaugi alta.`;
  }
  return null;
}

/** Numărul de poze e în intervalul cerut de backend? */
export function validatePhotoCount(count: number): string | null {
  if (count < PHOTO_LIMITS.min) {
    const left = PHOTO_LIMITS.min - count;
    return (
      `Adaugă cel puțin ${PHOTO_LIMITS.min} poze ca să continui ` +
      `(mai ai ${left} de adăugat).`
    );
  }
  if (count > PHOTO_LIMITS.max) return `Poți avea maximum ${PHOTO_LIMITS.max} poze.`;
  return null;
}

/** Tipul fișierului ales: permis de backend sau convertibil de noi (HEIC). */
export function validateSourceType(mimeType?: string | null): string | null {
  const type = (mimeType ?? '').trim().toLowerCase();
  // Unele browsere nu raportează tipul; nu e o eroare — recompresia forțează
  // JPEG, iar backend-ul verifică oricum magic-bytes.
  if (!type) return null;
  if (PHOTO_LIMITS.allowedTypes.includes(type)) return null;
  if (CONVERTIBLE_TYPES.includes(type)) return null;
  const names = PHOTO_LIMITS.allowedTypes.map((t) => t.replace('image/', '').toUpperCase());
  return `Tip de fișier nepermis. Acceptăm doar ${names.slice(0, -1).join(', ')} sau ${
    names[names.length - 1]
  }.`;
}

/** Mesaj când nici la calitatea minimă poza nu intră sub limita backend-ului. */
export function tooLargeAfterCompression(sizeBytes: number): string {
  return (
    `Poza rămâne prea mare (${formatMb(sizeBytes)}) chiar și după comprimare, ` +
    `iar limita este ${formatMb(PHOTO_LIMITS.maxUploadBytes)}. Alege altă poză.`
  );
}

/**
 * Mesaj când poza a fost aleasă, dar browserul nu a putut să o decodeze.
 * Cazul real: HEIC/HEIF, formatul implicit al iPhone-ului, pe care majoritatea
 * browserelor nu îl deschid. Utilizatorul trebuie să afle CE să facă.
 */
export const IMAGE_DECODE_FAILED_MESSAGE =
  'Nu am putut procesa poza. Unele formate (de exemplu HEIC, cel implicit pe ' +
  'iPhone) nu pot fi deschise aici. Alege altă poză sau salveaz-o ca JPEG.';

/** Rezultatul pregătirii unei poze. */
export type PreparedPhoto =
  | { ok: true; blob: Blob; fileName: string; previewUrl: string }
  | { ok: false; message: string };

/** Contor pentru nume de fișier unice (backend-ul își generează oricum cheia). */
let photoCounter = 0;

/** Rotunjire la 2 zecimale — evită erorile de virgulă mobilă la scăderea calității. */
function roundQuality(q: number): number {
  return Math.round(q * 100) / 100;
}

/** Încarcă fișierul într-un `<img>` decodat, prin `blob:`. Curăță URL-ul. */
async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode-failed'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** `canvas.toBlob` ca promisiune (API-ul DOM e pe callback). */
function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), OUTPUT_MIME_TYPE, quality);
  });
}

/**
 * Redimensionează și recomprimă poza până intră sub `maxUploadBytes`.
 *
 * Nu aruncă niciodată: orice eșec devine `{ok:false, message}`, ca ecranul să
 * poată afișa un mesaj util în loc să crape.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const typeError = validateSourceType(file.type);
  if (typeError) return { ok: false, message: typeError };

  let img: HTMLImageElement;
  try {
    img = await loadImage(file);
  } catch {
    return { ok: false, message: IMAGE_DECODE_FAILED_MESSAGE };
  }

  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) return { ok: false, message: IMAGE_DECODE_FAILED_MESSAGE };

  const target = resizeTarget(width, height) ?? { width, height };

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, message: IMAGE_DECODE_FAILED_MESSAGE };
  ctx.drawImage(img, 0, 0, target.width, target.height);

  let quality: number = PHOTO_LIMITS.compressQuality;
  for (;;) {
    const blob = await canvasToBlob(canvas, quality);
    if (!blob) return { ok: false, message: IMAGE_DECODE_FAILED_MESSAGE };

    if (blob.size <= PHOTO_LIMITS.maxUploadBytes) {
      photoCounter += 1;
      return {
        ok: true,
        blob,
        fileName: `photo-${Date.now()}-${photoCounter}.jpg`,
        previewUrl: URL.createObjectURL(blob),
      };
    }

    if (quality <= PHOTO_LIMITS.minCompressQuality) {
      return { ok: false, message: tooLargeAfterCompression(blob.size) };
    }
    quality = Math.max(
      PHOTO_LIMITS.minCompressQuality,
      roundQuality(quality - PHOTO_LIMITS.compressQualityStep),
    );
  }
}
