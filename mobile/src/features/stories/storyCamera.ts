/**
 * Captură + filmare de story cu camera (TZ secț. 11), stil Instagram/Snapchat.
 *
 *  - `captureStoryPhoto` face o poză (`takePictureAsync`) și o trece prin ACEEAȘI
 *    compresie ca pozele de profil (`compressPhoto`) — merge ȘI pe web, unde
 *    `takePictureAsync` întoarce un data URL din getUserMedia.
 *  - `recordStoryVideo` filmează un clip scurt (nativ) — `recordAsync` se rezolvă
 *    la `stopRecording()` sau la `maxDuration`; îl împachetăm ca video fără
 *    recompresie (backend-ul validează).
 *
 * Interfețe structurale (nu tipul nativ `CameraView`) → logica e testabilă fără
 * cameră reală.
 */
import { compressPhoto } from '@/features/photos';

import { StoryMediaFile } from './storiesApi';
import { DEFAULT_VIDEO_MIME, STORY_MESSAGES } from './storyLimits';

/** Partea din `CameraView` de care avem nevoie pentru înregistrare. */
export interface RecordingCamera {
  recordAsync: (options?: {
    maxDuration?: number;
  }) => Promise<{ uri: string } | undefined>;
  stopRecording: () => void;
}

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

/** Rezultatul unei înregistrări — nu aruncă niciodată. */
export type RecordResult =
  | { status: 'recorded'; file: StoryMediaFile }
  | { status: 'rejected'; message: string };

let recCounter = 0;

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

/** MIME plauzibil din extensia URI-ului livrat de cameră (backend-ul reconfirmă). */
function videoMimeFromUri(uri: string): string {
  return /\.mov($|\?)/i.test(uri) ? 'video/quicktime' : DEFAULT_VIDEO_MIME;
}

/**
 * Pornește înregistrarea și se rezolvă când clipul e gata (stop sau maxDuration).
 * Apelantul oprește prin `camera.stopRecording()`.
 */
export async function recordStoryVideo(
  camera: RecordingCamera,
  maxSeconds: number,
): Promise<RecordResult> {
  try {
    const video = await camera.recordAsync({ maxDuration: maxSeconds });
    if (!video?.uri) return { status: 'rejected', message: STORY_MESSAGES.recordFailed };

    recCounter += 1;
    const mimeType = videoMimeFromUri(video.uri);
    const ext = mimeType === 'video/quicktime' ? 'mov' : 'mp4';
    return {
      status: 'recorded',
      file: {
        uri: video.uri,
        mimeType,
        fileName: `story-rec-${Date.now()}-${recCounter}.${ext}`,
        mediaType: 'video',
      },
    };
  } catch {
    return { status: 'rejected', message: STORY_MESSAGES.recordFailed };
  }
}
