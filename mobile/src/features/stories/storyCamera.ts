/**
 * Filmarea unui story cu camera selfie (TZ secț. 11) — DOAR nativ.
 *
 * O interfață structurală (nu tipul nativ `CameraView`) ține logica testabilă
 * fără cameră reală. `recordAsync` se rezolvă când apelăm `stopRecording()` sau
 * când se atinge `maxDuration`; noi doar împachetăm rezultatul într-un
 * `StoryMediaFile` de tip video (fără recompresie — backend-ul validează).
 */
import { StoryMediaFile } from './storiesApi';
import { DEFAULT_VIDEO_MIME, STORY_MESSAGES } from './storyLimits';

/** Partea din `CameraView` de care avem nevoie pentru înregistrare. */
export interface RecordingCamera {
  recordAsync: (options?: {
    maxDuration?: number;
  }) => Promise<{ uri: string } | undefined>;
  stopRecording: () => void;
}

/** Rezultatul unei înregistrări — nu aruncă niciodată. */
export type RecordResult =
  | { status: 'recorded'; file: StoryMediaFile }
  | { status: 'rejected'; message: string };

let recCounter = 0;

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
