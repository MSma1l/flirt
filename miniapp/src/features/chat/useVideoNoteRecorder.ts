/**
 * Înregistrarea unui mesaj video rotund („кружок", ca în Telegram) prin
 * `MediaRecorder`: camera frontală + microfonul, maximum 60 de secunde.
 *
 * Aceeași mașină de stări ca `useVoiceRecorder` (idle → starting → recording),
 * plus `stream`-ul camerei, pe care composerul îl arată în previzualizarea
 * rotundă. Serverul convertește oricum rezultatul în MP4 H.264/AAC pătrat
 * (`backend/app/services/chat_media.py::ensure_playable_video_note`), deci
 * formatul ales aici contează doar pentru mărimea uploadului.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { MEDIA_LIMITS } from './chatMedia';
import { isVoiceRecordingSupported, type RecorderError, type RecorderStatus } from './useVoiceRecorder';

/**
 * Formatele încercate, în ordinea preferinței: MP4 întâi (singurul pe care
 * iOS / WebView-ul Telegram îl înregistrează și îl redă), apoi WebM (Android,
 * desktop Chrome / Firefox).
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

export interface VideoNoteRecording {
  blob: Blob;
  durationMs: number;
  mime: string;
}

/**
 * @param onAutoStop chemat când înregistrarea atinge limita de 60 s și se
 *   oprește singură — apelantul o trimite.
 */
export function useVideoNoteRecorder(onAutoStop: (rec: VideoNoteRecording) => void) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<RecorderError>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((rec: VideoNoteRecording | null) => void) | null>(null);
  const discardRef = useRef(false);
  const autoStopRef = useRef(onAutoStop);
  autoStopRef.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
        cleanup();
        return Promise.resolve(null);
      }
      discardRef.current = discard;
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        try {
          recorder.stop();
        } catch {
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
    setError(null);
    setStatus('starting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        // Camera frontală, cât mai aproape de pătrat; serverul decupează oricum.
        video: {
          facingMode: 'user',
          width: { ideal: 480 },
          height: { ideal: 480 },
          aspectRatio: { ideal: 1 },
        },
        audio: true,
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      setStatus('idle');
      return;
    }

    const mime = pickVideoMimeType();
    let recorder: MediaRecorder;
    try {
      const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS_PER_SECOND };
      if (mime) options.mimeType = mime;
      recorder = new MediaRecorder(media, options);
    } catch {
      media.getTracks().forEach((track) => track.stop());
      setError('unavailable');
      setStatus('idle');
      return;
    }

    streamRef.current = media;
    recorderRef.current = recorder;
    chunksRef.current = [];
    discardRef.current = false;
    setStream(media);

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Math.min(Date.now() - startedAtRef.current, MEDIA_LIMITS.videoNoteMs);
      const type = recorder.mimeType || mime || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      const result =
        discardRef.current || blob.size === 0 ? null : { blob, durationMs, mime: type };
      const resolve = resolveRef.current;
      resolveRef.current = null;
      cleanup();
      if (resolve) resolve(result);
      else if (result) autoStopRef.current(result);
    };

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start(250);
    setStatus('recording');
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      setElapsedMs(elapsed);
      if (elapsed >= MEDIA_LIMITS.videoNoteMs && recorderRef.current?.state === 'recording') {
        // Limita de 60 s: oprire automată → `onstop` fără `resolve` → trimitere.
        recorderRef.current.stop();
      }
    }, 200);
  }, [cleanup]);

  // Ieșirea din ecran în timpul înregistrării: camera și microfonul se eliberează.
  useEffect(
    () => () => {
      discardRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          /* deja oprit */
        }
      }
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return {
    status,
    error,
    elapsedMs,
    stream,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
