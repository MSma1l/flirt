/**
 * Acces la API pentru Testul de umor, în Mini App.
 *
 * REUTILIZAT din aplicația Expo, fără copiere
 * (`mobile/src/features/humor/humorApi.ts`, prin alias-ul `@mobile/`). Fișierul
 * de acolo importă `@/services/api`, care în Mini App e mapat pe clientul axios
 * de aici (vezi `vite.config.ts` / `tsconfig.json`), deci modulul Expo primește
 * automat instanța web — nu e nevoie de nicio adaptare.
 *
 * DE CE există totuși acest fișier, dacă nu adaugă nimic: el e granița pe care o
 * mochează testele ecranului. Un `vi.mock('@mobile/...')` ar lega testele de
 * structura aplicației native; mocând modulul LOCAL, ecranul rămâne testat
 * pentru deciziile lui, nu pentru axios.
 *
 * Rutele confirmate în `backend/app/api/v1/humor.py`:
 *   GET  /humor/config  → HumorConfig       (doar Mini App, vezi mai jos)
 *   GET  /humor/quiz    → list[HumorCard]
 *   POST /humor/submit  → HumorProfileOut   (body: {answers:[{card_id, funny}]})
 *   GET  /humor/me      → HumorProfileOut
 */
import { api } from '@/api/client';

export { fetchHumor, fetchQuiz, submitQuiz } from '@mobile/features/humor/humorApi';

export type {
  HumorAnswer,
  HumorCard,
  HumorProfile,
} from '@mobile/features/humor/types';

/**
 * Starea testului, comutată din panoul de admin (`GET /humor/config`).
 *
 * PROPRIE Mini App-ului (aplicația nativă nu o folosește): `enabled=false`
 * înseamnă că nimeni nu e obligat să dea testul, deci intrările spre el se
 * ascund. `intro_<limbă>` e textul ecranului de introducere, editabil din panou;
 * gol = textul implicit din catalogul `screens`.
 */
export interface HumorConfig {
  enabled: boolean;
  intro_ro: string;
  intro_ru: string;
  intro_en: string;
  question_count: number;
}

export async function fetchHumorConfig(): Promise<HumorConfig> {
  const { data } = await api.get<HumorConfig>('/humor/config');
  return data;
}

/** Cheia de cache a stării testului (citită de ecran și de meniul „Mai multe"). */
export const HUMOR_CONFIG_QUERY_KEY = ['humor-config'] as const;
