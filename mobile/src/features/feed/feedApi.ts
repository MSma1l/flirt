/** Acces la API pentru feed-ul de swipe (TZ secț. 4): feed, swipe, match-uri. */
import { api } from '@/services/api';

import { FeedCard, MatchItem, SwipeAction, SwipeResult } from './types';

/** Forma brută (snake_case) a unui card din backend. */
interface FeedCardResponse {
  user_id: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  distance_km?: number | null;
  about: string;
  top_interests?: string[];
  languages?: string[];
  compatibility: number;
  photos?: string[];
}

interface SwipeResponse {
  matched: boolean;
  match_id?: string | null;
}

interface MatchResponse {
  match_id: string;
  user_id: string;
  name: string;
  age: number;
  city: string;
  compatibility: number;
}

/** Aduce lista de carduri din feed și le mapează snake_case → camelCase. */
export async function fetchFeed(): Promise<FeedCard[]> {
  const { data } = await api.get<FeedCardResponse[]>('/feed');
  return (data ?? []).map((c) => ({
    userId: c.user_id,
    name: c.name,
    age: c.age,
    gender: c.gender,
    city: c.city,
    distanceKm: c.distance_km ?? undefined,
    about: c.about,
    topInterests: c.top_interests ?? [],
    languages: c.languages ?? [],
    compatibility: c.compatibility,
    photos: c.photos ?? [],
  }));
}

/** Trimite un swipe (like/dislike) și întoarce dacă a rezultat un match. */
export async function swipe(
  targetUserId: string,
  action: SwipeAction,
): Promise<SwipeResult> {
  const { data } = await api.post<SwipeResponse>('/feed/swipe', {
    target_user_id: targetUserId,
    action,
  });
  return {
    matched: !!data.matched,
    matchId: data.match_id ?? undefined,
  };
}

/** Aduce lista de match-uri și o mapează în camelCase. */
export async function fetchMatches(): Promise<MatchItem[]> {
  const { data } = await api.get<MatchResponse[]>('/feed/matches');
  return (data ?? []).map((m) => ({
    matchId: m.match_id,
    userId: m.user_id,
    name: m.name,
    age: m.age,
    city: m.city,
    compatibility: m.compatibility,
  }));
}
