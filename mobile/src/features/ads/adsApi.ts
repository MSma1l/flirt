/**
 * Acces la API pentru reclamele interstițiale (TZ: reclamă la fiecare N swipe-uri).
 *
 *   GET /ads/config -> config-ul (enabled, prag de swipe, limită de secunde)
 *   GET /ads/next   -> următoarea reclamă SAU 204 No Content (nicio reclamă)
 *
 * Valorile lipsă / invalide din config cad pe implicitele din TZ (15 swipe-uri,
 * 10 secunde), ca feed-ul să funcționeze chiar dacă backend-ul trimite parțial.
 */
import { api } from '@/services/api';

import { Ad, AdConfig } from './types';

/** Implicitele din TZ, folosite când backend-ul trimite valori absente/invalide. */
const DEFAULT_SWIPES_BEFORE_AD = 15;
const DEFAULT_MAX_VIDEO_SECONDS = 10;

interface AdConfigResponse {
  enabled?: boolean;
  swipes_before_ad?: number;
  max_video_seconds?: number;
}

interface AdResponse {
  id: number;
  title: string;
  video_url?: string | null;
  image_url?: string | null;
  duration_seconds: number;
}

/** Aduce config-ul de reclame; normalizează pragurile la valori pozitive. */
export async function fetchAdConfig(): Promise<AdConfig> {
  const { data } = await api.get<AdConfigResponse>('/ads/config');
  const swipes = data?.swipes_before_ad;
  const maxSeconds = data?.max_video_seconds;
  return {
    enabled: !!data?.enabled,
    swipesBeforeAd:
      typeof swipes === 'number' && swipes > 0 ? swipes : DEFAULT_SWIPES_BEFORE_AD,
    maxVideoSeconds:
      typeof maxSeconds === 'number' && maxSeconds > 0
        ? maxSeconds
        : DEFAULT_MAX_VIDEO_SECONDS,
  };
}

/**
 * Aduce următoarea reclamă. Un 204 (fără reclamă / dezactivat) => `null`, iar
 * feed-ul continuă fără să arate nimic. Mapează snake_case → camelCase.
 */
export async function fetchNextAd(): Promise<Ad | null> {
  const res = await api.get<AdResponse | '' | null>('/ads/next');
  // 204 No Content: axios întoarce status 204 și body gol/`null`.
  if (res.status === 204 || !res.data) return null;
  const data = res.data as AdResponse;
  return {
    id: data.id,
    title: data.title,
    videoUrl: data.video_url ?? null,
    imageUrl: data.image_url ?? null,
    durationSeconds: data.duration_seconds,
  };
}

/**
 * Raportează o AFIȘARE de reclamă (`POST /ads/{id}/impression` → 204).
 *
 * Best-effort: telemetria nu trebuie NICIODATĂ să blocheze sau să strice UI-ul,
 * deci înghițim orice eroare (rețea, 4xx/5xx). Fără body — contractul cere 204.
 */
export async function reportAdImpression(adId: number): Promise<void> {
  try {
    await api.post(`/ads/${adId}/impression`);
  } catch {
    // Ignorăm intenționat: un impression pierdut nu afectează experiența.
  }
}

/**
 * Raportează un CLICK pe reclamă (`POST /ads/{id}/click` → 204).
 *
 * Best-effort, la fel ca impression-ul: eșecul de telemetrie e înghițit.
 */
export async function reportAdClick(adId: number): Promise<void> {
  try {
    await api.post(`/ads/${adId}/click`);
  } catch {
    // Ignorăm intenționat.
  }
}
