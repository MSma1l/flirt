/**
 * Centrul de activitate: statistici, cronologie și badge-ul de necitite.
 *
 *   GET  /notifications/activity?limit&cursor → { stats, items, next_cursor, unread }
 *   GET  /notifications/activity/unread       → { unread }   (ținta poll-ului)
 *   POST /notifications/activity/read         ← { up_to? }   → { unread }
 *   POST /profiles/{id}/view                  → 204 (anketa deschisă în detaliu)
 *
 * POLL-UL e deliberat lejer: o cerere mică la `ACTIVITY_POLL_MS`, oprită cât
 * Mini App-ul e ascuns (`usePollInterval`, același mecanism ca în chat).
 * Testerii au simțit aplicația „grea"; badge-ul nu are voie să adauge la asta.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { api } from '@/api/client';
import { usePollInterval } from '@/features/chat/usePollInterval';

/** Intervalul poll-ului de badge: destul de des pentru un like, rar pentru baterie. */
export const ACTIVITY_POLL_MS = 45_000;

export const ACTIVITY_UNREAD_KEY = ['activity', 'unread'] as const;
export const ACTIVITY_LIST_KEY = ['activity', 'list'] as const;

export type ActivityKind = 'match' | 'like' | 'super_like' | 'views';

export interface ActivityActor {
  userId: string;
  name: string;
  age: number;
  photo: string | null;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  isRead: boolean;
  actor: ActivityActor | null;
  /** Doar la `views`: câți oameni au văzut profilul în ziua aceea. */
  count: number | null;
  /** Doar la `match`: conversația, ca rândul să o deschidă direct. */
  chatId: string | null;
}

export interface ActivityStats {
  viewsTotal: number;
  viewsLast7Days: number;
  likes: number;
  superLikes: number;
  dislikes: number;
  matches: number;
}

export interface ActivityPage {
  stats: ActivityStats | null;
  items: ActivityItem[];
  nextCursor: string | null;
  unread: number;
}

interface RawActor {
  user_id: string;
  name: string;
  age: number;
  photo?: string | null;
}

interface RawItem {
  id: string;
  kind: ActivityKind;
  occurred_at: string;
  is_read: boolean;
  actor?: RawActor | null;
  count?: number | null;
  chat_id?: string | null;
}

interface RawStats {
  views_total: number;
  views_last_7_days: number;
  likes: number;
  super_likes: number;
  dislikes: number;
  matches: number;
}

interface RawPage {
  stats?: RawStats | null;
  items?: RawItem[];
  next_cursor?: string | null;
  unread?: number;
}

const KINDS: readonly ActivityKind[] = ['match', 'like', 'super_like', 'views'];

function mapItem(raw: RawItem): ActivityItem {
  return {
    id: raw.id,
    kind: raw.kind,
    occurredAt: raw.occurred_at,
    isRead: raw.is_read,
    actor: raw.actor
      ? {
          userId: raw.actor.user_id,
          name: raw.actor.name,
          age: raw.actor.age,
          photo: raw.actor.photo ?? null,
        }
      : null,
    count: raw.count ?? null,
    chatId: raw.chat_id ?? null,
  };
}

function mapStats(raw: RawStats): ActivityStats {
  return {
    viewsTotal: raw.views_total,
    viewsLast7Days: raw.views_last_7_days,
    likes: raw.likes,
    superLikes: raw.super_likes,
    dislikes: raw.dislikes,
    matches: raw.matches,
  };
}

export async function fetchActivity(cursor?: string | null): Promise<ActivityPage> {
  const { data } = await api.get<RawPage>('/notifications/activity', {
    params: cursor ? { cursor } : undefined,
  });
  return {
    stats: data.stats ? mapStats(data.stats) : null,
    // Un tip necunoscut (server mai nou) se sare, nu strică ecranul.
    items: (data.items ?? []).filter((i) => KINDS.includes(i.kind)).map(mapItem),
    nextCursor: data.next_cursor ?? null,
    unread: data.unread ?? 0,
  };
}

export async function fetchActivityUnread(): Promise<number> {
  const { data } = await api.get<{ unread?: number }>('/notifications/activity/unread');
  return data.unread ?? 0;
}

/** Marchează citit până la `upTo` (cel mai nou element afișat). Întoarce necititele. */
export async function markActivityRead(upTo?: string): Promise<number> {
  const { data } = await api.post<{ unread?: number }>(
    '/notifications/activity/read',
    upTo ? { up_to: upTo } : {},
  );
  return data.unread ?? 0;
}

/**
 * Notează o deschidere de anketă în detaliu („cine ți-a văzut profilul").
 * Fire-and-forget: o vizualizare pierdută nu merită o eroare pe ecran.
 * Vizualizările din feed se notează pe server, la swipe.
 */
export function recordProfileView(userId: string): void {
  void api.post(`/profiles/${encodeURIComponent(userId)}/view`).catch(() => undefined);
}

/** Numărul de necitite, cu poll lejer oprit cât Mini App-ul e ascuns. */
export function useActivityUnread() {
  const refetchInterval = usePollInterval(ACTIVITY_POLL_MS);
  return useQuery<number>({
    queryKey: ACTIVITY_UNREAD_KEY,
    queryFn: fetchActivityUnread,
    refetchInterval,
    // Mai multe componente citesc badge-ul (bara de taburi, meniul): o singură
    // cerere la montare, nu câte una pentru fiecare.
    staleTime: ACTIVITY_POLL_MS / 2,
    // Badge-ul e un semnal, nu un ecran: la eroare tăcem și reîncercăm la poll.
    retry: false,
  });
}

/** Cronologia, paginată pe cursor (statisticile vin pe prima pagină). */
export function useActivityFeed() {
  return useInfiniteQuery({
    queryKey: ACTIVITY_LIST_KEY,
    queryFn: ({ pageParam }) => fetchActivity(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Ecranul se deschide pentru noutăți: mereu proaspăt.
    staleTime: 0,
    gcTime: 0,
  });
}
