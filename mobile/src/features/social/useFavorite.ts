/**
 * Marcarea unui utilizator ca favorit (★) din orice ecran (card de profil).
 *
 * Centralizează apelul la backend, starea „e deja favorit?" și invalidarea
 * cache-ului React Query, ca ecranul de favorite să se resincronizeze imediat.
 *
 * Starea de favorit se citește din ACELAȘI cache `['favorites']` pe care îl
 * folosește ecranul de favorite: o singură sursă de adevăr, fără un endpoint
 * suplimentar „is favorite" per card.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { addFavorite, fetchFavorites } from '@/features/social/socialApi';
import { alertMessage } from '@/utils/dialog';

interface FavoriteApi {
  /** Utilizatorul e deja în lista de favorite. */
  isFavorite: boolean;
  /** Adaugă la favorite (no-op dacă e deja acolo sau dacă cererea e în curs). */
  markFavorite: () => void;
  /** Adăugarea e în curs (pentru starea butonului). */
  isAdding: boolean;
}

export function useFavorite(targetUserId: string): FavoriteApi {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['favorites'],
    queryFn: fetchFavorites,
  });

  const isFavorite = (data ?? []).some((f) => f.targetUserId === targetUserId);

  const mutation = useMutation({
    mutationFn: (userId: string) => addFavorite(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
    onError: () => {
      alertMessage('Ceva n-a mers', 'Nu am putut adăuga la favorite. Reîncearcă.');
    },
  });

  const { mutate, isPending } = mutation;

  const markFavorite = useCallback(() => {
    // Fără id, dacă e deja favorit sau dacă o cerere e în zbor: nu trimitem
    // nimic (userul ar da de două ori pe ★ fără să vadă vreo diferență).
    if (!targetUserId || isFavorite || isPending) return;
    mutate(targetUserId);
  }, [targetUserId, isFavorite, isPending, mutate]);

  return { isFavorite, markFavorite, isAdding: isPending };
}
