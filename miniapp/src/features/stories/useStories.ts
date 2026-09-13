/**
 * Interogările React Query ale modulului Stories, într-un singur loc.
 *
 * DE CE: aceleași date sunt cerute acum din trei componente (bara din capul
 * feedului, ecranul separat, vizualizatorul care are nevoie să știe ce poveste e
 * a utilizatorului). Cu aceleași CHEI, React Query face o singură cerere și
 * păstrează un singur cache — dar cheile trebuie scrise identic, iar o cheie
 * scrisă de mână în trei fișiere se desincronizează la prima redenumire.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { fetchMyStories, fetchStories } from './storiesApi';

/** Cheile de cache. Invalidarea se face tot prin ele (vezi `StoryComposer`). */
export const STORIES_QUERY_KEY = ['stories'] as const;
export const MY_STORIES_QUERY_KEY = ['my-stories'] as const;

/**
 * Cât timp datele rămân „proaspete". Nu e un detaliu de performanță: bara se
 * DEMONTEAZĂ cât timp e deschisă o poveste peste tot ecranul, iar la revenire
 * un `staleTime` de 0 ar porni o cerere nouă la fiecare închidere — adică o
 * cerere la fiecare poveste privită. Poveștile trăiesc 24h; 30 de secunde de
 * răcoare nu pierd nimic. Publicarea și ștergerea invalidează explicit, deci
 * modificările proprii se văd imediat.
 */
const STALE_TIME_MS = 30_000;

/** Poveștile active (proprii + ale match-urilor), grupate pe utilizator. */
export function useStoriesQuery(): UseQueryResult<UserStories[]> {
  return useQuery<UserStories[]>({
    queryKey: STORIES_QUERY_KEY,
    queryFn: fetchStories,
    staleTime: STALE_TIME_MS,
  });
}

/**
 * Id-urile poveștilor PROPRII — ele decid dacă vizualizatorul arată „șterge" sau
 * bara de răspuns. Întrebăm serverul (`/stories/mine`), nu store-ul de
 * autentificare: serverul e cel care refuză cu 403 ștergerea poveștii altcuiva,
 * deci butonul apare fix acolo unde acțiunea chiar reușește.
 */
export function useMyStoryIds(): ReadonlySet<string> {
  const query = useQuery<Story[]>({
    queryKey: MY_STORIES_QUERY_KEY,
    queryFn: fetchMyStories,
    staleTime: STALE_TIME_MS,
  });
  return useMemo(() => new Set((query.data ?? []).map((s) => s.id)), [query.data]);
}
