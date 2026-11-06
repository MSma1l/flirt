/**
 * Înregistrarea unui mesaj video rotund („кружок", ca în Telegram) prin
 * `MediaRecorder`: camera frontală + microfonul, maximum 60 de secunde.
 *
 * Aceeași mașină de stări ca `useVoiceRecorder` (idle → starting → recording),
 * plus `stream`-ul camerei, pe care composerul îl arată în previzualizarea
 * rotundă, și `mirrored` (camera primită e cea frontală → previzualizarea se
 * oglindește; fișierul rămâne NEOGLINDIT, ca la povești — vezi `StoryCamera`).
 * Serverul convertește oricum rezultatul în MP4 H.264/AAC pătrat
 * (`backend/app/services/chat_media.py::ensure_playable_video_note`), deci
 * formatul ales aici contează doar pentru mărimea uploadului.
 *
 * CAMERA SE STINGE MEREU: la trimitere, anulare, eroare, demontare — și când
 * anularea / demontarea vine ÎN TIMP CE `getUserMedia` încă așteaptă (dialogul
 * de permisiune pe iOS). Fiecare `start` are o „sesiune"; un flux sosit pentru o
 * sesiune expirată e oprit imediat, nu pornește o înregistrare ascunsă.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { MEDIA_LIMITS } from './chatMedia';
import { isVoiceRecordingSupported, type RecorderError, type RecorderStatus } from './useVoiceRecorder';

/**
 * Formatele încercate, în ordinea preferinței: MP4 întâi (singurul pe care
 * iOS / WebView-ul Telegram îl înregistrează și îl redă; Chrome ≥ 126 îl are și
 * el), apoi WebM (Android / desktop mai vechi, Firefox).
 */
const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];

/** ~1 Mbps: 60 s ≈ 7-8 MB, cu mult sub plafonul de 50 MB al serverului. */
const VIDEO_BITS_PER_SECOND = 1_000_000;

/**
 * Sub o secundă nu e un mesaj, e o atingere scăpată: înregistrarea se aruncă
 * (ca în Telegram). Un MP4 de câteva sute de ms poate avea doar antetul, fără
 * niciun cadru — serverul l-ar respinge oricum.
 */
export const MIN_VIDEO_NOTE_MS = 1000;

/** Camera frontală, cât mai aproape de pătrat; serverul decupează oricum. */
const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    facingMode: 'user',
    width: { ideal: 480 },
    height: { ideal: 480 },
    aspectRatio: { ideal: 1 },
  },
  audio: true,
};

/**
 * A doua încercare, FĂRĂ microfon: un laptop / Telegram Desktop cu cameră dar
 * fără microfon dă `NotFoundError` la cererea combinată. Un „кружок" mut e mai
 * util decât „înregistrarea nu e disponibilă" (serverul acceptă video fără sunet).
 */
const CAMERA_ONLY_CONSTRAINTS: MediaStreamConstraints = {
  video: CAMERA_CONSTRAINTS.video,
  audio: false,
};

/** Aceleași API-uri ca la vocal (`MediaRecorder` + `getUserMedia`). */
export const isVideoNoteRecordingSupported = isVoiceRecordingSupported;

/** Primul format video suportat, sau `''` (browserul alege singur). */
export function pickVideoMimeType(): string {
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined;
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return VIDEO_MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? '';
}

/** Extensia potrivită formatului, pentru numele părții multipart. */
export function videoExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  return 'webm';
}

function errorName(e: unknown): string | undefined {
  return (e as { name?: string } | null)?.name;
}

/** Permisiunea refuzată (de utilizator sau de sistem / Telegram). */
function isDenied(e: unknown): boolean {
  const name = errorName(e);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

/**
 * Previzualizarea se oglindește doar pentru camera FRONTALĂ efectiv primită
 * (`facingMode` cerut e doar o preferință). Fără informație (desktop) — da.
 */
function isFrontCamera(stream: MediaStream): boolean {
  const track = stream.getVideoTracks?.()[0];
  return track?.getSettings?.().facingMode !== 'environment';
}

function stopTracks(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* pista e deja oprită */
    }
  });
}

/** `MediaRecorder` cu formatul ales; dacă refuză opțiunile, fără ele. */
function createRecorder(stream: MediaStream, mime: string): MediaRecorder | null {
  const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS_PER_SECOND };
  if (mime) options.mimeType = mime;
  try {
    return new MediaRecorder(stream, options);
  } catch {
    try {
      return new MediaRecorder(stream);
    } catch {
      return null;
    }
  }
}

export interface VideoNoteRecording {
  blob: Blob;
  durationMs: number;
  mime: string;
}

/**
 * @param onAutoStop chemat când înregistrarea se oprește singură (limita de
 *   60 s, camera întreruptă de sistem) — apelantul o trimite.
 */
export function useVideoNoteRecorder(onAutoStop: (rec: VideoNoteRecording) => void) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<RecorderError>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mirrored, setMirrored] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((rec: VideoNoteRecording | null) => void) | null>(null);
  const discardRef = useRef(false);
  /** Sesiunea curentă: crește la fiecare start / anulare / demontare. */
  const sessionRef = useRef(0);
  const autoStopRef = useRef(onAutoStop);
  autoStopRef.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    stopTracks(streamRef.current);
    streamRef.current = null;
    recorderRef.current = null;
    setStream(null);
    setStatus('idle');
    setElapsedMs(0);
  }, []);

  /** Oprește și întoarce înregistrarea (sau `null` la anulare / eșec). */
  const finish = useCallback(
    (discard: boolean): Promise<VideoNoteRecording | null> => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        // Încă în `starting` (dialogul de permisiune): fluxul care va sosi
        // aparține unei sesiuni expirate și va fi oprit pe loc.
        sessionRef.current += 1;
        cleanup();
        return Promise.resolve(null);
      }
      discardRef.current = discard;
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        try {
          recorder.stop();
        } catch {
          resolveRef.current = null;
          cleanup();
          resolve(null);
        }
      });
    },
    [cleanup],
  );

  const stop = useCallback(() => finish(false), [finish]);
  const cancel = useCallback(() => {
    void finish(true);
  }, [finish]);

  const start = useCallback(async () => {
    if (!isVideoNoteRecordingSupported()) {
      setError('unavailable');
      return;
    }
    const session = ++sessionRef.current;
    const stale = () => session !== sessionRef.current;
    setError(null);
    setStatus('starting');

    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    } catch (first) {
      if (isDenied(first) || stale()) {
        if (!stale()) {
          setError('denied');
          setStatus('idle');
        }
        return;
      }
      try {
        media = await navigator.mediaDevices.getUserMedia(CAMERA_ONLY_CONSTRAINTS);
      } catch (second) {
        if (!stale()) {
          setError(isDenied(second) ? 'denied' : 'unavailable');
          setStatus('idle');
        }
        return;
      }
    }
    if (stale()) {
      // Anulat / demontat cât timp se aștepta camera: o stingem imediat.
      stopTracks(media);
      return;
    }

    const fail = () => {
      stopTracks(media);
      setError('unavailable');
      setStatus('idle');
    };

    const mime = pickVideoMimeType();
    const recorder = createRecorder(media, mime);
    if (!recorder) {
      fail();
      return;
    }

    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      // Encoderul / camera au căzut: nimic de trimis, camera se stinge.
      // `stop` declanșează `onstop` (curățarea); dacă e deja oprit, o facem aici.
      discardRef.current = true;
      setError('unavailable');
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
          return;
        } catch {
          /* cade pe curățarea de mai jos */
        }
      }
      if (recorderRef.current !== recorder) return;
      const resolve = resolveRef.current;
      resolveRef.current = null;
      cleanup();
      resolve?.(null);
    };
    recorder.onstop = () => {
      if (recorderRef.current !== recorder) return;
      const durationMs = Math.min(Date.now() - startedAtRef.current, MEDIA_LIMITS.videoNoteMs);
      const type = recorder.mimeType || mime || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      const result =
        discardRef.current || blob.size === 0 || durationMs < MIN_VIDEO_NOTE_MS
          ? null
          : { blob, durationMs, mime: type };
      const resolve = resolveRef.current;
      resolveRef.current = null;
      cleanup();
      if (resolve) resolve(result);
      else if (result) autoStopRef.current(result);
    };

    try {
      recorder.start(250);
    } catch {
      fail();
      return;
    }

    streamRef.current = media;
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setMirrored(isFrontCamera(media));
    setStream(media);
    setElapsedMs(0);
    setStatus('recording');
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(Math.min(elapsed, MEDIA_LIMITS.videoNoteMs));
      if (elapsed >= MEDIA_LIMITS.videoNoteMs && recorderRef.current?.state === 'recording') {
        // Limita de 60 s: oprire automată → `onstop` fără `resolve` → trimitere.
        recorderRef.current.stop();
      }
    }, 200);
  }, [cleanup]);

  // Ieșirea din ecran (și în timpul `getUserMedia`): camera și microfonul se
  // eliberează, nimic nu se trimite.
  useEffect(
    () => () => {
      sessionRef.current += 1;
      discardRef.current = true;
      resolveRef.current = null;
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* deja oprit */
        }
      }
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      stopTracks(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  return {
    status,
    error,
    elapsedMs,
    stream,
    /** Previzualizarea se oglindește (camera frontală); fișierul nu. */
    mirrored,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
