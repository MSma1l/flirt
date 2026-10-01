/**
 * Acces la API pentru chat, în Mini App.
 *
 * REUTILIZAT din aplicația Expo, fără copiere (`mobile/src/features/chat/chatApi.ts`,
 * prin alias-ul `@mobile/`): lista de dialoguri, trimiterea unui mesaj, marcarea
 * ca citit și reacțiile. Alias-ul `@/services/api` din acele fișiere e mapat pe
 * clientul HTTP de aici (vezi `vite.config.ts`), deci modulele Expo primesc
 * automat instanța web — nu e nevoie de nicio adaptare.
 *
 * ADĂUGAT aici: PAGINAREA istoricului. `fetchMessages` din mobil cere mereu
 * prima pagină și aruncă header-ul `X-Next-Cursor`, deci nu poate derula înapoi
 * în istoric. Ruta backend (`backend/app/api/v1/chat.py::get_messages`) întoarce
 * în acel header cursorul paginii mai VECHI — convenția `/feed`, aceeași
 * folosită de `mobile/src/features/social/socialApi.ts`. Header-ul e expus prin
 * CORS (`backend/app/main.py`: `expose_headers=[…, "X-Next-Cursor"]`), altfel
 * browserul nu l-ar lăsa citit.
 *
 * Rutele confirmate în `backend/app/api/v1/chat.py`:
 *   GET    /chats/                                  → list[ChatSummary]
 *   GET    /chats/{chat_id}/messages?limit&cursor   → list[MessageOut] + X-Next-Cursor
 *   POST   /chats/{chat_id}/messages                → MessageOut (201)
 *   POST   /chats/{chat_id}/messages/{id}/react     → MessageOut
 *   POST   /chats/{chat_id}/read                    → 204
 *   POST   /chats/{chat_id}/attachments (multipart)  → MessageOut (201)
 *
 * MEDIA: `MessageOut` poartă `kind` ("text" | "image" | "video" | "voice") și
 * `attachment` ({url, mime, size_bytes, duration_ms, width, height} | null).
 * Mesajele vechi nu au aceste câmpuri → le tratăm ca text, fără atașament.
 */
import type { AxiosProgressEvent } from 'axios';

import type { ChatMessage, ChatSummary } from '@mobile/features/chat/types';

import { api } from '@/api/client';

export { markRead, reactToMessage, sendMessage } from '@mobile/features/chat/chatApi';

/** Tipul unui mesaj. Lipsa câmpului (mesaje vechi) înseamnă text. */
export type MessageKind = 'text' | 'image' | 'video' | 'voice';

/** Fișierul atașat unui mesaj media, în camelCase. */
export interface MessageAttachment {
  url: string;
  mime: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/** Mesajul din Mini App: cel din mobil + câmpurile media (opționale). */
export interface ChatMessageEx extends ChatMessage {
  kind?: MessageKind;
  attachment?: MessageAttachment | null;
}

/** Rândul din lista de dialoguri + câmpurile pe care backendul le POATE expune. */
export interface ChatSummaryEx extends ChatSummary {
  /** Tipul ultimului mesaj, dacă serverul îl trimite (`last_message_kind`). */
  lastMessageKind?: MessageKind;
  /** Poza celuilalt, dacă serverul o trimite (`other_photo_url`). */
  otherPhotoUrl?: string;
}

interface AttachmentResponse {
  url: string;
  mime: string;
  size_bytes: number;
  duration_ms?: number | null;
  width?: number | null;
  height?: number | null;
}

const KINDS: readonly MessageKind[] = ['text', 'image', 'video', 'voice'];

function toKind(raw: unknown): MessageKind {
  return KINDS.includes(raw as MessageKind) ? (raw as MessageKind) : 'text';
}

function mapAttachment(a: AttachmentResponse | null | undefined): MessageAttachment | null {
  if (!a || typeof a.url !== 'string' || !a.url) return null;
  return {
    url: a.url,
    mime: a.mime ?? '',
    sizeBytes: a.size_bytes ?? 0,
    durationMs: a.duration_ms ?? null,
    width: a.width ?? null,
    height: a.height ?? null,
  };
}

interface ChatSummaryResponse {
  chat_id: string;
  other_user_id: string;
  other_name: string;
  other_age?: number | null;
  other_city?: string | null;
  other_photo_url?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  last_message_kind?: string | null;
  unread_count: number;
  compatibility?: number | null;
}

/**
 * Lista de dialoguri. Aceeași mapare ca în mobil, plus câmpurile opționale
 * `last_message_kind` și `other_photo_url` — folosite doar dacă serverul le dă.
 */
export async function fetchChats(): Promise<ChatSummaryEx[]> {
  const { data } = await api.get<ChatSummaryResponse[]>('/chats/');
  return (data ?? []).map((c) => {
    const row: ChatSummaryEx = {
      chatId: c.chat_id,
      otherUserId: c.other_user_id,
      otherName: c.other_name,
      otherAge: c.other_age ?? undefined,
      otherCity: c.other_city ?? undefined,
      lastMessage: c.last_message ?? undefined,
      lastMessageAt: c.last_message_at ?? undefined,
      unreadCount: c.unread_count ?? 0,
      compatibility: c.compatibility ?? 0,
    };
    if (c.last_message_kind) row.lastMessageKind = toKind(c.last_message_kind);
    if (c.other_photo_url) row.otherPhotoUrl = c.other_photo_url;
    return row;
  });
}

/**
 * Forma brută (snake_case) a unui mesaj, ca în `backend/app/schemas/chat.py`
 * (`MessageOut`). Mapperul din mobil nu e exportat, deci îl rescriem aici —
 * singura duplicare, și doar cât să putem citi cursorul din header.
 */
interface ChatMessageResponse {
  id: string;
  sender_id: string;
  body: string;
  was_masked: boolean;
  is_read: boolean;
  created_at: string;
  reaction?: string | null;
  kind?: string | null;
  attachment?: AttachmentResponse | null;
}

function mapMessage(m: ChatMessageResponse): ChatMessageEx {
  return {
    id: m.id,
    senderId: m.sender_id,
    // `body` vine DEJA mascat de server (`app/services/contact_masker.py`).
    // Nu-l atingem: interfața afișează exact ce a persistat backendul.
    body: m.body,
    wasMasked: !!m.was_masked,
    isRead: !!m.is_read,
    createdAt: m.created_at,
    reaction: m.reaction ?? null,
    kind: toKind(m.kind),
    attachment: mapAttachment(m.attachment),
  };
}

/** O pagină de mesaje + cursorul spre pagina mai VECHE (`null` = capăt). */
export interface MessagePage {
  items: ChatMessageEx[];
  nextCursor: string | null;
}

/** Citește `X-Next-Cursor` din headerele răspunsului (lowercase la axios). */
function readNextCursor(headers: unknown): string | null {
  const raw = (headers as Record<string, unknown> | undefined)?.['x-next-cursor'];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * O pagină de mesaje dintr-un dialog.
 *
 * Fără `cursor` întoarce cele mai NOI mesaje (implicit 50, vezi
 * `messages_page_limit`), în ordine cronologică crescătoare în interiorul
 * paginii. Cu `cursor` întoarce fereastra imediat mai veche.
 *
 * NU marchează nimic citit — un GET nu mută stare; pentru asta există
 * `markRead` (POST /chats/{id}/read).
 */
export async function fetchMessagesPage(
  chatId: string,
  cursor?: string | null,
): Promise<MessagePage> {
  const res = await api.get<ChatMessageResponse[]>(`/chats/${chatId}/messages`, {
    ...(cursor ? { params: { cursor } } : {}),
  });
  return {
    items: (res.data ?? []).map(mapMessage),
    nextCursor: readNextCursor(res.headers),
  };
}

/** Opțiunile unui upload de atașament. */
export interface UploadOptions {
  /** Durata în milisecunde (mesaje vocale / video). */
  durationMs?: number;
  /** Descrierea opțională; devine `body` pe server. */
  caption?: string;
  /** Progresul, 0..1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Numele fișierului din partea multipart (blob-urile n-au nume). */
  fileName?: string;
}

/**
 * Trimite un atașament: `POST /chats/{id}/attachments`, multipart/form-data cu
 * `file`, `duration_ms` și `caption` (ultimele două opționale).
 *
 * Folosește ACELAȘI client axios (JWT + reînnoire la 401). `Content-Type` NU se
 * setează manual: browserul pune singur `multipart/form-data; boundary=…`.
 */
export async function uploadAttachment(
  chatId: string,
  file: Blob,
  options: UploadOptions = {},
): Promise<ChatMessageEx> {
  const form = new FormData();
  const name =
    options.fileName ?? (file instanceof File && file.name ? file.name : 'attachment');
  form.append('file', file, name);
  if (typeof options.durationMs === 'number' && Number.isFinite(options.durationMs)) {
    form.append('duration_ms', String(Math.round(options.durationMs)));
  }
  const caption = options.caption?.trim();
  if (caption) form.append('caption', caption);

  const { data } = await api.post<ChatMessageResponse>(`/chats/${chatId}/attachments`, form, {
    // Uploadul unui video de 50 MB pe o rețea mobilă poate dura minute.
    timeout: 10 * 60_000,
    ...(options.signal ? { signal: options.signal } : {}),
    onUploadProgress: (e: AxiosProgressEvent) => {
      if (!options.onProgress) return;
      const total = e.total ?? file.size;
      if (total > 0) options.onProgress(Math.min(1, e.loaded / total));
    },
  });
  return mapMessage(data);
}
