/** Unelte comune testelor de înregistrare: erori axios fabricate + randare cu router. */
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { renderWithProviders } from '@/test/harness';

const CONFIG = { headers: {} } as InternalAxiosRequestConfig;

/** O eroare HTTP cu răspuns, ca cele pe care le întoarce backendul. */
export function httpError(status: number, detail?: string): AxiosError {
  return new AxiosError('eroare', 'ERR_BAD_REQUEST', CONFIG, null, {
    data: detail ? { detail } : {},
    status,
    statusText: '',
    headers: {},
    config: CONFIG,
  });
}

/** O eroare fără răspuns: cererea nu a ajuns la server. */
export function networkError(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', CONFIG, {});
}

/** Randează un arbore care conține rute, într-un router de memorie. */
export function renderRouted(ui: ReactElement, initialEntries: string[] = ['/']) {
  return renderWithProviders(
    <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>,
  );
}

/** Catalogul brut întors de `GET /profiles/reference`. */
export const REFERENCE_RESPONSE = {
  genders: [
    { value: 'male', label_ru: 'Мужчина', label_ro: 'Bărbat', label_uk: 'Чоловік', label_en: 'Man' },
    { value: 'female', label_ru: 'Женщина', label_ro: 'Femeie', label_uk: 'Жінка', label_en: 'Woman' },
  ],
  dating_statuses: [
    {
      value: 'serious',
      label_ru: 'Серьёзные отношения',
      label_ro: 'Relație serioasă',
      label_uk: 'Серйозні стосунки',
      label_en: 'Serious relationship',
    },
  ],
  languages: [
    { value: 'ro', label_ru: 'Румынский', label_ro: 'Română', label_uk: 'Румунська', label_en: 'Romanian' },
    { value: 'ru', label_ru: 'Русский', label_ro: 'Rusă', label_uk: 'Російська', label_en: 'Russian' },
  ],
  interests: [
    { slug: 'sport', label_ru: 'Спорт', label_ro: 'Sport', label_uk: 'Спорт', label_en: 'Sports' },
    { slug: 'music', label_ru: 'Музыка', label_ro: 'Muzică', label_uk: 'Музика', label_en: 'Music' },
  ],
};
