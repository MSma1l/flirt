/** Acces la API pentru anketă: referință (opțiuni) + trimiterea profilului. */
import { api } from '@/services/api';

import { AnketaDraft, InterestOption, Reference } from './types';

/** Forma brută (snake_case) a răspunsului de la backend pentru referință. */
interface ReferenceResponse {
  genders?: string[];
  dating_statuses?: string[];
  languages?: string[];
  interests?: InterestOption[];
}

/** Aduce opțiunile de anketă din backend și le mapează în camelCase. */
export async function fetchReference(): Promise<Reference> {
  const { data } = await api.get<ReferenceResponse>('/profiles/reference');
  return {
    genders: data.genders ?? [],
    datingStatuses: data.dating_statuses ?? [],
    languages: data.languages ?? [],
    interests: (data.interests ?? []).map((i) => ({ slug: i.slug, label: i.label })),
  };
}

/**
 * Trimite anketa completă către backend, mapând câmpurile în snake_case.
 *
 * `photos` se trimite ÎNTOTDEAUNA: `PUT /profiles/me` rescrie lista de poze a
 * profilului, deci omiterea ei ar șterge toate pozele deja încărcate.
 */
export async function submitAnketa(draft: AnketaDraft): Promise<void> {
  await api.put('/profiles/me', {
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
  });
}
