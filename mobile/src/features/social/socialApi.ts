/**
 * Acces la API pentru ecranul „Favorite" (TZ secț. 6.1).
 *
 * Ecranul are DOUĂ surse, deliberat distincte:
 *   - like-urile TRIMISE (`/social/likes/sent`) — populate automat de swipe-ul
 *     din deck;
 *   - favoritele marcate manual cu ★ (`/social/favorites`).
 * Backendul le întoarce în aceeași formă, deci folosim un singur mapper.
 */
import { api } from '@/services/api';

/** Câte rânduri cerem pe pagină. Backendul plafonează la `social_max_limit`. */
const PAGE_SIZE = 20;

/**
 * O pagină dintr-o listă paginată pe cursor.
 *
 * `nextCursor` vine din header-ul `X-Next-Cursor` (convenția `/feed`); `null`
 * înseamnă că nu mai există date — nu doar că n-am cerut încă.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Argumentele unei cereri paginate. Fără `cursor` = prima pagină. */
export interface PageParams {
  limit?: number;
  cursor?: string | null;
}

/** Un profil dintr-o listă socială (favorit sau like trimis), în camelCase. */
export interface FavoriteItem {
  targetUserId: string;
  name: string;
  age: number;
  city: string;
  /** Pozele profilului; prima e avatarul din listă. Gol = fără poze. */
  photos: string[];
}

/** Forma brută (snake_case) venită din backend. Identică pentru ambele liste. */
interface FavoriteResponse {
  target_user_id: string;
  name: string;
  age: number;
  city: string;
  photos?: string[];
}

/** snake_case → camelCase pentru un rând din oricare din cele două liste. */
function toItem(raw: FavoriteResponse): FavoriteItem {
  return {
    targetUserId: raw.target_user_id,
    name: raw.name,
    age: raw.age,
    city: raw.city,
    photos: raw.photos ?? [],
  };
}

/** Query string-ul unei cereri paginate. `cursor` se trimite doar dacă există. */
function toQuery({ limit = PAGE_SIZE, cursor }: PageParams = {}): Record<string, string | number> {
  const params: Record<string, string | number> = { limit };
  if (cursor) params.cursor = cursor;
  return params;
}

/**
 * Citește cursorul paginii următoare din headerele răspunsului.
 *
 * Axios normalizează numele headerelor la litere mici; acceptăm și forma
 * originală ca să nu depindem de asta. Header lipsă sau gol = ultima pagină.
 */
function readNextCursor(headers: unknown): string | null {
  const raw = (headers as Record<string, unknown> | undefined)?.['x-next-cursor'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/** Aduce o pagină de favorite marcate manual cu ★. */
export async function fetchFavoritesPage(params?: PageParams): Promise<Page<FavoriteItem>> {
  const res = await api.get<FavoriteResponse[]>('/social/favorites', { params: toQuery(params) });
  return { items: (res.data ?? []).map(toItem), nextCursor: readNextCursor(res.headers) };
}

/**
 * Aduce o pagină din profilurile cărora utilizatorul le-a dat like în deck.
 * `/likes/sent` paginează identic cu `/favorites`.
 */
export async function fetchLikesSentPage(params?: PageParams): Promise<Page<FavoriteItem>> {
  const res = await api.get<FavoriteResponse[]>('/social/likes/sent', { params: toQuery(params) });
  return { items: (res.data ?? []).map(toItem), nextCursor: readNextCursor(res.headers) };
}

/**
 * Un like „în așteptare": ai dat like/super like, dar celălalt încă NU a
 * răspuns, deci nu e încă match. Vizibil DOAR pentru tine.
 *
 * Peste datele de profil obișnuite are două câmpuri proprii:
 *   - `isSuper` — a fost super like (badge distinct în listă);
 *   - `myMessage` — mesajul pe care L-AI SCRIS TU la like, ascuns de celălalt
 *     până la match, dar pe care TU ți-l vezi aici. `null` = n-ai scris nimic.
 */
export interface PendingLikeItem extends FavoriteItem {
  isSuper: boolean;
  myMessage: string | null;
}

/** Forma brută (snake_case) a unui like în așteptare venită din backend. */
interface PendingLikeResponse extends FavoriteResponse {
  is_super?: boolean;
  my_message?: string | null;
}

/** snake_case → camelCase pentru un rând din lista „în așteptare". */
function toPendingItem(raw: PendingLikeResponse): PendingLikeItem {
  return {
    ...toItem(raw),
    // Câmpuri opționale în contract: lipsa lor = valori sigure, nu undefined.
    isSuper: raw.is_super ?? false,
    myMessage: raw.my_message ?? null,
  };
}

/**
 * Aduce o pagină din like-urile TRIMISE care încă n-au primit răspuns (nu-s
 * încă match). `/likes/pending` paginează identic cu `/favorites`.
 */
export async function fetchPendingLikesPage(
  params?: PageParams,
): Promise<Page<PendingLikeItem>> {
  const res = await api.get<PendingLikeResponse[]>('/social/likes/pending', {
    params: toQuery(params),
  });
  return { items: (res.data ?? []).map(toPendingItem), nextCursor: readNextCursor(res.headers) };
}

/**
 * Doar PRIMA pagină de favorite, ca listă simplă.
 *
 * Există pentru `useFavorite`, care întreabă „e userul ăsta favorit?" dintr-un
 * card de profil și nu are ce face cu paginile: n-are sens să tragă toată lista
 * ca să bifeze o stea. Ecranul de favorite folosește `fetchFavoritesPage`.
 */
export async function fetchFavorites(): Promise<FavoriteItem[]> {
  const { items } = await fetchFavoritesPage();
  return items;
}

/** Adaugă un utilizator la favorite (★). Idempotent pe backend. */
export async function addFavorite(targetUserId: string): Promise<void> {
  await api.post('/social/favorites', { target_user_id: targetUserId });
}

/** Scoate un utilizator din favorite. */
export async function removeFavorite(targetUserId: string): Promise<void> {
  await api.delete(`/social/favorites/${targetUserId}`);
}
