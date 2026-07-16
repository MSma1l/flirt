/**
 * Acces la API pentru Setări (TZ secț. 6.2–6.3): setări cont, ștergere cont,
 * bilet Flirt Party, listă de blocări. Mapare snake_case ↔ camelCase.
 */
import { api } from '@/services/api';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Comutatoarele de notificări, în camelCase. */
export interface NotificationSettings {
  match: boolean;
  messages: boolean;
  aiHints: boolean;
  events: boolean;
  promos: boolean;
}

/** Setările complete ale contului, în camelCase. */
export interface Settings {
  theme: ThemeMode;
  searchRadiusKm: number;
  notifications: NotificationSettings;
  profileHidden: boolean;
  region: string;

  /* --- Preferințe de căutare (filtre DURE în feed) ------------------------ */
  /** Genurile căutate (valori din `/profiles/reference`). Gol = fără restricție. */
  interestedIn: string[];
  /** Vârsta minimă căutată — valoarea EFECTIVĂ (backend-ul o ridică la 18+). */
  ageMin: number;
  /** Vârsta maximă căutată — valoarea EFECTIVĂ. */
  ageMax: number;
}

/** Actualizare parțială a setărilor (notificările pot fi și ele parțiale). */
export interface SettingsUpdate {
  theme?: ThemeMode;
  searchRadiusKm?: number;
  notifications?: Partial<NotificationSettings>;
  profileHidden?: boolean;
  region?: string;
  interestedIn?: string[];
  ageMin?: number;
  ageMax?: number;
}

/** Rezultatul unei cereri de ștergere a contului. */
export interface AccountDeletion {
  requestedAt: string;
  purgeAfter: string;
}

/** Biletul Flirt Party (one-time). */
export interface Ticket {
  code: string;
  used: boolean;
}

/** Un utilizator blocat. */
export interface BlockedUser {
  blockedId: string;
  name: string;
}

/** Câte blocări cerem pe pagină. Backendul plafonează la `social_max_limit`. */
const BLOCKS_PAGE_SIZE = 20;

/**
 * O pagină din lista de blocări.
 *
 * `nextCursor` vine din header-ul `X-Next-Cursor` (convenția `/feed`, folosită
 * de tot ce e paginat pe cursor în backend); `null` = nu mai există date.
 */
export interface BlocksPage {
  items: BlockedUser[];
  nextCursor: string | null;
}

/** Argumentele unei cereri paginate. Fără `cursor` = prima pagină. */
export interface BlocksPageParams {
  limit?: number;
  cursor?: string | null;
}

/* ------------------------- Forme brute (backend) ------------------------- */

interface NotificationSettingsResponse {
  match: boolean;
  messages: boolean;
  ai_hints: boolean;
  events: boolean;
  promos: boolean;
}

interface SettingsResponse {
  theme: ThemeMode;
  search_radius_km: number;
  notifications: NotificationSettingsResponse;
  profile_hidden: boolean;
  region: string;
  // `SettingsOut` le întoarce ÎNTOTDEAUNA (vârstele deja cu default-urile aplicate).
  interested_in: string[];
  age_min: number;
  age_max: number;
}

interface AccountDeletionResponse {
  requested_at: string;
  purge_after: string;
}

interface TicketResponse {
  code: string;
  used: boolean;
}

interface BlockedUserResponse {
  blocked_id: string;
  name: string;
}

/* ------------------------------- Mapare -------------------------------- */

function mapNotifications(n: NotificationSettingsResponse): NotificationSettings {
  return {
    match: !!n.match,
    messages: !!n.messages,
    aiHints: !!n.ai_hints,
    events: !!n.events,
    promos: !!n.promos,
  };
}

function mapSettings(s: SettingsResponse): Settings {
  return {
    theme: s.theme,
    searchRadiusKm: s.search_radius_km,
    notifications: mapNotifications(s.notifications),
    profileHidden: !!s.profile_hidden,
    region: s.region,
    interestedIn: s.interested_in ?? [],
    ageMin: s.age_min,
    ageMax: s.age_max,
  };
}

/** Transformă o actualizare camelCase în payload snake_case pentru backend. */
function toSettingsPayload(patch: SettingsUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (patch.theme !== undefined) payload.theme = patch.theme;
  if (patch.searchRadiusKm !== undefined) payload.search_radius_km = patch.searchRadiusKm;
  if (patch.profileHidden !== undefined) payload.profile_hidden = patch.profileHidden;
  if (patch.region !== undefined) payload.region = patch.region;
  if (patch.interestedIn !== undefined) payload.interested_in = patch.interestedIn;
  if (patch.ageMin !== undefined) payload.age_min = patch.ageMin;
  if (patch.ageMax !== undefined) payload.age_max = patch.ageMax;
  if (patch.notifications) {
    const n = patch.notifications;
    const notif: Record<string, boolean> = {};
    if (n.match !== undefined) notif.match = n.match;
    if (n.messages !== undefined) notif.messages = n.messages;
    if (n.aiHints !== undefined) notif.ai_hints = n.aiHints;
    if (n.events !== undefined) notif.events = n.events;
    if (n.promos !== undefined) notif.promos = n.promos;
    payload.notifications = notif;
  }
  return payload;
}

/* ------------------------------- API ----------------------------------- */

/** Aduce setările contului și le mapează în camelCase. */
export async function fetchSettings(): Promise<Settings> {
  const { data } = await api.get<SettingsResponse>('/settings/');
  return mapSettings(data);
}

/** Salvează o actualizare parțială și întoarce setările rezultate. */
export async function updateSettings(patch: SettingsUpdate): Promise<Settings> {
  const { data } = await api.put<SettingsResponse>('/settings/', toSettingsPayload(patch));
  return mapSettings(data);
}

/** Cere ștergerea contului; întoarce data programată de purjare. */
export async function requestAccountDeletion(): Promise<AccountDeletion> {
  const { data } = await api.post<AccountDeletionResponse>('/settings/account/delete');
  return { requestedAt: data.requested_at, purgeAfter: data.purge_after };
}

/** Anulează o cerere de ștergere a contului. */
export async function cancelAccountDeletion(): Promise<void> {
  await api.post('/settings/account/delete/cancel');
}

/** Aduce biletul Flirt Party. */
export async function fetchTicket(): Promise<Ticket> {
  const { data } = await api.get<TicketResponse>('/ticket/');
  return { code: data.code, used: !!data.used };
}

/**
 * Aduce o pagină din lista utilizatorilor blocați, mapată în camelCase.
 *
 * `/social/blocks` paginează pe cursor: trimitem `limit`/`cursor` și citim
 * cursorul paginii următoare din header-ul `X-Next-Cursor`. Ca să ajungem la
 * headere ne trebuie răspunsul axios întreg, nu doar `data`.
 */
export async function fetchBlocks(
  { limit = BLOCKS_PAGE_SIZE, cursor }: BlocksPageParams = {},
): Promise<BlocksPage> {
  const params: Record<string, string | number> = { limit };
  if (cursor) params.cursor = cursor;

  const res = await api.get<BlockedUserResponse[]>('/social/blocks', { params });
  // Axios normalizează numele headerelor la litere mici. Lipsă/gol = ultima pagină.
  const raw = (res.headers as Record<string, unknown> | undefined)?.['x-next-cursor'];

  return {
    items: (res.data ?? []).map((b) => ({ blockedId: b.blocked_id, name: b.name })),
    nextCursor: typeof raw === 'string' && raw.length > 0 ? raw : null,
  };
}

/** Blochează un utilizator (nu te mai poate contacta și dispare din feed). */
export async function blockUser(targetUserId: string): Promise<void> {
  await api.post('/social/blocks', { target_user_id: targetUserId });
}

/** Deblochează un utilizator. */
export async function unblock(blockedId: string): Promise<void> {
  await api.delete(`/social/blocks/${blockedId}`);
}
