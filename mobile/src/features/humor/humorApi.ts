/** Acces la API pentru Testul de umor (TZ secț. 2.7). */
import { api } from '@/services/api';

import { HumorAnswer, HumorCard, HumorProfile } from './types';

/** Forma brută (snake_case) a unui răspuns trimis către backend. */
interface HumorAnswerPayload {
  card_id: string;
  funny: boolean;
}

/** Aduce cardurile de glume pentru test. */
export async function fetchQuiz(): Promise<HumorCard[]> {
  const { data } = await api.get<HumorCard[]>('/humor/quiz');
  return data ?? [];
}

/** Trimite răspunsurile (camel→snake: card_id) și întoarce profilul de umor. */
export async function submitQuiz(answers: HumorAnswer[]): Promise<HumorProfile> {
  const payload: HumorAnswerPayload[] = answers.map((a) => ({
    card_id: a.cardId,
    funny: a.funny,
  }));
  const { data } = await api.post<HumorProfile>('/humor/submit', { answers: payload });
  return data;
}

/** Aduce profilul de umor salvat al utilizatorului curent. */
export async function fetchHumor(): Promise<HumorProfile> {
  const { data } = await api.get<HumorProfile>('/humor/me');
  return data;
}
