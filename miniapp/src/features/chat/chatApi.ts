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
 */
import type { ChatMessage } from '@mobile/features/chat/types';

import { api } from '@/api/client';

export {
  fetchChats,
  markRead,
  reactToMessage,
  sendMessage,
} from '@mobile/features/chat/chatApi';

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
}

function mapMessage(m: ChatMessageResponse): ChatMessage {
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
  };
}

/** O pagină de mesaje + cursorul spre pagina mai VECHE (`null` = capăt). */
export interface MessagePage {
  items: ChatMessage[];
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
