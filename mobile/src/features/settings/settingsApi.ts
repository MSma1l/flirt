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
}

/** Actualizare parțială a setărilor (notificările pot fi și ele parțiale). */
export interface SettingsUpdate {
  theme?: ThemeMode;
  searchRadiusKm?: number;
  notifications?: Partial<NotificationSettings>;
  profileHidden?: boolean;
  region?: string;
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
  };
}

/** Transformă o actualizare camelCase în payload snake_case pentru backend. */
function toSettingsPayload(patch: SettingsUpdate): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (patch.theme !== undefined) payload.theme = patch.theme;
  if (patch.searchRadiusKm !== undefined) payload.search_radius_km = patch.searchRadiusKm;
  if (patch.profileHidden !== undefined) payload.profile_hidden = patch.profileHidden;
  if (patch.region !== undefined) payload.region = patch.region;
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

/** Aduce lista utilizatorilor blocați și o mapează în camelCase. */
export async function fetchBlocks(): Promise<BlockedUser[]> {
  const { data } = await api.get<BlockedUserResponse[]>('/social/blocks');
  return (data ?? []).map((b) => ({ blockedId: b.blocked_id, name: b.name }));
}

/** Deblochează un utilizator. */
export async function unblock(blockedId: string): Promise<void> {
  await api.delete(`/social/blocks/${blockedId}`);
}
