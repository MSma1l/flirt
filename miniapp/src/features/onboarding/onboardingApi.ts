/**
 * Accesul la API pentru înregistrare.
 *
 * REUTILIZAT din aplicația Expo, fără copiere (`@mobile/features/anketa/anketaApi`):
 *   - `fetchReference` — aduce catalogul de la `GET /profiles/reference` și
 *     alege eticheta limbii active, cu revenire pe română. Nimic hardcodat:
 *     genurile, statusurile, limbile și interesele vin de la server.
 *   - `submitAnketa`  — mapează draftul în snake_case pentru `PUT /profiles/me`.
 *     Conține și capcana pe care am fi călcat-o altfel: ruta REESCRIE lista de
 *     poze, deci `photos` se trimite ÎNTOTDEAUNA, altfel pozele deja urcate se
 *     șterg.
 * Importul merge fiindcă ambele fișiere sunt pure, iar `@/services/api` și
 * `@/i18n/config` sunt redirecționate spre Mini App (vezi tsconfig.json și
 * `src/i18n/config.ts`).
 *
 * SCRIS AICI: uploadul de poze. Varianta mobilă (`photosApi.ts`) importă
 * `react-native`, deci nu poate fi folosită în browser; păstrăm însă lecțiile
 * din ea, marcate mai jos.
 */
import { AxiosError } from 'axios';

import { fetchReference, submitAnketa } from '@mobile/features/anketa/anketaApi';
import type { AnketaDraft, Reference } from '@mobile/features/anketa/types';

import { api } from '@/api/client';

import { formatMb, PHOTO_LIMITS } from './photoLimits';

export { fetchReference, submitAnketa };
export type { AnketaDraft, Reference };

/**
 * Un mesaj de eroare gata de afișat: fie o CHEIE a noastră (tradusă în cele
 * trei limbi), fie TEXTUL backendului.
 *
 * Onest despre limită: `detail`-ul backendului vine doar în română („Poza
 * conține nuditate explicită…", „Selectează cel puțin un interes valid."). Îl
 * arătăm ca atare fiindcă e specific și acționabil — un text generic tradus ar
 * ascunde exact motivul respingerii. Traducerea lui ține de backend.
 */
export type ApiMessage =
  | { key: string; params?: Record<string, string | number> }
  | { text: string };

/** `detail`-ul din răspunsul backendului, dacă e un text. */
function serverDetail(error: AxiosError): string | null {
  const data = error.response?.data as { detail?: unknown } | undefined;
  return typeof data?.detail === 'string' && data.detail.trim() ? data.detail : null;
}

/** Traduce orice eșec de rețea într-un mesaj pe care ecranul îl poate arăta. */
export function apiErrorMessage(error: unknown, fallbackKey: string): ApiMessage {
  const axiosError = error as AxiosError;
  if (!axiosError?.isAxiosError) return { key: fallbackKey };
  if (!axiosError.response) return { key: 'onboarding.errors.network' };
  if (axiosError.response.status === 413) {
    return {
      key: 'onboarding.errors.photoTooLarge',
      params: { limit: formatMb(PHOTO_LIMITS.maxUploadBytes) },
    };
  }
  const detail = serverDetail(axiosError);
  if (detail) return { text: detail };
  return { key: fallbackKey };
}

/** Forma întoarsă de `GET /profiles/me` (`ProfileOut` din backend). */
export interface MyProfile {
  name: string;
  birth_date: string;
  gender: string;
  height_cm: number;
  city: string;
  street?: string | null;
  nationality?: string | null;
  languages?: string[];
  about?: string | null;
  dating_statuses?: string[];
  interests?: string[];
  photos?: string[];
  completed?: boolean;
  interested_in?: string[];
  age_min?: number | null;
  age_max?: number | null;
}

/**
 * Anketa curentă, sau `null` dacă nu există încă.
 *
 * 404 NU e o eroare aici: e răspunsul normal pentru un cont nou (backendul
 * ridică „Anketa nu există încă."). Îl transformăm în `null` ca ecranul să
 * poată porni de la datele Telegramului fără să arate o eroare falsă.
 */
export async function fetchMyProfile(): Promise<MyProfile | null> {
  try {
    const { data } = await api.get<MyProfile>('/profiles/me');
    return data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError?.isAxiosError && axiosError.response?.status === 404) return null;
    throw error;
  }
}

/** Anketa salvată → draftul editabil al formularului. */
export function profileToDraft(profile: MyProfile): AnketaDraft {
  return {
    name: profile.name,
    birthDate: profile.birth_date,
    gender: profile.gender,
    heightCm: profile.height_cm,
    city: profile.city,
    street: profile.street ?? undefined,
    nationality: profile.nationality ?? undefined,
    languages: profile.languages ?? [],
    about: profile.about ?? undefined,
    datingStatuses: profile.dating_statuses ?? [],
    interests: profile.interests ?? [],
    // Pozele DEJA urcate: `PUT /profiles/me` rescrie lista, deci trebuie
    // retrimise la fiecare salvare, altfel se șterg.
    photos: profile.photos ?? [],
  };
}

/**
 * Urcă o poză și întoarce lista actualizată de URL-uri.
 *
 * Detaliile care contează, moștenite din varianta web a lui `photosApi.ts`:
 *  - `FormData` cu al treilea argument (numele fișierului), altfel partea
 *    multipart pleacă fără `filename` și backendul nu o vede ca fișier;
 *  - NU setăm `Content-Type` manual: fără `boundary=...` parsarea multipart
 *    pică. Browserul îl compune singur, iar clientul nostru axios nu impune un
 *    `Content-Type` implicit exact ca să nu strice asta;
 *  - tipul blobului e IMPUS: backendul respinge după tipul DECLARAT al părții,
 *    iar un blob fără tip ar pleca `application/octet-stream` și o poză bună ar
 *    fi refuzată cu 422.
 */
export async function uploadPhoto(
  blob: Blob,
  fileName: string,
  onProgress?: (ratio: number) => void,
): Promise<string[]> {
  const typed =
    blob.type && PHOTO_LIMITS.allowedTypes.includes(blob.type)
      ? blob
      : new Blob([blob], { type: 'image/jpeg' });

  const form = new FormData();
  form.append('file', typed, fileName);

  const { data } = await api.post<string[]>('/profiles/photos', form, {
    onUploadProgress: (event) => {
      if (!onProgress) return;
      const total = event.total ?? 0;
      if (total > 0) onProgress(Math.min(1, event.loaded / total));
    },
  });
  return data ?? [];
}

/** Șterge o poză de pe server; întoarce lista actualizată. */
export async function deletePhoto(url: string): Promise<string[]> {
  const { data } = await api.delete<string[]>('/profiles/photos', { data: { url } });
  return data ?? [];
}
