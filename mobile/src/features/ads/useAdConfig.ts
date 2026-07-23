/**
 * Config-ul de reclame, citit o dată și ținut în cache (React Query).
 *
 * Se ia la montarea feed-ului și rareori se schimbă, deci `staleTime` mare: nu
 * mai lovim rețeaua la fiecare re-render al deck-ului. `enabled` implicit `false`
 * la eroare (vezi `select`), ca lipsa config-ului să NU declanșeze reclame.
 */
import { useQuery, UseQueryResult } from '@tanstack/react-query';

import { fetchAdConfig } from './adsApi';
import { AdConfig } from './types';

/** 5 minute: config-ul de reclame e practic static pe durata unei sesiuni. */
const AD_CONFIG_STALE_TIME = 5 * 60 * 1000;

export function useAdConfig(): UseQueryResult<AdConfig> {
  return useQuery<AdConfig>({
    queryKey: ['ads', 'config'],
    queryFn: fetchAdConfig,
    staleTime: AD_CONFIG_STALE_TIME,
  });
}
