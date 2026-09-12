/**
 * Comutatorul `ai_enabled`, citit și salvat prin ruta de setări EXISTENTĂ.
 *
 * DE CE un modul propriu și nu `mobile/src/features/settings/settingsApi.ts`.
 * Mapperul reutilizat din aplicația nativă (`mapSettings`) NU cunoaște câmpul
 * `ai_enabled` — îl aruncă la citire și nu-l trimite la scriere. Fișierul acela
 * e sursă COMUNĂ cu aplicația Expo și nu are voie modificat de aici, deci
 * citim câmpul singuri, de pe aceeași rută (`GET`/`PUT /settings/`, confirmate
 * în `backend/app/api/v1/settings.py` și `backend/app/schemas/account.py`).
 *
 * PREȚUL, spus pe față: încă un `GET /settings/` pe lângă cel al ecranului de
 * Setări. Am ales asta în locul unei chei de cache comune, pentru că cele două
 * răspunsuri se mapează diferit, iar React Query cere ca aceeași cheie să
 * însemne aceeași formă de date. E o cerere ieftină pe o rută pe care oricum o
 * atingem, nu un apel în plus la furnizorul AI.
 *
 * IMPLICIT OPRIT. Backendul întoarce `ai_enabled: False` pe un cont nou
 * (`SettingsOut.ai_enabled = False`), iar `ai_enabled_for()` cere aprindere
 * EXPLICITĂ. Aici respectăm aceeași regulă: orice răspuns fără câmp, sau cu
 * altceva decât `true`, înseamnă OPRIT. Funcția trimite fragmente din
 * conversații către un serviciu extern — o presupunere greșită în direcția
 * „pornit" ar face exact ce utilizatorul n-a cerut.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';

/** Cheia de cache. Distinctă de `['settings']`, care ține forma mapată din Expo. */
export const AI_SETTINGS_KEY = ['settings', 'ai'] as const;

/** Partea din setări care ne interesează. */
export interface AiSettings {
  aiEnabled: boolean;
}

/** Forma brută (snake_case) a răspunsului de la `/settings/`. */
interface SettingsAiResponse {
  ai_enabled?: boolean;
}

/** Citește starea comutatorului. Absent sau ne-boolean = OPRIT. */
export async function fetchAiSettings(): Promise<AiSettings> {
  const { data } = await api.get<SettingsAiResponse>('/settings/');
  return { aiEnabled: data?.ai_enabled === true };
}

/**
 * Salvează starea comutatorului.
 *
 * Trimitem DOAR `ai_enabled`: `SettingsIn` e o actualizare parțială, iar
 * câmpurile netrimise rămân neatinse pe server (`None` = „nu-l atinge", nu
 * „stinge-l"). Un payload complet ar risca să rescrie preferințe pe care
 * ecranul de Setări tocmai le-a schimbat.
 */
export async function updateAiEnabled(enabled: boolean): Promise<AiSettings> {
  const { data } = await api.put<SettingsAiResponse>('/settings/', { ai_enabled: enabled });
  return { aiEnabled: data?.ai_enabled === true };
}

/**
 * Starea comutatorului pentru orice ecran care are nevoie de ea.
 *
 * `enabled` e `false` cât timp nu știm — deci butonul de sugestie NU apare în
 * timpul încărcării și nicio cerere nu pleacă spre AI până nu avem confirmarea
 * serverului.
 */
export function useAiEnabled() {
  const query = useQuery<AiSettings>({ queryKey: AI_SETTINGS_KEY, queryFn: fetchAiSettings });
  return {
    enabled: query.data?.aiEnabled === true,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** Mutația de aprindere/stingere, cu resincronizare după răspuns. */
export function useSetAiEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => updateAiEnabled(enabled),
    onSuccess: (result) => {
      // Scriem valoarea CONFIRMATĂ de server, nu pe cea cerută: comutatorul
      // arată ce e salvat, nu ce am vrut noi să salvăm.
      queryClient.setQueryData(AI_SETTINGS_KEY, result);
      // Ecranul de Setări ține aceeași rută sub altă cheie; îl lăsăm să se
      // reîmprospăteze, ca restul setărilor să nu rămână pe un răspuns vechi.
      void queryClient.invalidateQueries({ queryKey: ['settings'], exact: true });
    },
    // Eșecul nu lasă comutatorul într-o stare inventată: recitim de pe server.
    onError: () => void queryClient.invalidateQueries({ queryKey: AI_SETTINGS_KEY }),
  });
}
