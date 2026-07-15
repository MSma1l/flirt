/**
 * Captura selfie-ului de verificare (TZ 2.2).
 *
 * Compresia NU e rescrisă aici: refolosim `compressPhoto` din `features/photos`,
 * singurul loc unde trăiesc limitele de upload (latura maximă, calitatea, tipurile
 * permise din `config.photos`, simetrice cu backend-ul). Un selfie brut de pe un
 * telefon modern are câțiva MB și ar lua 413 de la `/profiles/verify-face`, care
 * validează exact aceleași limite ca la pozele de profil.
 */
import { compressPhoto, LocalPhoto } from '@/features/photos';

import { CAPTURE_FAILED_MESSAGE } from './messages';

/** Tipul MIME al pozei livrate de cameră (expo-camera scrie JPEG). */
const CAPTURE_MIME_TYPE = 'image/jpeg';

/**
 * Partea din `CameraView` de care avem nevoie. O interfață structurală (nu tipul
 * nativ) ține funcția testabilă fără cameră reală.
 */
export interface SelfieCamera {
  takePictureAsync: (options?: {
    quality?: number;
    exif?: boolean;
    base64?: boolean;
  }) => Promise<{ uri: string; width: number; height: number } | undefined>;
}

/** Rezultatul unei încercări de captură — nu aruncă niciodată. */
export type SelfieCaptureResult =
  /** Selfie făcut, redimensionat și comprimat — gata de upload. */
  | { status: 'captured'; photo: LocalPhoto }
  /** Captura a eșuat sau poza a fost respinsă local (mesaj gata de afișat). */
  | { status: 'rejected'; message: string };

/**
 * Face selfie-ul și îl pregătește pentru upload.
 *
 * Capturăm la calitate maximă și comprimăm NOI, controlat, după aceea — la fel ca
 * la pozele de profil: calitatea camerei nu ne spune nimic despre bytes-ii finali,
 * iar limita backend-ului e în bytes. EXIF-ul e lăsat afară intenționat: ar căra
 * geolocație într-o poză care oricum nu ajunge în profil.
 */
export async function captureSelfie(camera: SelfieCamera): Promise<SelfieCaptureResult> {
  try {
    const picture = await camera.takePictureAsync({ quality: 1, exif: false });
    if (!picture?.uri) return { status: 'rejected', message: CAPTURE_FAILED_MESSAGE };

    const compressed = await compressPhoto({
      uri: picture.uri,
      width: picture.width,
      height: picture.height,
      mimeType: CAPTURE_MIME_TYPE,
    });
    if (!compressed.ok) return { status: 'rejected', message: compressed.message };

    return { status: 'captured', photo: compressed.photo };
  } catch {
    return { status: 'rejected', message: CAPTURE_FAILED_MESSAGE };
  }
}
