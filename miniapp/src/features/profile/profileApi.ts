/**
 * Acces la API pentru profilul propriu al Mini App-ului.
 *
 * CE SE REUTILIZEAZĂ din aplicația Expo (prin alias-ul `@mobile/`, fără copiere):
 *  - `MyProfile` din `mobile/src/features/profile/profileApi.ts` — forma
 *    camelCase a profilului, extinsă aici;
 *  - `AnketaDraft`, `Reference`, `OptionItem`, `InterestOption` din
 *    `mobile/src/features/anketa/types.ts` — fișier de tipuri PUR.
 *
 * CE NU S-A PUTUT REUTILIZA, și de ce (limită reală de rezoluție a alias-urilor):
 *  - `fetchMyProfile` din mobil ARUNCĂ `verified`, `completed`, `age` și
 *    preferințele de căutare la mapare. Ecranul de profil al Mini App-ului
 *    trebuie să arate starea de verificare, deci ne trebuie maparea completă.
 *    Un al doilea GET doar pentru două booleene ar fi fost risipă, așa că
 *    mapăm noi răspunsul — dar peste TIPUL mobil, ca să nu divergem.
 *  - `mobile/src/features/anketa/anketaApi.ts` importă `@/i18n/config`, iar în
 *    Mini App `@/` e `miniapp/src/`, unde nu există `i18n/config` (i18n-ul de
 *    aici are un singur `index.ts`). Modulul nu se poate rezolva, deci
 *    `fetchReference` / `submitAnketa` sunt rescrise aici, cu ACELEAȘI reguli
 *    (etichetă în limba activă, fallback pe `label_ro`; `photos` trimis
 *    ÎNTOTDEAUNA, altfel `PUT /profiles/me` șterge toate pozele).
 */
import axios from 'axios';

import { api } from '@/api/client';

import type {
  AnketaDraft,
  InterestOption,
  OptionItem,
  Reference,
} from '@mobile/features/anketa/types';
import type { MyProfile } from '@mobile/features/profile/profileApi';
import type { Language } from '@mobile/i18n/config';

export type { AnketaDraft, InterestOption, OptionItem, Reference };

/**
 * Profilul propriu, COMPLET: câmpurile editabile (din `MyProfile`, tipul mobil)
 * plus cele pe care doar serverul le calculează și pe care ecranul le afișează.
 */
export interface MyProfileFull extends MyProfile {
  /** Vârsta calculată de server din `birth_date`. */
  age: number;
  /** Anketa + pozele trec pragul minim ⇒ profilul e publicabil. */
  completed: boolean;
  /** Verificare facială reușită (TZ 2.2). */
  verified: boolean;
  /** Preferințele de căutare EFECTIVE (persistate în `UserSettings`). */
  interestedIn: string[];
  ageMin: number | null;
  ageMax: number | null;
}

/** Forma brută (snake_case) a lui `ProfileOut` din backend. */
interface ProfileResponse {
  name?: string;
  birth_date?: string;
  age?: number;
  gender?: string;
  height_cm?: number;
  city?: string;
  street?: string | null;
  nationality?: string | null;
  languages?: string[];
  about?: string | null;
  dating_statuses?: string[];
  interests?: string[];
  photos?: string[];
  completed?: boolean;
  verified?: boolean;
  interested_in?: string[];
  age_min?: number | null;
  age_max?: number | null;
}

function mapProfile(data: ProfileResponse): MyProfileFull {
  return {
    name: data.name ?? '',
    birthDate: data.birth_date ?? '',
    age: data.age ?? 0,
    gender: data.gender ?? '',
    heightCm: data.height_cm ?? 0,
    city: data.city ?? '',
    street: data.street ?? undefined,
    nationality: data.nationality ?? undefined,
    languages: data.languages ?? [],
    about: data.about ?? undefined,
    datingStatuses: data.dating_statuses ?? [],
    interests: data.interests ?? [],
    photos: data.photos ?? [],
    completed: data.completed ?? false,
    verified: data.verified ?? false,
    interestedIn: data.interested_in ?? [],
    ageMin: data.age_min ?? null,
    ageMax: data.age_max ?? null,
  };
}

/**
 * Profilul propriu, sau `null` dacă anketa nu a fost completată încă.
 *
 * `GET /profiles/me` răspunde 404 înainte de prima salvare. Nu e o eroare, ci o
 * stare normală a contului nou: ecranul trebuie să deschidă formularul gol, nu
 * să afișeze „a apărut o eroare". De aceea 404 devine `null`, iar orice alt cod
 * rămâne excepție (React Query o va arăta ca eroare, cu buton de reîncercare).
 */
export async function fetchMyProfile(): Promise<MyProfileFull | null> {
  try {
    const { data } = await api.get<ProfileResponse>('/profiles/me');
    return mapProfile(data);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

/**
 * Salvează anketa (`PUT /profiles/me`) și întoarce profilul rezultat.
 *
 * `photos` e OBLIGATORIU în payload: backend-ul REESCRIE lista de poze, deci
 * omiterea ei ar șterge tot ce a încărcat utilizatorul.
 *
 * Preferințele de căutare (`interested_in`, `age_min`, `age_max`) NU se trimit
 * de aici: pentru backend absența lor = „nu le atinge", iar ele se schimbă din
 * ecranul de Setări. Altfel o simplă editare de profil ar rescrie filtrele.
 */
export async function saveProfile(
  draft: AnketaDraft & { photos: string[] },
): Promise<MyProfileFull> {
  const { data } = await api.put<ProfileResponse>('/profiles/me', {
    name: draft.name,
    birth_date: draft.birthDate,
    gender: draft.gender,
    height_cm: draft.heightCm,
    city: draft.city,
    street: draft.street,
    nationality: draft.nationality,
    languages: draft.languages,
    about: draft.about,
    dating_statuses: draft.datingStatuses,
    interests: draft.interests,
    photos: draft.photos,
  });
  return mapProfile(data);
}

/* -------------------------- Catalogul de referință ------------------------ */

/**
 * Etichetele localizate ale unei opțiuni, așa cum le trimite backend-ul: toate
 * cele 4 limbi, iar clientul alege. Doar `label_ro` e garantat (limba de
 * fallback); restul pot lipsi la un server mai vechi.
 */
interface RawLabels {
  label_ro: string;
  label_ru?: string;
  label_uk?: string;
  label_en?: string;
}

interface RawReferenceItem extends RawLabels {
  value: string;
}

interface RawInterestItem extends RawLabels {
  slug: string;
}

interface ReferenceResponse {
  genders?: RawReferenceItem[];
  dating_statuses?: RawReferenceItem[];
  languages?: RawReferenceItem[];
  interests?: RawInterestItem[];
}

/** Eticheta în limba cerută; niciodată goală — cade pe română. */
function labelFor(item: RawLabels, language: Language): string {
  return item[`label_${language}`]?.trim() || item.label_ro;
}

/**
 * Genurile, statusurile, limbile și interesele — din backend, NICIODATĂ
 * hardcodate. `language` e parametru explicit fiindcă intră și în `queryKey`:
 * etichetele vin deja traduse de la server, deci un cache comun tuturor
 * limbilor ar servi la nesfârșit etichetele vechi după comutarea limbii.
 */
export async function fetchReference(language: Language): Promise<Reference> {
  const { data } = await api.get<ReferenceResponse>('/profiles/reference');
  const toOption = (item: RawReferenceItem): OptionItem => ({
    value: item.value,
    label: labelFor(item, language),
  });

  return {
    genders: (data.genders ?? []).map(toOption),
    datingStatuses: (data.dating_statuses ?? []).map(toOption),
    languages: (data.languages ?? []).map(toOption),
    interests: (data.interests ?? []).map(
      (i): InterestOption => ({ slug: i.slug, label: labelFor(i, language) }),
    ),
  };
}

/** Eticheta unei valori din catalog; dacă lipsește, arătăm valoarea brută. */
export function labelOf(options: readonly OptionItem[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Eticheta unui interes după slug; fallback pe slug. */
export function interestLabel(options: readonly InterestOption[], slug: string): string {
  return options.find((o) => o.slug === slug)?.label ?? slug;
}
