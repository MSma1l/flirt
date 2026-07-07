/** Acces la API pentru Evenimente / Live Events + Flirt Passport (TZ secț. 8). */
import { api } from '@/services/api';

import { EventItem, PassportStamp } from './types';

/** Forma brută (snake_case) a unui eveniment din backend. */
interface EventResponse {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  city: string;
  venue: string;
  lat?: number | null;
  lng?: number | null;
  kind: string;
  cover_url?: string | null;
  attendee_count: number;
  i_am_going: boolean;
}

/** Forma brută (snake_case) a unei ștampile de passport din backend. */
interface PassportStampResponse {
  event_id: string;
  event_title: string;
  city: string;
  stamped_at: string;
}

/** Mapează un eveniment din snake_case → camelCase. */
function mapEvent(e: EventResponse): EventItem {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startsAt: e.starts_at,
    city: e.city,
    venue: e.venue,
    lat: e.lat ?? undefined,
    lng: e.lng ?? undefined,
    kind: e.kind,
    coverUrl: e.cover_url ?? undefined,
    attendeeCount: e.attendee_count,
    iAmGoing: !!e.i_am_going,
  };
}

/** Mapează o ștampilă din snake_case → camelCase. */
function mapStamp(s: PassportStampResponse): PassportStamp {
  return {
    eventId: s.event_id,
    eventTitle: s.event_title,
    city: s.city,
    stampedAt: s.stamped_at,
  };
}

/** Aduce lista de evenimente. */
export async function fetchEvents(): Promise<EventItem[]> {
  const { data } = await api.get<EventResponse[]>('/events/');
  return (data ?? []).map(mapEvent);
}

/** Aduce un singur eveniment după id. */
export async function fetchEvent(id: string): Promise<EventItem> {
  const { data } = await api.get<EventResponse>(`/events/${id}`);
  return mapEvent(data);
}

/** Confirmă / anulează participarea și întoarce evenimentul actualizat. */
export async function setGoing(id: string, going: boolean): Promise<EventItem> {
  const { data } = await api.post<EventResponse>(`/events/${id}/going`, { going });
  return mapEvent(data);
}

/** Face check-in la eveniment și întoarce ștampila primită. */
export async function checkin(id: string): Promise<PassportStamp> {
  const { data } = await api.post<PassportStampResponse>(`/events/${id}/checkin`);
  return mapStamp(data);
}

/** Aduce toate ștampilele din Flirt Passport. */
export async function fetchPassport(): Promise<PassportStamp[]> {
  const { data } = await api.get<PassportStampResponse[]>('/events/passport');
  return (data ?? []).map(mapStamp);
}
