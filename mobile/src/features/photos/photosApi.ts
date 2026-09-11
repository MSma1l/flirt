/**
 * API de poze de profil (TZ 2.4) — backend-ul e deja gata:
 *   POST   /profiles/photos        (multipart, câmp `file`) → lista de URL-uri
 *   DELETE /profiles/photos        ({url})                  → lista de URL-uri
 *   PUT    /profiles/photos/order  ({urls})                 → lista de URL-uri
 *
 * Uploadul raportează progresul și reîncearcă automat la erorile de rețea /
 * 5xx / 429 (backoff liniar). NU reîncearcă la 4xx de validare — acolo problema
 * e poza, nu conexiunea, iar mesajul backend-ului e afișat ca atare.
 *
 * i18n: modulul NU produce propoziții, ci CHEI (`PhotoErrorReason`) — e cod pur,
 * apelat în afara randării, unde `t` nu există; același tipar ca
 * `features/auth/validation.ts`. Traducerea se face la afișare, cu
 * `usePhotoErrorText()`.
 */
import axios from 'axios';
import { Platform } from 'react-native';

import { api } from '@/services/api';

import { LocalPhoto } from './types';
import {
  formatMb,
  PHOTO_LIMITS,
  validatePhotoSize,
  validateUploadType,
} from './validation';

/** Cheile de eroare de upload, din namespace-ul `profile`. */
export type PhotoErrorKey =
  | 'photos.errors.blobLost'
  | 'photos.errors.network'
  | 'photos.errors.tooLarge'
  | 'photos.errors.uploadFailed';

/**
 * Motivul unui eșec de upload, gata de afișat:
 *  - `key` — text al NOSTRU, tradus la afișare;
 *  - `text` — text care NU trece prin i18n: `detail`-ul backend-ului (vine doar
 *    în română) și validarea locală din `./validation`, încă nemigrată.
 */
export type PhotoErrorReason =
  | { key: PhotoErrorKey; params?: Record<string, string | number> }
  | { text: string };

/** Câte reîncercări facem peste încercarea inițială. */
export const DEFAULT_RETRIES = 2;
/** Pauza dinaintea primei reîncercări (crește liniar cu numărul încercării). */
export const DEFAULT_RETRY_DELAY_MS = 800;

/** Opțiuni de upload: progres, reîncercări, pauză între ele (0 în teste). */
export interface UploadOptions {
  /** Progresul uploadului, între 0 și 1. */
  onProgress?: (ratio: number) => void;
  retries?: number;
  retryDelayMs?: number;
}

/** Partea de fișier dintr-un `FormData` React Native (nu e un `Blob` web). */
interface RNFilePart {
  uri: string;
  name: string;
  type: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Eroare de upload al cărei motiv e DEJA pregătit pentru utilizator.
 *
 * Există ca să putem deosebi motivele NOASTRE de excepțiile tehnice ale
 * platformei (`TypeError: Failed to fetch`, `Network request failed`) — pe
 * acelea nu avem voie să le arătăm ca atare. Marcarea se face cu o proprietate,
 * nu doar cu `instanceof`: după transpilare, lanțul de prototipuri al
 * subclaselor de `Error` nu e garantat în toate mediile.
 *
 * `message` rămâne pentru log-uri și stack trace; ce vede userul iese din
 * `reason`, tradus la afișare de `usePhotoErrorText()`.
 */
export class PhotoUploadError extends Error {
  readonly isPhotoUploadError = true;
  readonly reason: PhotoErrorReason;

  constructor(reason: PhotoErrorReason) {
    super('key' in reason ? reason.key : reason.text);
    this.reason = reason;
  }
}

/** True doar pentru erorile create de noi, cu mesaj gata de afișat. */
export function isPhotoUploadError(error: unknown): error is PhotoUploadError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isPhotoUploadError?: boolean }).isPhotoUploadError === true
  );
}

/** True pentru erorile care merită reîncercate: rețea căzută, 5xx, 429. */
export function isRetriableError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (status === undefined) return true; // fără răspuns → eroare de rețea/timeout
  return status >= 500 || status === 429;
}

/** Reduce o eroare de upload la motivul afișabil utilizatorului. */
export function uploadErrorReason(error: unknown): PhotoErrorReason {
  // Motivele noastre sunt deja pregătite (cheie sau text de la server).
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
  // ORICE altceva e o excepție tehnică a platformei, cu mesaj în engleză
  // (`Failed to fetch`, `Network request failed`). Utilizatorul nu are ce face cu
  // el, așa că îl înlocuim — nu îl afișăm „ca să nu pierdem informația".
  return { key: 'photos.errors.uploadFailed' };
}

/** Un singur POST multipart, cu raportarea progresului. */
async function postPhoto(
  photo: LocalPhoto,
  onProgress?: (ratio: number) => void,
): Promise<string[]> {
  const form = new FormData();
  // Header-ele diferă pe platformă: pe nativ forțăm `multipart/form-data`, pe web
  // NU (browserul trebuie să pună singur boundary-ul — vezi mai jos).
  let headers: Record<string, string> | undefined;

  if (Platform.OS === 'web') {
    // Browserul NU acceptă obiectul {uri,name,type} ca fișier — l-ar serializa ca
    // `[object Object]`, iar backend-ul n-ar vedea niciun `file`. Aducem conținutul
    // din `photo.uri` (un URL `blob:`/`data:`) într-un `Blob` real și îl atașăm cu
    // nume (al 3-lea argument), ca multipart-ul să conțină un fișier cu `filename`.
    let raw: Blob;
    try {
      raw = await (await fetch(photo.uri)).blob();
    } catch {
      // `fetch` pe un URL `blob:` aruncă un `TypeError` sec („Failed to fetch"),
      // NU o eroare axios — de obicei fiindcă URL-ul a fost revocat între timp
      // (pagina reîncărcată). Fără traducere, userul citea exact „Failed to fetch".
      throw new PhotoUploadError({ key: 'photos.errors.blobLost' });
    }

    // Backend-ul respinge cu 422 („Tip de fișier nepermis") după tipul DECLARAT al
    // părții multipart, adică `blob.type`. `canvas.toBlob` ne dă `image/jpeg`, dar
    // dacă tipul lipsește, partea ar pleca `application/octet-stream` și poza ar fi
    // refuzată deși e validă. Îl impunem pe cel pe care l-am produs la compresie.
    const blob =
      raw.type === photo.mimeType ? raw : new Blob([raw], { type: photo.mimeType });
    form.append('file', blob, photo.fileName);
    // NU setăm manual `Content-Type`: dacă îl forțăm, lipsește `boundary=...` și
    // parsarea multipart pică. Lăsăm browserul să-l compună (cu boundary corect).
  } else {
    const part: RNFilePart = {
      uri: photo.uri,
      name: photo.fileName,
      type: photo.mimeType,
    };
    // RN acceptă un obiect {uri,name,type} ca fișier; tipurile DOM cer `Blob`.
    form.append('file', part as unknown as Blob);
    headers = { 'Content-Type': 'multipart/form-data' };
  }

  const { data } = await api.post<string[]>('/profiles/photos', form, {
    headers,
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
 *
 * Validează local tipul și dimensiunea ÎNAINTE de a trimite ceva pe rețea:
 * dacă backend-ul ar respinge poza (422/413), utilizatorul află imediat.
 * La eșec aruncă `Error` cu mesajul gata de afișat.
 */
export async function uploadPhoto(
  photo: LocalPhoto,
  options: UploadOptions = {},
): Promise<string[]> {
  // `./validation` întoarce încă propoziții gata scrise, în română (migrarea ei
  // e o sarcină separată — vezi `src/i18n/README.md`), deci le trecem ca `text`.
  const typeError = validateUploadType(photo.mimeType);
  if (typeError) throw new PhotoUploadError({ text: typeError });
  // sizeBytes === 0 → dimensiune necunoscută pe platformă; backend-ul decide.
  const sizeError = photo.sizeBytes > 0 ? validatePhotoSize(photo.sizeBytes) : null;
  if (sizeError) throw new PhotoUploadError({ text: sizeError });

  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  let attempt = 0;
  for (;;) {
    try {
      return await postPhoto(photo, options.onProgress);
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
 * Salvează noua ordine a pozelor (prima = poza principală).
 * Backend-ul cere EXACT aceleași URL-uri, doar rearanjate.
 */
export async function reorderPhotos(urls: string[]): Promise<string[]> {
  const { data } = await api.put<string[]>('/profiles/photos/order', { urls });
  return data ?? [];
}
