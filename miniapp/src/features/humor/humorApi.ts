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
 *   GET  /humor/quiz    → list[HumorCard]
 *   POST /humor/submit  → HumorProfileOut   (body: {answers:[{card_id, funny}]})
 *   GET  /humor/me      → HumorProfileOut
 */
export { fetchHumor, fetchQuiz, submitQuiz } from '@mobile/features/humor/humorApi';

export type {
  HumorAnswer,
  HumorCard,
  HumorProfile,
} from '@mobile/features/humor/types';
