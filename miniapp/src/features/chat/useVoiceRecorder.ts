/**
 * Înregistrarea unui mesaj vocal prin `MediaRecorder`.
 *
 * LIMITĂ REALĂ: WebView-ul Telegram pe iOS (și Safari vechi) poate să nu aibă
 * `MediaRecorder` sau `getUserMedia`. Atunci `isVoiceRecordingSupported()` dă
 * `false`, iar composerul ascunde complet microfonul — nu arătăm un buton care
 * n-ar face nimic.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { MEDIA_LIMITS } from './chatMedia';

/** Formatele încercate, în ordinea preferinței. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function isVoiceRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/** Primul format suportat, sau `''` (browserul alege singur). */
export function pickAudioMimeType(): string {
  const MR = typeof window !== 'undefined' ? window.MediaRecorder : undefined;
  if (!MR || typeof MR.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((m) => MR.isTypeSupported(m)) ?? '';
}

/** Extensia potrivită formatului, pentru numele părții multipart. */
export function audioExtension(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export interface VoiceRecording {
  blob: Blob;
  durationMs: number;
  mime: string;
}

export type RecorderStatus = 'idle' | 'starting' | 'recording';
export type RecorderError = 'denied' | 'unavailable' | null;

/**
 * @param onAutoStop chemat când înregistrarea atinge limita de 5 minute și se
 *   oprește singură — apelantul o trimite.
 */
export function useVoiceRecorder(onAutoStop: (rec: VoiceRecording) => void) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<RecorderError>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveRef = useRef<((rec: VoiceRecording | null) => void) | null>(null);
  const discardRef = useRef(false);
  const autoStopRef = useRef(onAutoStop);
  autoStopRef.current = onAutoStop;

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStatus('idle');
    setElapsedMs(0);
  }, []);

  /** Oprește și întoarce înregistrarea (sau `null` la anulare / eșec). */
  const finish = useCallback(
    (discard: boolean): Promise<VoiceRecording | null> => {
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
    if (!isVoiceRecordingSupported()) {
      setError('unavailable');
      return;
    }
    setError(null);
    setStatus('starting');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      setStatus('idle');
      return;
    }

    const mime = pickAudioMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      setError('unavailable');
      setStatus('idle');
      return;
    }

    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    discardRef.current = false;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const durationMs = Math.min(Date.now() - startedAtRef.current, MEDIA_LIMITS.voiceMs);
      const type = recorder.mimeType || mime || 'audio/webm';
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
      if (elapsed >= MEDIA_LIMITS.voiceMs && recorderRef.current?.state === 'recording') {
        // Limita de 5 minute: oprire automată → `onstop` fără `resolve` → trimitere.
        recorderRef.current.stop();
      }
    }, 200);
  }, [cleanup]);

  // Ieșirea din ecran în timpul înregistrării: microfonul se eliberează.
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
    start,
    stop,
    cancel,
    clearError: () => setError(null),
  };
}
