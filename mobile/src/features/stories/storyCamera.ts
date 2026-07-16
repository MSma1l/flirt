/**
 * Captura POZEI de story cu camera (TZ secț. 11), stil Instagram/Snapchat.
 *
 *  - `captureStoryPhoto` face o poză (`takePictureAsync`) și o trece prin ACEEAȘI
 *    compresie ca pozele de profil (`compressPhoto`) — merge ȘI pe web, unde
 *    `takePictureAsync` întoarce un data URL din getUserMedia.
 *
 * Filmarea a fost scoasă deliberat: un story e doar o poză. Un clip nu poate fi
 * moderat automat, iar Apple Guideline 1.2 cere filtrarea conținutului obiecționabil
 * — pozele trec prin moderarea NSFW din backend, un video n-ar trece prin nimic.
 * Backend-ul refuză oricum orice upload de video cu 422.
 *
 * Interfața e structurală (nu tipul nativ `CameraView`) → logica e testabilă fără
 * cameră reală.
 */
import { compressPhoto } from '@/features/photos';

import { StoryMediaFile } from './storiesApi';
import { STORY_MESSAGES } from './storyLimits';

/** Partea din `CameraView` de care avem nevoie pentru o poză. */
export interface CapturingCamera {
  takePictureAsync: (options?: {
    quality?: number;
  }) => Promise<
    { uri: string; width?: number; height?: number; format?: 'jpg' | 'png' } | undefined
  >;
}

/** Rezultatul unei capturi de poză — nu aruncă niciodată. */
export type CaptureResult =
  | { status: 'captured'; file: StoryMediaFile }
  | { status: 'rejected'; message: string };

/**
 * Face o poză și o pregătește pentru upload (compresie ca la pozele de profil).
 * Nu aruncă: orice eșec devine `{ status: 'rejected', message }`.
 */
export async function captureStoryPhoto(
  camera: CapturingCamera,
): Promise<CaptureResult> {
  try {
    // Calitate maximă la captură; `compressPhoto` reduce controlat sub limita de upload.
    const photo = await camera.takePictureAsync({ quality: 1 });
    if (!photo?.uri) {
      return { status: 'rejected', message: STORY_MESSAGES.captureFailed };
    }

    // Nu forțăm MIME-ul aici: `compressPhoto` reencodează oricum în JPEG.
    const compressed = await compressPhoto({
      uri: photo.uri,
      width: photo.width ?? 0,
      height: photo.height ?? 0,
    });
    if (!compressed.ok) {
      return { status: 'rejected', message: compressed.message };
    }

    return {
      status: 'captured',
      file: {
        uri: compressed.photo.uri,
        mimeType: compressed.photo.mimeType,
        fileName: compressed.photo.fileName,
        mediaType: 'image',
      },
    };
  } catch {
    return { status: 'rejected', message: STORY_MESSAGES.captureFailed };
  }
}
