/**
 * API de poze de profil (TZ 2.4) — backend-ul e deja gata:
 *   POST   /profiles/photos        (multipart, câmp `file`) → lista de URL-uri
 *   DELETE /profiles/photos        ({url})                  → lista de URL-uri
 *   PUT    /profiles/photos/order  ({urls})                 → lista de URL-uri
 *
 * Uploadul raportează progresul și reîncearcă automat la erorile de rețea /
 * 5xx / 429 (backoff liniar). NU reîncearcă la 4xx de validare — acolo problema
 * e poza, nu conexiunea, iar mesajul backend-ului e afișat ca atare.
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
 * Eroare de upload al cărei `message` e DEJA scris pentru utilizator, în română.
 *
 * Există ca să putem deosebi mesajele NOASTRE de excepțiile tehnice ale
 * platformei (`TypeError: Failed to fetch`, `Network request failed`) — pe
 * acelea nu avem voie să le arătăm ca atare. Marcarea se face cu o proprietate,
 * nu doar cu `instanceof`: după transpilare, lanțul de prototipuri al
 * subclaselor de `Error` nu e garantat în toate mediile.
 */
export class PhotoUploadError extends Error {
  readonly isPhotoUploadError = true;
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

/** Traduce o eroare de upload într-un mesaj clar pentru utilizator. */
export function uploadErrorMessage(error: unknown): string {
  // Mesajele noastre sunt deja în română și explică ce are userul de făcut.
  if (isPhotoUploadError(error) && error.message) return error.message;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status === undefined) {
      return 'Conexiune întreruptă. Verifică internetul și încearcă din nou.';
    }
    if (status === 413) {
      return `Poza depășește limita de ${formatMb(PHOTO_LIMITS.maxUploadBytes)}.`;
    }
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    return 'Nu am putut încărca poza. Încearcă din nou.';
  }
  // ORICE altceva e o excepție tehnică a platformei, cu mesaj în engleză
  // (`Failed to fetch`, `Network request failed`). Utilizatorul nu are ce face cu
  // el, așa că îl înlocuim — nu îl afișăm „ca să nu pierdem informația".
  return 'Nu am putut încărca poza. Încearcă din nou.';
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
      throw new PhotoUploadError(
        'Poza nu mai este disponibilă în browser. Alege-o din nou și încearcă iar.',
      );
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
  const typeError = validateUploadType(photo.mimeType);
  if (typeError) throw new PhotoUploadError(typeError);
  // sizeBytes === 0 → dimensiune necunoscută pe platformă; backend-ul decide.
  const sizeError = photo.sizeBytes > 0 ? validatePhotoSize(photo.sizeBytes) : null;
  if (sizeError) throw new PhotoUploadError(sizeError);

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
      throw new PhotoUploadError(uploadErrorMessage(error));
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
