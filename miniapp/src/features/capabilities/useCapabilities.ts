/**
 * Capabilitățile serverului, pentru ecrane.
 *
 * O SINGURĂ cerere per sesiune de aplicație, oricâte ecrane ar întreba: cheia
 * de query e comună, deci React Query dedublează. `staleTime` generos fiindcă
 * răspunsul se schimbă doar la un deploy de backend, nu în timpul folosirii.
 *
 * CÂT TIMP NU ȘTIM, NU ARĂTĂM. `isPending` și `isError` dau amândouă o hartă
 * goală, iar harta goală înseamnă „nimic disponibil" (vezi `capabilitiesApi.ts`).
 * Consecința practică: ecranul care poate fi ascuns trebuie să trateze explicit
 * `isLoading`, altfel clipește (apare, apoi dispare). De aceea steagul de
 * încărcare e expus, nu înghițit.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  fetchCapabilities,
  isCapabilityEnabled,
  NO_CAPABILITIES,
  type CapabilityMap,
} from './capabilitiesApi';

/** Cheia de cache. Exportată ca testele și invalidarea să folosească aceeași. */
export const CAPABILITIES_KEY = ['capabilities'] as const;

/** Cinci minute: destul cât să nu re-cerem la fiecare navigare. */
const STALE_TIME_MS = 5 * 60 * 1000;

/**
 * O singură reîncercare, rapidă. O rețea mobilă care pierde o cerere e banală și
 * merită a doua șansă; o rută care lipsește (404, backend vechi) nu merită trei.
 */
const RETRY_COUNT = 1;
const RETRY_DELAY_MS = 400;

export interface CapabilitiesState {
  /** Harta brută, normalizată. Goală cât timp nu avem un răspuns bun. */
  capabilities: CapabilityMap;
  /** Funcția e disponibilă cu adevărat? Absența înseamnă NU. */
  isEnabled: (name: string) => boolean;
  /** Încă nu știm — nici da, nici nu. */
  isLoading: boolean;
  /** Ruta nu a răspuns. Harta rămâne goală, deci totul e ascuns. */
  isError: boolean;
  refetch: () => void;
}

export function useCapabilities(): CapabilitiesState {
  const query = useQuery({
    queryKey: CAPABILITIES_KEY,
    queryFn: fetchCapabilities,
    staleTime: STALE_TIME_MS,
    retry: RETRY_COUNT,
    retryDelay: RETRY_DELAY_MS,
    refetchOnWindowFocus: false,
  });

  const capabilities = query.data ?? NO_CAPABILITIES;

  const isEnabled = useCallback(
    (name: string) => isCapabilityEnabled(capabilities, name),
    [capabilities],
  );

  const { isPending, isError, refetch } = query;

  return useMemo(
    () => ({
      capabilities,
      isEnabled,
      isLoading: isPending,
      isError,
      refetch: () => void refetch(),
    }),
    [capabilities, isEnabled, isPending, isError, refetch],
  );
}

export interface CapabilityState {
  /** `true` doar când serverul a confirmat explicit funcția. */
  enabled: boolean;
  isLoading: boolean;
  isError: boolean;
}

/** Varianta pentru o singură funcție — forma pe care o folosesc ecranele. */
export function useCapability(name: string): CapabilityState {
  const { isEnabled, isLoading, isError } = useCapabilities();
  return { enabled: isEnabled(name), isLoading, isError };
}
