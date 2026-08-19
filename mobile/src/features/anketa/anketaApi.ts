/** Acces la API pentru anketă: referință (opțiuni) + trimiterea profilului. */
import { type Language } from '@/i18n/config';
import { api } from '@/services/api';

import { AnketaDraft, OptionItem, Reference } from './types';

/**
 * Etichetele localizate ale unei opțiuni, așa cum le trimite backend-ul.
 *
 * Serverul trimite TOATE variantele (`label_ro/ru/uk/en`) și clientul alege —
 * același tipar ca `text_ro/ru/uk/en` la cardurile de umor. `label_uk` rămâne
 * declarat pentru că serverul încă îl trimite, deși interfața nu mai are
 * ucraineana; pur și simplu nu e citit niciodată.
 *
 * Doar `label_ro` e obligatoriu: e limba de fallback, singura garantat completă.
 * Restul sunt opționale, ca un client publicat să nu crape în fața unui server
 * mai vechi care nu le trimitea încă.
 */
interface RawLabels {
  label_ro: string;
  label_ru?: string;
  label_uk?: string;
  label_en?: string;
}

/**
 * Forma BRUTĂ a răspunsului backend-ului. Fiecare opțiune vine cu valoarea +
 * etichetele localizate (`{value, label_ro, label_ru, …}`); NU e un string.
 * Tratarea lor ca string-uri și randarea directă a obiectului era cauza
 * crash-ului „Objects are not valid as a React child".
 */
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

/**
 * Eticheta în limba cerută, cu fallback pe română.
 *
 * Regula de aur, aceeași ca la umor: NICIODATĂ text gol pe ecran. O etichetă
 * lipsă sau formată doar din spații (traducere neintrodusă încă pe server) cade
 * pe `label_ro`, nu lasă un chip fără nume.
 */
function labelFor(item: RawLabels, language: Language): string {
  return item[`label_${language}`]?.trim() || item.label_ro;
}

/**
 * Aduce opțiunile de anketă din backend și le normalizează în `{value,label}`,
 * cu eticheta DEJA în limba activă.
 *
 * `language` e parametru explicit, nu citit din instanța globală i18n: apelanții
 * sunt hook-uri React Query, iar limba trebuie să intre și în `queryKey` — altfel
 * comutarea limbii ar servi la nesfârșit etichetele din cache, în limba veche.
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
    interests: (data.interests ?? []).map((i) => ({
      slug: i.slug,
      label: labelFor(i, language),
    })),
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
