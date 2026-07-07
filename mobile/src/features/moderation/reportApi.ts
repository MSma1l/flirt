/** Acces la API pentru raportare (TZ 5.5): trimite un raport de moderare. */
import { api } from '@/services/api';

import { ReportInput } from './types';

/** Forma brută (snake_case) trimisă către backend. */
interface ReportRequest {
  reported_user_id: string;
  category: ReportInput['category'];
  chat_id?: string;
  note?: string;
}

/** Trimite un raport. Mapează camelCase → snake_case pentru backend. */
export async function sendReport(input: ReportInput): Promise<void> {
  const payload: ReportRequest = {
    reported_user_id: input.reportedUserId,
    category: input.category,
  };
  if (input.chatId) payload.chat_id = input.chatId;
  if (input.note && input.note.trim()) payload.note = input.note.trim();

  await api.post('/reports/', payload);
}
