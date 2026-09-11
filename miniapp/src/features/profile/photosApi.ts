/**
 * Pozele de profil peste HTTP (rutele confirmate în `backend/app/api/v1/profiles.py`):
 *   POST   /profiles/photos        multipart, câmp `file` → lista de URL-uri
 *   DELETE /profiles/photos        body {url}             → lista de URL-uri
 *   PUT    /profiles/photos/order  body {urls}            → lista de URL-uri
 *
 * Port pentru DOM al lui `mobile/src/features/photos/photosApi.ts`. Acela nu se
 * poate importa (`import { Platform } from 'react-native'`), dar regulile lui au
 * fost păstrate una câte una, fiindcă fiecare are un motiv:
 *  - `FormData` cu un `Blob` REAL + nume de fișier (al treilea argument), altfel
 *    backend-ul nu vede niciun `file`;
 *  - `Content-Type` NEsetat manual: dacă îl forțăm, lipsește `boundary=…` și
 *    parsarea multipart pică. Îl compune browserul;
 *  - blobul primește explicit tipul produs de recompresie: backend-ul respinge
 *    cu 422 după tipul DECLARAT al părții multipart, iar un blob fără tip ar
 *    pleca `application/octet-stream`;
 *  - reîncercare la rețea căzută / 5xx / 429, NICIODATĂ la 4xx de validare —
 *    acolo problema e poza, nu conexiunea.
 *
 * Erorile ies ca CHEI de traducere (namespace `profile`), nu ca propoziții:
 * modulul e cod pur, chemat în afara randării, unde `t` nu există.
 */
import axios from 'axios';

import { api } from '@/api/client';

import { formatMb, PHOTO_LIMITS } from './photoResize';

/**
 * Mută elementul de la `from` la `to`, întorcând o listă NOUĂ.
 * Indecși în afara intervalului sau `from === to` → lista neschimbată (copie).
 *
 * Identică, linie cu linie, cu `mobile/src/features/photos/reorder.ts`, dar NU
 * se poate importa: acolo `const [item] = next.splice(from, 1)` e `T`, fiindcă
 * tsconfig-ul mobil nu are `noUncheckedIndexedAccess`; al Mini App-ului îl are,
 * deci același cod dă `T | undefined` și `tsc --noEmit` cade pe fișierul din
 * `mobile/` (fișier pe care nu avem voie să-l atingem). Aici e aceeași logică,
 * cu accesul verificat.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) {
    return next;
  }
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...list];
  next.splice(to, 0, item);
  return next;
}

/** Cheile de eroare de upload, din catalogul `profile`. */
export type PhotoErrorKey =
  | 'photos.errors.blobLost'
  | 'photos.errors.network'
  | 'photos.errors.tooLarge'
  | 'photos.errors.uploadFailed';

/**
 * Motivul unui eșec, gata de afișat:
 *  - `key` — text al NOSTRU, tradus la afișare;
 *  - `text` — text care NU trece prin i18n (`detail`-ul backend-ului, care vine
 *    doar în română, și validările locale de poze).
 */
export type PhotoErrorReason =
  | { key: PhotoErrorKey; params?: Record<string, string | number> }
  | { text: string };

export const DEFAULT_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 800;

export interface UploadOptions {
  /** Progresul uploadului, între 0 și 1. */
  onProgress?: (ratio: number) => void;
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Eroare al cărei motiv e DEJA pregătit pentru utilizator.
 *
 * Marcarea se face cu o proprietate, nu doar cu `instanceof`: după transpilare,
 * lanțul de prototipuri al subclaselor de `Error` nu e garantat în toate mediile.
 */
export class PhotoUploadError extends Error {
  readonly isPhotoUploadError = true;
  readonly reason: PhotoErrorReason;

  constructor(reason: PhotoErrorReason) {
    super('key' in reason ? reason.key : reason.text);
    this.reason = reason;
  }
}

export function isPhotoUploadError(error: unknown): error is PhotoUploadError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isPhotoUploadError?: boolean }).isPhotoUploadError === true
  );
}

/** Merită reîncercat: rețea căzută, 5xx, 429. */
export function isRetriableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return true; // fără răspuns → rețea/timeout
  return status >= 500 || status === 429;
}

/** Reduce o eroare la motivul afișabil utilizatorului. */
export function uploadErrorReason(error: unknown): PhotoErrorReason {
  if (isPhotoUploadError(error)) return error.reason;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) return { key: 'photos.errors.network' };
    if (status === 413) {
      return {
        key: 'photos.errors.tooLarge',
        params: { limit: formatMb(PHOTO_LIMITS.maxUploadBytes) },
      };
    }
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) return { text: detail };
    return { key: 'photos.errors.uploadFailed' };
  }
  // Orice altceva e o excepție tehnică a platformei, cu mesaj în engleză.
  return { key: 'photos.errors.uploadFailed' };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Un singur POST multipart, cu raportarea progresului. */
async function postPhoto(
  blob: Blob,
  fileName: string,
  onProgress?: (ratio: number) => void,
): Promise<string[]> {
  const form = new FormData();
  // Tipul declarat al părții multipart decide verdictul backend-ului, deci îl
  // impunem pe cel produs de recompresie dacă blobul a pierdut-o pe drum.
  const part = blob.type ? blob : new Blob([blob], { type: 'image/jpeg' });
  form.append('file', part, fileName);

  const { data } = await api.post<string[]>('/profiles/photos', form, {
    onUploadProgress: (event) => {
      if (!onProgress) return;
      const total = event.total ?? 0;
      if (total > 0) onProgress(Math.min(1, event.loaded / total));
    },
  });
  return data ?? [];
}

/**
 * Încarcă o poză și întoarce lista actualizată de URL-uri.
 * La eșec aruncă `PhotoUploadError`, cu motivul deja pregătit pentru afișare.
 */
export async function uploadPhoto(
  blob: Blob,
  fileName: string,
  options: UploadOptions = {},
): Promise<string[]> {
  if (blob.size > PHOTO_LIMITS.maxUploadBytes) {
    throw new PhotoUploadError({
      key: 'photos.errors.tooLarge',
      params: { limit: formatMb(PHOTO_LIMITS.maxUploadBytes) },
    });
  }

  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let attempt = 0;
  for (;;) {
    try {
      return await postPhoto(blob, fileName, options.onProgress);
    } catch (error) {
      if (attempt < retries && isRetriableError(error)) {
        attempt += 1;
        if (retryDelayMs > 0) await delay(retryDelayMs * attempt);
        options.onProgress?.(0);
        continue;
      }
      throw new PhotoUploadError(uploadErrorReason(error));
    }
  }
}

/** Șterge o poză de pe server; întoarce lista actualizată de URL-uri. */
export async function deletePhoto(url: string): Promise<string[]> {
  const { data } = await api.delete<string[]>('/profiles/photos', { data: { url } });
  return data ?? [];
}

/**
 * Salvează noua ordine (prima = poza principală).
 * Backend-ul cere EXACT aceleași URL-uri, doar rearanjate.
 */
export async function reorderPhotos(urls: string[]): Promise<string[]> {
  const { data } = await api.put<string[]>('/profiles/photos/order', { urls });
  return data ?? [];
}
