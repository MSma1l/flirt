/**
 * Poarta testului de umor: decide dacă userul trebuie dus la quiz.
 *
 * DE CE există: `Profile.humor_vector` intră REAL în scorul de compatibilitate
 * (`backend/app/services/compatibility.py`). Un user fără vector de umor primește
 * potriviri slabe și strică potrivirile celorlalți — de asta quiz-ul e obligatoriu,
 * nu sugerat: după anketă și la orice login cu date lipsă, userul ajunge la el.
 *
 * REGULA CARE ÎMPIEDICĂ ZIDUL: obligatoriu când serverul răspunde, permisiv când
 * serverul tace. Poarta se închide DOAR pe un răspuns reușit care spune negru pe
 * alb „vectorul e gol". Eroare de rețea, 500, 404 (anketa nu există pe server),
 * timeout → poarta rămâne deschisă și userul intră în aplicație. Datele lipsă
 * sunt o pierdere; un user închis afară din aplicație e mult mai rău.
 */
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { useAuthStore } from '@/store/authStore';

import { fetchHumor } from './humorApi';
import { HumorProfile } from './types';

/** Cheia de cache pentru `GET /humor/me` — partajată cu ecranul de quiz. */
export const HUMOR_ME_QUERY_KEY = ['humor-me'] as const;

/**
 * Are userul date de umor?
 *
 * `GET /humor/me` întoarce `{ "vector": {} }` pentru cine n-a dat niciodată
 * quiz-ul (`humor_service.get_humor` normalizează orice altceva la `{}`), și un
 * vector cu cele 7 tipuri după trimitere — chiar dacă userul a răspuns „nu prea"
 * la tot (atunci backendul pune distribuție uniformă, tot non-goală). Deci
 * „obiect gol" e semnalul sigur de „quiz nedat”.
 */
export function hasHumorData(profile: HumorProfile | undefined | null): boolean {
  const vector = profile?.vector;
  if (!vector || typeof vector !== 'object') return false;
  return Object.keys(vector).length > 0;
}

/**
 * Supapa pentru cazul „quiz-ul obligatoriu nu se poate face".
 *
 * Dacă `GET /humor/quiz` cade sau întoarce zero carduri, userul ar rămâne prins
 * pe ecranul de quiz: poarta îl trimite acolo, iar acolo n-are ce răspunde.
 * Ecranul marchează atunci testul „indisponibil" pentru sesiunea curentă, poarta
 * se deschide și userul intră în aplicație. NU e un „sari peste" pentru user —
 * nu există buton de renunțare, iar starea NU se persistă: la următoarea pornire
 * a aplicației i se cere din nou quiz-ul.
 *
 * Marcajul e legat de `userId`, nu global: un logout + login cu alt cont pe
 * același telefon nu moștenește supapa celuilalt.
 */
interface HumorGateState {
  /** Userul pentru care quiz-ul s-a dovedit indisponibil în sesiunea asta. */
  unavailableForUserId: string | null;
  markUnavailable: (userId: string) => void;
  reset: () => void;
}

export const useHumorGateStore = create<HumorGateState>((set) => ({
  unavailableForUserId: null,
  markUnavailable: (userId) => set({ unavailableForUserId: userId }),
  reset: () => set({ unavailableForUserId: null }),
}));

export interface HumorGate {
  /** Userul trebuie dus la quiz ACUM (server a confirmat că datele lipsesc). */
  needsQuiz: boolean;
}

/**
 * Hook folosit de `AuthGuard`: spune dacă userul curent trebuie dus la quiz.
 *
 * Interogarea pornește doar pentru un user autentificat cu anketa completă —
 * altfel `GET /humor/me` ar da oricum 404 („Anketa nu există încă”), iar userul
 * are treabă în onboarding, nu la quiz.
 */
export function useHumorGate(): HumorGate {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const profileCompleted = useAuthStore((s) => s.user?.profile_completed);
  const unavailableForUserId = useHumorGateStore((s) => s.unavailableForUserId);

  const unavailable = !!userId && unavailableForUserId === userId;
  const enabled = status === 'authenticated' && !!profileCompleted && !unavailable;

  const { data, isSuccess } = useQuery({
    queryKey: HUMOR_ME_QUERY_KEY,
    queryFn: fetchHumor,
    enabled,
    // Fără reîncercări în lanț: la eroare vrem verdict rapid „nu știm” →
    // poarta rămâne deschisă, nu ținem userul în așteptare între ecrane.
    retry: false,
    staleTime: Infinity,
  });

  // `isSuccess` e cheia: la eroare rămâne `false` → `needsQuiz` false → trecere
  // liberă. Poarta se închide doar pe un „vector gol” confirmat de server.
  return { needsQuiz: enabled && isSuccess && !hasHumorData(data) };
}
