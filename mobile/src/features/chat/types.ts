/** Tipuri pentru chat (TZ secț. 5). Toate câmpurile în camelCase. */

/** Un rând din lista de dialoguri. */
export interface ChatSummary {
  chatId: string;
  otherUserId: string;
  otherName: string;
  otherAge?: number;
  otherCity?: string;
  /** Textul ultimului mesaj (poate lipsi într-un chat nou). */
  lastMessage?: string;
  /** Momentul ultimului mesaj (ISO 8601). */
  lastMessageAt?: string;
  /** Numărul de mesaje necitite pentru utilizatorul curent. */
  unreadCount: number;
}

/** Un mesaj dintr-o conversație. */
export interface ChatMessage {
  id: string;
  senderId: string;
  body: string;
  /** True dacă backend-ul a mascat un contact în corpul mesajului. */
  wasMasked: boolean;
  isRead: boolean;
  /** Momentul creării (ISO 8601). */
  createdAt: string;
}
