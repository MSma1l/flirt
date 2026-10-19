/**
 * Testul de umor din panou (`/api/v1/admin/humor/*`), tipizat.
 *
 * Fișier separat de `admin.ts` ca modulul să fie autonom (aceeași idee ca pe
 * backend: un modul nou nu modifică fișierele partajate).
 */
import { apiFetch, apiVoid } from './client';
import type { IsoDateTime, Uuid } from './types';

/** Starea globală a testului + textul ecranului de introducere. */
export interface HumorSettings {
  enabled: boolean;
  intro_ro: string;
  intro_ru: string;
  intro_en: string;
  /** Câte glume active are testul acum. */
  active_questions: number;
  /** Sub acest număr testul nu poate fi pornit (409 de la server). */
  min_active_questions: number;
  /** Cele 7 tipuri de umor pe care le poate măsura o glumă. */
  humor_types: string[];
  updated_at: IsoDateTime | null;
}

export interface HumorSettingsInput {
  enabled: boolean;
  intro_ro: string;
  intro_ru: string;
  intro_en: string;
}

export interface HumorQuestion {
  id: Uuid;
  /** Id-ul public al cardului (trimis de aplicație în răspunsuri). */
  key: string;
  humor_type: string;
  text_ro: string;
  text_ru: string;
  text_en: string;
  position: number;
  active: boolean;
  updated_at: IsoDateTime | null;
}

export interface HumorQuestionInput {
  humor_type: string;
  text_ro: string;
  text_ru: string;
  text_en: string;
  active: boolean;
}

/** Plafoanele validate și pe server (`schemas/humor.py`). */
export const HUMOR_TEXT_MAX = 500;
export const HUMOR_INTRO_MAX = 2000;

export function fetchHumorSettings(): Promise<HumorSettings> {
  return apiFetch<HumorSettings>('/admin/humor/settings');
}

export function updateHumorSettings(body: HumorSettingsInput): Promise<HumorSettings> {
  return apiFetch<HumorSettings>('/admin/humor/settings', { method: 'PUT', body: { ...body } });
}

export function fetchHumorQuestions(): Promise<HumorQuestion[]> {
  return apiFetch<HumorQuestion[]>('/admin/humor/questions');
}

export function createHumorQuestion(input: HumorQuestionInput): Promise<HumorQuestion> {
  return apiFetch<HumorQuestion>('/admin/humor/questions', {
    method: 'POST',
    body: { ...input },
  });
}

export function updateHumorQuestion(
  id: Uuid,
  input: Partial<HumorQuestionInput>,
): Promise<HumorQuestion> {
  return apiFetch<HumorQuestion>(`/admin/humor/questions/${id}`, {
    method: 'PATCH',
    body: { ...input },
  });
}

export function deleteHumorQuestion(id: Uuid): Promise<void> {
  return apiVoid(`/admin/humor/questions/${id}`, { method: 'DELETE' });
}

/** Rescrie ordinea: id-urile TUTUROR glumelor, fiecare o dată. */
export function reorderHumorQuestions(ids: Uuid[]): Promise<HumorQuestion[]> {
  return apiFetch<HumorQuestion[]>('/admin/humor/questions/order', {
    method: 'PUT',
    body: { ids },
  });
}
