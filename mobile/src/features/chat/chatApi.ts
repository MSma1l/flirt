/** Acces la API pentru chat (TZ secț. 5): dialoguri, mesaje, trimitere, citire. */
import { api } from '@/services/api';

import { ChatMessage, ChatSummary } from './types';

/** Forma brută (snake_case) a unui rând de dialog din backend. */
interface ChatSummaryResponse {
  chat_id: string;
  other_user_id: string;
  other_name: string;
  other_age?: number | null;
  other_city?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count: number;
}

/** Forma brută (snake_case) a unui mesaj din backend. */
interface ChatMessageResponse {
  id: string;
  sender_id: string;
  body: string;
  was_masked: boolean;
  is_read: boolean;
  created_at: string;
}

function mapMessage(m: ChatMessageResponse): ChatMessage {
  return {
    id: m.id,
    senderId: m.sender_id,
    body: m.body,
    wasMasked: !!m.was_masked,
    isRead: !!m.is_read,
    createdAt: m.created_at,
  };
}

/** Aduce lista de dialoguri și o mapează snake_case → camelCase. */
export async function fetchChats(): Promise<ChatSummary[]> {
  const { data } = await api.get<ChatSummaryResponse[]>('/chats/');
  return (data ?? []).map((c) => ({
    chatId: c.chat_id,
    otherUserId: c.other_user_id,
    otherName: c.other_name,
    otherAge: c.other_age ?? undefined,
    otherCity: c.other_city ?? undefined,
    lastMessage: c.last_message ?? undefined,
    lastMessageAt: c.last_message_at ?? undefined,
    unreadCount: c.unread_count ?? 0,
  }));
}

/** Aduce mesajele unui dialog și le mapează în camelCase. */
export async function fetchMessages(chatId: string): Promise<ChatMessage[]> {
  const { data } = await api.get<ChatMessageResponse[]>(`/chats/${chatId}/messages`);
  return (data ?? []).map(mapMessage);
}

/** Trimite un mesaj și întoarce mesajul creat, mapat în camelCase. */
export async function sendMessage(chatId: string, body: string): Promise<ChatMessage> {
  const { data } = await api.post<ChatMessageResponse>(`/chats/${chatId}/messages`, {
    body,
  });
  return mapMessage(data);
}

/** Marchează dialogul ca citit. */
export async function markRead(chatId: string): Promise<void> {
  await api.post(`/chats/${chatId}/read`);
}
