/**
 * Validare de poze pe FRONTEND, simetrică cu backend-ul (`app/api/v1/profiles.py`
 * → `_validate_image_upload` + `settings.min_photos/max_photos`): tip MIME permis,
 * dimensiune maximă, număr minim/maxim de poze.
 *
 * Scopul: utilizatorul vede eroarea ÎNAINTE de upload, nu după ce backend-ul
 * întoarce 413/422. Funcții pure — fără module native, ușor de testat.
 * Limitele NU sunt hardcodate aici: vin din `config.photos` (app.json → extra).
 */
import { config } from '@/config';

/** Limitele de poze (sursă unică pe mobil, simetrice cu backend-ul). */
export const PHOTO_LIMITS = config.photos;

/**
 * Tipuri pe care galeria le poate întoarce, dar backend-ul NU le acceptă — le
 * convertim noi la JPEG la compresie (iOS livrează frecvent HEIC/HEIF).
 */
export const CONVERTIBLE_TYPES: readonly string[] = ['image/heic', 'image/heif'];

/** Tipul MIME rezultat mereu după compresie (acceptat de backend). */
export const OUTPUT_MIME_TYPE = 'image/jpeg';

/** Formatează bytes în MB, cu o zecimală (pentru mesajele către utilizator). */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Eticheta prietenoasă a tipurilor acceptate (ex. „JPEG, PNG sau WebP"). */
function allowedTypesLabel(): string {
  const names = PHOTO_LIMITS.allowedTypes.map((t) => t.replace('image/', '').toUpperCase());
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} sau ${names[names.length - 1]}`;
}

/**
 * Tipul unei poze ALESE din galerie: acceptăm tipurile permise de backend + cele
 * convertibile (HEIC/HEIF), fiindcă oricum le reencodăm în JPEG înainte de upload.
 * Un tip lipsă (unele Content-Provider-e Android nu îl raportează) NU e o eroare:
 * compresia forțează JPEG, iar backend-ul verifică oricum magic-bytes.
 */
export function validateSourceType(mimeType?: string | null): string | null {
  const type = (mimeType ?? '').trim().toLowerCase();
  if (!type) return null;
  if (PHOTO_LIMITS.allowedTypes.includes(type)) return null;
  if (CONVERTIBLE_TYPES.includes(type)) return null;
  return `Tip de fișier nepermis. Acceptăm doar ${allowedTypesLabel()}.`;
}

/**
 * Tipul unei poze GATA DE UPLOAD — aici allowlist-ul e strict cel al backend-ului
 * (ultima poartă înainte de multipart).
 */
export function validateUploadType(mimeType: string): string | null {
  if (PHOTO_LIMITS.allowedTypes.includes(mimeType.trim().toLowerCase())) return null;
  return `Tip de fișier nepermis. Acceptăm doar ${allowedTypesLabel()}.`;
}

/** Dimensiunea fișierului: ≤ `max_upload_bytes` (backend răspunde 413 peste). */
export function validatePhotoSize(sizeBytes: number): string | null {
  if (sizeBytes > PHOTO_LIMITS.maxUploadBytes) {
    return (
      `Poza are ${formatMb(sizeBytes)}, peste limita de ` +
      `${formatMb(PHOTO_LIMITS.maxUploadBytes)}. Alege o poză mai mică.`
    );
  }
  return null;
}

/** Numărul de poze: cel puțin `min`, cel mult `max` (simetric cu backend-ul). */
export function validatePhotoCount(count: number): string | null {
  if (count < PHOTO_LIMITS.min) {
    const left = PHOTO_LIMITS.min - count;
    return (
      `Adaugă cel puțin ${PHOTO_LIMITS.min} poze ca să continui ` +
      `(mai ai ${left} de adăugat).`
    );
  }
  if (count > PHOTO_LIMITS.max) {
    return `Poți avea maximum ${PHOTO_LIMITS.max} poze.`;
  }
  return null;
}

/** Verifică dacă mai încape o poză; întoarce mesajul de eroare dacă nu. */
export function validateCanAddPhoto(currentCount: number): string | null {
  if (currentCount >= PHOTO_LIMITS.max) {
    return `Ai atins numărul maxim de ${PHOTO_LIMITS.max} poze. Șterge una ca să adaugi alta.`;
  }
  return null;
}

/**
 * Latura mare depășește `maxDimension` → dimensiunea țintă pentru redimensionare.
 * `null` = poza e deja destul de mică, nu o mărim niciodată (ar strica calitatea).
 */
export function resizeTarget(
  width: number,
  height: number,
  maxDimension: number = PHOTO_LIMITS.maxDimension,
): { width: number } | { height: number } | null {
  const longest = Math.max(width, height);
  if (longest <= 0 || longest <= maxDimension) return null;
  return width >= height ? { width: maxDimension } : { height: maxDimension };
}

/** Mesaj când nici la calitatea minimă poza nu intră sub limita backend-ului. */
export function tooLargeAfterCompression(sizeBytes: number): string {
  return (
    `Poza rămâne prea mare (${formatMb(sizeBytes)}) chiar și după comprimare, ` +
    `iar limita este ${formatMb(PHOTO_LIMITS.maxUploadBytes)}. Alege altă poză.`
  );
}

/** Mesajul afișat când utilizatorul refuză accesul la galerie. */
export const PERMISSION_DENIED_MESSAGE =
  'Nu avem acces la galerie, așa că nu putem încărca poze. ' +
  'Deschide setările și activează accesul la poze pentru FLIRT.';

/** Mesaj când galeria nu a putut fi deschisă (eroare neașteptată de sistem). */
export const PICKER_FAILED_MESSAGE =
  'Nu am putut deschide galeria. Încearcă din nou.';

/**
 * Mesaj când poza a fost ALEASĂ, dar nu a putut fi decodată/procesată.
 *
 * Cazul real: pe web `expo-image-manipulator` încarcă poza într-un `<img>`, iar
 * browserul nu știe să decodeze HEIC/HEIF (formatul implicit al iPhone-ului) —
 * încărcarea eșuează, iar galeria n-are nicio vină. Mesajul trebuie să spună ce
 * are utilizatorul de FĂCUT, nu că „nu am putut deschide galeria" (neadevărat).
 */
export const IMAGE_PROCESSING_FAILED_MESSAGE =
  'Nu am putut procesa poza. Unele formate (de exemplu HEIC, cel implicit pe ' +
  'iPhone) nu pot fi deschise aici. Alege altă poză sau salveaz-o ca JPEG.';
