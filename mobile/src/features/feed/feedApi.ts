/** Acces la API pentru feed-ul de swipe (TZ secț. 4): feed, swipe, match-uri. */
import { api } from '@/services/api';

import { FeedCard, MatchItem, SwipeAction, SwipeResult, UndoResult } from './types';

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
  chat_id?: string | null;
}

interface UndoResponse {
  undone: boolean;
  target_user_id?: string | null;
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
  const { data } = await api.get<FeedCardResponse[]>('/feed/');
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

/**
 * Trimite un swipe (like/dislike) și întoarce dacă a rezultat un match.
 * La like se poate atașa un mesaj de deschidere (`message`), inclus doar când e dat.
 */
export async function swipe(
  targetUserId: string,
  action: SwipeAction,
  message?: string,
): Promise<SwipeResult> {
  const body: { target_user_id: string; action: SwipeAction; message?: string } = {
    target_user_id: targetUserId,
    action,
  };
  if (message !== undefined) body.message = message;

  const { data } = await api.post<SwipeResponse>('/feed/swipe', body);
  return {
    matched: !!data.matched,
    matchId: data.match_id ?? undefined,
    chatId: data.chat_id ?? undefined,
  };
}

/** Anulează ultimul swipe. Mapează `target_user_id` → `targetUserId`. */
export async function undoSwipe(): Promise<UndoResult> {
  const { data } = await api.post<UndoResponse>('/feed/undo', {});
  return {
    undone: !!data.undone,
    targetUserId: data.target_user_id ?? null,
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
