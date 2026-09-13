/**
 * Interogările React Query ale programului de fidelitate.
 *
 * Cheile stau AICI, nu împrăștiate prin ecrane: după folosirea unui cod de
 * invitație trebuie invalidate toate trei (starea, cotațiile de preț și
 * ștampilele), iar o cheie scrisă cu mâna în două locuri se desincronizează
 * exact în ziua în care contează.
 */
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  fetchLoyaltyStatus,
  fetchTicketQuote,
  type LoyaltyStatus,
  type TicketQuote,
} from './loyaltyApi';

/** Starea mea de fidelitate. */
export const LOYALTY_STATUS_KEY = ['loyalty'] as const;

/** Cotația de preț a unui eveniment. */
export function ticketQuoteKey(eventId: string): readonly unknown[] {
  return ['ticket-quote', eventId];
}

export function useLoyaltyStatus(): UseQueryResult<LoyaltyStatus> {
  return useQuery<LoyaltyStatus>({
    queryKey: LOYALTY_STATUS_KEY,
    queryFn: fetchLoyaltyStatus,
  });
}

/**
 * Cotația pentru un eveniment cu bilet online.
 *
 * `enabled` oprește cererea când nu avem id sau când evenimentul nu vinde
 * bilete: ruta ar răspunde 400, iar un 400 previzibil nu e o informație, e
 * doar o cerere în plus și o eroare în consolă.
 */
export function useTicketQuote(
  eventId: string,
  hasTicket: boolean,
): UseQueryResult<TicketQuote> {
  return useQuery<TicketQuote>({
    queryKey: ticketQuoteKey(eventId),
    queryFn: () => fetchTicketQuote(eventId),
    enabled: eventId !== '' && hasTicket,
    // Prețul e o promisiune de bani: nu-l reîncercăm la nesfârșit, dar nici nu-l
    // lăsăm învechit după ce omul se întoarce pe ecran.
    staleTime: 30_000,
  });
}

/**
 * Reîmprospătează tot ce depinde de ștampile și de invitații.
 * Apelat după folosirea unui cod (prețul altui eveniment tocmai s-a schimbat)
 * și după un check-in reușit.
 */
export function useRefreshLoyalty(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LOYALTY_STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ['ticket-quote'] });
    void queryClient.invalidateQueries({ queryKey: ['passport'] });
  }, [queryClient]);
}
