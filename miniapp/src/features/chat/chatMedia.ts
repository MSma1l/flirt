/**
 * Regulile pentru atașamentele din chat: tipul fișierului, limitele de mărime
 * (aceleași ca pe server, verificate ÎNAINTE de upload), traducerea erorilor
 * HTTP în chei de text și micșorarea opțională a pozelor mari.
 *
 * Limitele vin din contractul backendului:
 *   imagine ≤ 10 MB · vocal ≤ 10 MB și ≤ 5 min · video ≤ 50 MB.
 * Serverul rămâne poarta finală (413 / 415 / 422) — aici doar scutim
 * utilizatorul de un upload lung care oricum ar fi refuzat.
 */
import { isAxiosError } from 'axios';

import { browserIo, compressImage } from '@/features/onboarding/imageCompress';

import type { MessageKind } from './chatApi';

const MB = 1024 * 1024;

export const MEDIA_LIMITS = {
  imageBytes: 10 * MB,
  videoBytes: 50 * MB,
  voiceBytes: 10 * MB,
  voiceMs: 5 * 60_000,
} as const;

/** Peste atât micșorăm poza în browser (economie de date și upload mai rapid). */
export const IMAGE_DOWNSCALE_FROM_BYTES = 1.5 * MB;

export type MediaKind = Exclude<MessageKind, 'text'>;

/** Motivul pentru care un fișier nu poate fi trimis. */
export type MediaErrorReason =
  | 'tooLargeImage'
  | 'tooLargeVideo'
  | 'tooLargeVoice'
  | 'unsupported'
  | 'empty'
  | 'generic';

export type MediaCheck = { ok: true; kind: MediaKind } | { ok: false; reason: MediaErrorReason };

/** Tipul de atașament după MIME (și după extensie, când sistemul nu dă MIME). */
export function mediaKindOf(file: Blob & { name?: string }): MediaKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'voice';
  const name = (file.name ?? '').toLowerCase();
  if (/\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)) return 'image';
  if (/\.(mp4|mov|webm|m4v|3gp)$/.test(name)) return 'video';
  return null;
}

/** Validarea de dinainte de upload: tip, gol, mărime (și durată la vocal). */
export function validateMedia(
  file: Blob & { name?: string },
  durationMs?: number,
): MediaCheck {
  const kind = mediaKindOf(file);
  if (!kind) return { ok: false, reason: 'unsupported' };
  if (file.size <= 0) return { ok: false, reason: 'empty' };
  if (kind === 'image' && file.size > MEDIA_LIMITS.imageBytes) {
    return { ok: false, reason: 'tooLargeImage' };
  }
  if (kind === 'video' && file.size > MEDIA_LIMITS.videoBytes) {
    return { ok: false, reason: 'tooLargeVideo' };
  }
  if (
    kind === 'voice' &&
    (file.size > MEDIA_LIMITS.voiceBytes || (durationMs ?? 0) > MEDIA_LIMITS.voiceMs + 1000)
  ) {
    return { ok: false, reason: 'tooLargeVoice' };
  }
  return { ok: true, kind };
}

/** Eroarea de la server → motivul afișabil. */
export function uploadErrorReason(error: unknown, kind: MediaKind): MediaErrorReason {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 413) {
    return kind === 'video' ? 'tooLargeVideo' : kind === 'voice' ? 'tooLargeVoice' : 'tooLargeImage';
  }
  if (status === 415) return 'unsupported';
  if (status === 422) return 'empty';
  return 'generic';
}

/** Cheia de text (namespace `screens`) pentru un motiv. */
export function mediaErrorKey(reason: MediaErrorReason): string {
  return `screens:chat.errors.${reason}`;
}

/**
 * Micșorează o poză mare înainte de upload, REUTILIZÂND bucla din onboarding.
 * Orice eșec (HEIC nedecodabil, encoder lipsă) întoarce fișierul ORIGINAL:
 * serverul decide atunci, iar utilizatorul nu e blocat de o optimizare.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; fileName: string }> {
  if (file.size <= IMAGE_DOWNSCALE_FROM_BYTES || file.type === 'image/gif') {
    return { blob: file, fileName: file.name || 'photo.jpg' };
  }
  try {
    const result = await compressImage(file, browserIo, {
      maxUploadBytes: MEDIA_LIMITS.imageBytes,
      allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });
    if (result.ok && result.blob.size < file.size) {
      return { blob: result.blob, fileName: result.fileName };
    }
  } catch {
    /* cădem pe original */
  }
  return { blob: file, fileName: file.name || 'photo.jpg' };
}

/** „1:05" din milisecunde. */
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** `URL.createObjectURL` defensiv (lipsește în jsdom și în WebView-uri vechi). */
export function makeObjectUrl(blob: Blob): string {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '';
  } catch {
    return '';
  }
}

export function revokeObjectUrl(url: string): void {
  if (!url) return;
  try {
    if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
  } catch {
    /* nimic de eliberat */
  }
}
