/**
 * Micșorarea selfie-ului ÎNAINTE de trimitere.
 *
 * Un selfie de telefon are 3–12 MB; limita serverului e `max_upload_bytes`
 * (`backend/app/core/config.py`, 8 MB), iar peste ea `_validate_image_upload`
 * răspunde 413. Fără pasul ăsta, verificarea ar eșua exact la utilizatorii cu
 * telefoane bune.
 *
 * REUTILIZAT prin import, nu copiat: `compressImage` + `browserIo` din
 * `features/onboarding/imageCompress.ts`. Acolo e deja bucla care coboară întâi
 * calitatea, apoi dimensiunea (1920 → 1440 → 1080 → 720), și tot acolo e
 * detecția tipului real din magic-bytes — exact ce verifică și backendul. O
 * copie s-ar fi desincronizat la prima schimbare de limită.
 *
 * Ce adaugă modulul ăsta, și de ce nu e doar un alias: traduce rezultatul
 * compresiei în același vocabular de motive pe care îl folosește restul
 * fluxului (`FaceVerifyReason`), ca ecranul să aibă O SINGURĂ listă de cazuri —
 * fie că eșecul a venit de la server, fie că poza n-a plecat niciodată.
 */
import {
  compressImage,
  type CompressIo,
  type DecodedImage,
} from '@/features/onboarding/imageCompress';
import { PHOTO_LIMITS } from '@/features/onboarding/photoLimits';

import type { FaceVerifyReason } from './faceVerifyApi';

/** Selfie-ul gata de trimis, sau motivul pentru care nu poate fi trimis. */
export type PreparedSelfie =
  | { ok: true; blob: Blob; fileName: string }
  | { ok: false; reason: FaceVerifyReason };

/**
 * Pregătește selfie-ul pentru `POST /profiles/verify-face`.
 *
 * `io` e explicit (fără valoare implicită) pentru că `CompressIo<T>` nu e
 * covariant: un `CompressIo<BrowserImage>` nu se poate atribui unui
 * `CompressIo<DecodedImage>` sub `strictFunctionTypes`. Ecranul trimite
 * `browserIo`, testele trimit o pereche falsă.
 */
export async function prepareSelfie<T extends DecodedImage>(
  file: Blob,
  io: CompressIo<T>,
  limits: { maxUploadBytes: number; allowedTypes: readonly string[] } = PHOTO_LIMITS,
): Promise<PreparedSelfie> {
  const result = await compressImage(file, io, limits);

  if (result.ok) return { ok: true, blob: result.blob, fileName: result.fileName };

  // `tooLarge` = nici la ultima treaptă nu intră sub limită. Serverul ar
  // răspunde 413, deci îi spunem utilizatorului același lucru fără să mai
  // trimitem 8 MB degeaba.
  if (result.reason === 'tooLarge') return { ok: false, reason: 'too_large' };

  // `type` (fișier care nu e imagine) și `decode` (HEIC, fișier rupt, browser
  // fără encoder) ajung amândouă la 422 pe server, deci la același text.
  return { ok: false, reason: 'invalid_image' };
}
