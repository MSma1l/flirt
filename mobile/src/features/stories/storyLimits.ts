/**
 * Limite și mesaje pentru media de story (TZ secț. 11).
 *
 * Valorile OGLINDESC backend-ul (`allowed_video_types`, `story_video_max_bytes`):
 * durata/dimensiunea sunt filtrate ÎNTÂI local (feedback instant, fără upload
 * sortit eșecului), dar poarta finală rămâne serverul (magic-bytes + limite).
 */

/** Durata maximă a unui video de story (secunde) — clip scurt, stil Instagram. */
export const STORY_VIDEO_MAX_SECONDS = 30;

/** Dimensiunea maximă a unui video (bytes). Simetric cu `STORY_VIDEO_MAX_BYTES` din backend. */
export const STORY_VIDEO_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** MIME implicit pentru un video fără tip cunoscut (backend-ul îl reconfirmă). */
export const DEFAULT_VIDEO_MIME = 'video/mp4';

/** Mesaje afișabile (RO), fără module native — testabile separat. */
export const STORY_MESSAGES = {
  pickerFailed: 'Nu am putut deschide galeria. Încearcă din nou.',
  permissionDenied:
    'Avem nevoie de acces la galerie ca să alegi o poză sau un clip.',
  permissionBlocked:
    'Accesul la galerie este oprit. Deschide setările, activează-l pentru FLIRT, apoi revino.',
  cameraPermission:
    'Avem nevoie de acces la cameră ca să faci o poză sau să filmezi un story.',
  cameraPermissionBlocked:
    'Accesul la cameră este oprit. Deschide setările și activează camera pentru FLIRT, apoi revino.',
  cameraUnavailable:
    'Nu am putut porni camera aici. Poți alege în schimb o poză sau un clip din galerie.',
  micPermission:
    'Pentru clipuri cu sunet avem nevoie și de microfon. Îl poți activa din setări.',
  captureFailed: 'Nu am putut face poza. Încearcă din nou.',
  recordFailed: 'Nu am putut înregistra clipul. Încearcă din nou.',
  videoTooLong: `Clipul e prea lung. Alege unul de cel mult ${STORY_VIDEO_MAX_SECONDS} de secunde.`,
  videoTooLarge: 'Clipul e prea mare pentru încărcare. Alege unul mai scurt.',
  uploadFailed: 'Nu am putut încărca media. Încearcă din nou.',
  createFailed: 'Nu am putut publica povestea. Încearcă din nou.',
} as const;
