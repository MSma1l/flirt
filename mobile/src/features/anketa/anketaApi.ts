/** Acces la API pentru anketă: referință (opțiuni) + trimiterea profilului. */
import { api } from '@/services/api';

import { AnketaDraft, OptionItem, Reference } from './types';

/**
 * Forma BRUTĂ a răspunsului backend-ului. Fiecare opțiune vine cu valoarea +
 * ambele etichete localizate (`{value, label_ru, label_ro}`); NU e un string.
 * Tratarea lor ca string-uri și randarea directă a obiectului era cauza
 * crash-ului „Objects are not valid as a React child".
 */
interface RawReferenceItem {
  value: string;
  label_ru: string;
  label_ro: string;
}
interface RawInterestItem {
  slug: string;
  label_ru: string;
  label_ro: string;
}
interface ReferenceResponse {
  genders?: RawReferenceItem[];
  dating_statuses?: RawReferenceItem[];
  languages?: RawReferenceItem[];
  interests?: RawInterestItem[];
}

/** UI-ul aplicației e în română → afișăm eticheta `label_ro`. */
function toOption(item: RawReferenceItem): OptionItem {
  return { value: item.value, label: item.label_ro };
}

/** Aduce opțiunile de anketă din backend și le normalizează în `{value,label}`. */
export async function fetchReference(): Promise<Reference> {
  const { data } = await api.get<ReferenceResponse>('/profiles/reference');
  return {
    genders: (data.genders ?? []).map(toOption),
    datingStatuses: (data.dating_statuses ?? []).map(toOption),
    languages: (data.languages ?? []).map(toOption),
    interests: (data.interests ?? []).map((i) => ({ slug: i.slug, label: i.label_ro })),
  };
}

/**
 * Trimite anketa completă către backend, mapând câmpurile în snake_case.
 *
 * `photos` se trimite ÎNTOTDEAUNA: `PUT /profiles/me` rescrie lista de poze a
 * profilului, deci omiterea ei ar șterge toate pozele deja încărcate.
 *
 * Preferințele de căutare (`interested_in`, `age_min`, `age_max`) se trimit DOAR
 * dacă draftul le are: pentru backend `null`/absent = „nu le atinge". Ecranul de
 * editare a profilului nu le culege, deci omiterea lor păstrează ce a ales
 * utilizatorul în wizard sau în Setări.
 */
export async function submitAnketa(draft: AnketaDraft): Promise<void> {
  const payload: Record<string, unknown> = {
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
    photos: draft.photos ?? [],
  };

  if (draft.interestedIn !== undefined) payload.interested_in = draft.interestedIn;
  if (draft.ageMin !== undefined) payload.age_min = draft.ageMin;
  if (draft.ageMax !== undefined) payload.age_max = draft.ageMax;

  await api.put('/profiles/me', payload);
}
