/**
 * Acces la API pentru „Ți-au dat like" — cererile de comunicare din ecranul Mesaje.
 *
 * Sunt userii care I-AU DAT LIKE utilizatorului (cu sau fără mesaj) și care încă
 * NU sunt match — utilizatorul nu a răspuns încă. E oglinda secțiunii „În
 * așteptare" (`socialApi.fetchPendingLikesPage`): acolo vezi like-urile pe care
 * LE-AI TRIMIS tu; aici vezi cele PRIMITE, la care poți răspunde.
 *
 * Răspunsul se face pe ACELAȘI endpoint ca swipe-ul din deck
 * (`feedApi.swipe(userId, 'like', message)`): backendul creează match + livrează
 * ambele mesaje (al lor + al tău) în chat. „Trece" = `swipe(userId, 'dislike')`.
 */
import { api } from '@/services/api';

import type { Page, PageParams } from './socialApi';

/** Câte rânduri cerem pe pagină. Backendul plafonează la `social_max_limit`. */
const PAGE_SIZE = 20;

/**
 * Ancheta persoanei care a dat like, în camelCase. Aceleași câmpuri ca un card
 * de feed (`FeedCard`), ca ecranul de detaliu să afișeze un profil complet:
 * poze, despre, interese, oraș.
 */
export interface ReceivedProfile {
  name: string;
  age: number;
  gender: string;
  city: string;
  about: string;
  /** Pozele profilului; prima e avatarul din listă. Gol = fără poze. */
  photos: string[];
  topInterests: string[];
  languages: string[];
}

/**
 * O cerere de comunicare: cineva ți-a dat like.
 *   - `isSuper` — a fost super like (badge distinct);
 *   - `message` — mesajul PE CARE ȚI L-A SCRIS (vizibil pentru tine chiar înainte
 *     de match, spre deosebire de „În așteptare" unde mesajul tău e ascuns lor);
 *     `null` = a dat doar like, fără mesaj.
 */
export interface ReceivedLikeItem {
  userId: string;
  isSuper: boolean;
  message: string | null;
  createdAt: string;
  profile: ReceivedProfile;
}

/** Forma brută (snake_case) a anchetei venită din backend. */
interface ReceivedProfileResponse {
  name: string;
  age: number;
  gender?: string;
  city?: string;
  about?: string;
  photos?: string[];
  top_interests?: string[];
  languages?: string[];
}

/** Forma brută (snake_case) a unei cereri venită din backend. */
interface ReceivedLikeResponse {
  user_id: string;
  is_super?: boolean;
  message?: string | null;
  created_at?: string;
  profile: ReceivedProfileResponse;
}

/** snake_case → camelCase pentru ancheta unei cereri. */
function toProfile(raw: ReceivedProfileResponse): ReceivedProfile {
  return {
    name: raw.name,
    age: raw.age,
    gender: raw.gender ?? '',
    city: raw.city ?? '',
    about: raw.about ?? '',
    photos: raw.photos ?? [],
    topInterests: raw.top_interests ?? [],
    languages: raw.languages ?? [],
  };
}

/** snake_case → camelCase pentru un rând din „Ți-au dat like". */
function toReceivedItem(raw: ReceivedLikeResponse): ReceivedLikeItem {
  return {
    userId: raw.user_id,
    // Câmpuri opționale în contract: lipsa lor = valori sigure, nu undefined.
    isSuper: raw.is_super ?? false,
    message: raw.message ?? null,
    createdAt: raw.created_at ?? '',
    profile: toProfile(raw.profile),
  };
}

/** Query string-ul unei cereri paginate. `cursor` se trimite doar dacă există. */
function toQuery({ limit = PAGE_SIZE, cursor }: PageParams = {}): Record<string, string | number> {
  const params: Record<string, string | number> = { limit };
  if (cursor) params.cursor = cursor;
  return params;
}

/**
 * Citește cursorul paginii următoare din headerul `X-Next-Cursor` (convenția
 * `/feed`). Axios normalizează numele la litere mici; header lipsă/gol = ultima
 * pagină.
 */
function readNextCursor(headers: unknown): string | null {
  const raw = (headers as Record<string, unknown> | undefined)?.['x-next-cursor'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Aduce o pagină din cererile de comunicare (like-uri PRIMITE, încă fără
 * răspuns). `/social/likes/received` paginează pe cursor ca restul listelor
 * sociale.
 */
export async function fetchReceivedLikesPage(
  params?: PageParams,
): Promise<Page<ReceivedLikeItem>> {
  const res = await api.get<ReceivedLikeResponse[]>('/social/likes/received', {
    params: toQuery(params),
  });
  return { items: (res.data ?? []).map(toReceivedItem), nextCursor: readNextCursor(res.headers) };
}
