/**
 * Poarta de intrare: cine e utilizatorul curent și are profilul completat?
 *
 * `GET /auth/me` întoarce `UserOut` (`backend/app/schemas/auth.py`):
 *   { id: UUID, email: str, profile_completed: bool }
 *
 * `profile_completed` e SINGURUL semnal după care decidem înregistrare vs.
 * aplicație. Îl recalculează backendul, în `profile_service._sync_profile_completed`:
 * anketa salvată ȘI cel puțin `settings.min_photos` poze. De aceea nu-l deducem
 * niciodată pe client din câmpurile completate — l-am contrazice pe server.
 *
 * DE CE React Query și nu `authStore`: după ce utilizatorul termină
 * înregistrarea, flagul trebuie RECITIT. `authStore.signIn()` nu poate fi
 * rechemat pentru asta — ar retrimite `initData`, iar backendul are protecție
 * anti-replay și l-ar refuza (vezi comentariul din `api/client.ts`). O cerere
 * separată spre `/auth/me` e singura reîmprospătare corectă.
 */
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import { api } from '@/api/client';
import { useAuthStore } from '@/auth/authStore';

export interface CurrentUser {
  id: string;
  email: string;
  profile_completed: boolean;
}

export const CURRENT_USER_KEY = ['auth', 'me'] as const;

async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await api.get<CurrentUser>('/auth/me');
  return data;
}

export function useCurrentUser(): UseQueryResult<CurrentUser> {
  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: fetchCurrentUser,
    // Autentificarea tocmai a citit `/auth/me`; refolosim rezultatul ca să nu
    // facem a doua cerere identică la fiecare pornire. `staleTime: Infinity` +
    // reîmprospătare EXPLICITĂ după înregistrare — nimic nu se schimbă între.
    initialData: () => useAuthStore.getState().user ?? undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/**
 * Recitește `profile_completed` de la server.
 * De chemat după ultimul pas al înregistrării: dacă backendul confirmă, poarta
 * se deschide singură și utilizatorul ajunge în feed.
 */
export function useRefreshCurrentUser(): () => Promise<CurrentUser | undefined> {
  const client = useQueryClient();
  return useCallback(async () => {
    const fresh = await client.fetchQuery({
      queryKey: CURRENT_USER_KEY,
      queryFn: fetchCurrentUser,
      staleTime: 0,
    });
    return fresh;
  }, [client]);
}
