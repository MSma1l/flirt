/**
 * Ce spune SERVERUL că îi lipsește userului — și cum ajunge asta la poartă.
 *
 * `POST /feed/swipe` răspunde 403 cu texte DISTINCTE tocmai ca aplicația să poată
 * duce omul în locul potrivit (vezi comentariile din `feed_service._authorize_swipe`).
 * Până acum clientul nu citea `detail` deloc și afișa „Nu am putut trimite.
 * Încearcă din nou." — un mesaj de rețea pentru o problemă care nu se rezolvă
 * niciodată prin reîncercare. Omul rămânea blocat în feed.
 *
 * Aici NU se decide navigarea: raportăm doar FAPTUL constatat de server, în
 * starea pe care o citește oricum `appRoute` (cache-ul porții de umor, flagul de
 * pe `/auth/me`, lipsa pozelor). Unde duce fiecare fapt rămâne treaba lui
 * `resolveAppRoute`.
 */
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useCallback } from 'react';
import { create } from 'zustand';

import { humorMeQueryKey } from '@/features/humor/humorGate';
import { useAuthStore } from '@/store/authStore';

/**
 * Textele backendului, cuvânt cu cuvânt (`backend/app/services/feed_service.py`).
 *
 * Sunt CONTRACT, nu mesaje de afișat: userul vede traducerile din catalogul
 * `feed`, în limba lui. Dacă serverul își schimbă textele, `classifySwipeRefusal`
 * nu mai recunoaște nimic și cădem pe eroarea generică — supărător, dar nu
 * periculos: nimeni nu e trimis undeva greșit.
 */
export const ANKETA_REQUIRED_DETAIL = 'Profilul tău nu este complet.';
export const PHOTOS_REQUIRED_DETAIL = 'Profilul tău nu are destule poze.';
export const HUMOR_REQUIRED_DETAIL = 'Completează testul de umor.';

/** Ce poartă a reclamat serverul — un text, o poartă, fără ghicit. */
export type GateBlock = 'anketa' | 'photos' | 'humor';

/** Textul `detail` dintr-un 403, dacă răspunsul chiar e un 403 cu text. */
function refusalDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  if (error.response?.status !== 403) return null;
  const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
  return typeof detail === 'string' ? detail : null;
}

/**
 * Ce poartă a refuzat swipe-ul, sau `null` pentru orice altceva (rețea, 500,
 * self-swipe, gate-ul 18+) — acolo mesajul generic e răspunsul corect.
 */
export function classifySwipeRefusal(error: unknown): GateBlock | null {
  const detail = refusalDetail(error);
  if (detail === HUMOR_REQUIRED_DETAIL) return 'humor';
  if (detail === PHOTOS_REQUIRED_DETAIL) return 'photos';
  if (detail === ANKETA_REQUIRED_DETAIL) return 'anketa';
  return null;
}

/**
 * Lipsa pozelor e singurul refuz care n-are deja un loc în starea aplicației.
 *
 * `GET /auth/me` întoarce `profile_completed`, care pe server e ȘI-ul dintre
 * „anketă completă" și „destule poze" (`profile_service._sync_profile_completed`).
 * Deci `false` nu spune CARE dintre ele lipsește — iar cele două duc în ecrane
 * diferite. Flagul de aici e exact bucata de informație care lipsește: serverul
 * a spus „pozele", deci nu-l mai trimitem în wizardul de anketă.
 *
 * Nu e o comandă de navigare, ci o precizare: se aplică doar cât timp
 * `profile_completed` e `false`. Când userul adaugă pozele, flagul de pe server
 * se aprinde și precizarea nu mai are ce lămuri — de asta nu trebuie stinsă de
 * nimeni și nu poate ține pe nimeni blocat.
 *
 * Legat de `userId`, ca alt cont pe același telefon să nu moștenească blocajul.
 */
interface ServerGateState {
  needsPhotosForUserId: string | null;
  requirePhotos: (userId: string) => void;
  clear: () => void;
}

export const useServerGateStore = create<ServerGateState>((set) => ({
  needsPhotosForUserId: null,
  requirePhotos: (userId) => set({ needsPhotosForUserId: userId }),
  // Întoarcem starea NESCHIMBATĂ când nu e nimic de curățat, ca un `clear()`
  // degeaba (logout, teste) să nu declanșeze un re-render.
  clear: () =>
    set((s) => (s.needsPhotosForUserId === null ? s : { needsPhotosForUserId: null })),
}));

/**
 * Duce refuzul serverului în starea aplicației și spune ce lipsește, ca ecranul
 * să afișeze mesajul potrivit. Navigarea urmează SINGURĂ, prin `AuthGuard`.
 */
export function useReportSwipeRefusal(): (error: unknown) => Promise<GateBlock | null> {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const requirePhotos = useServerGateStore((s) => s.requirePhotos);

  return useCallback(
    async (error: unknown): Promise<GateBlock | null> => {
      const block = classifySwipeRefusal(error);
      if (block === null) return null;

      if (block === 'humor') {
        // 403-ul ESTE răspunsul serverului la întrebarea porții („are vector de
        // umor?"), doar pus altfel. Îl scriem în cache-ul ei: de acolo încolo
        // poarta decide singură, fără să mai fie nevoie de vreun flag paralel.
        queryClient.setQueryData(humorMeQueryKey(userId), { vector: {} });
        return 'humor';
      }

      // Anketă sau poze: în ambele cazuri serverul tocmai a spus că profilul nu
      // e complet, deci starea noastră locală e învechită — o recitim de acolo.
      // Pentru poze adăugăm și precizarea, fiindcă `profile_completed` singur nu
      // spune care dintre cele două lipsește.
      if (block === 'photos' && userId) requirePhotos(userId);
      await refreshUser();
      return block;
    },
    [queryClient, userId, refreshUser, requirePhotos],
  );
}
