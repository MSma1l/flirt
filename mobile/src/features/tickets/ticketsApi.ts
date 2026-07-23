/** Acces la API pentru cumpărarea de bilete online prin transfer bancar. */
import { api } from '@/services/api';

import {
  PaymentInstructions,
  TicketOrder,
  TicketOrderDetail,
  TicketOrderStatus,
} from './types';

/** Forma brută (snake_case) a unei comenzi de bilet din backend. */
interface TicketOrderResponse {
  id: string;
  event_id?: string | null;
  status: string;
  price?: number | null;
  currency?: string | null;
  ticket_code?: string | null;
}

/** Forma brută (snake_case) a instrucțiunilor de plată din backend. */
interface PaymentInstructionsResponse {
  beneficiary: string;
  iban: string;
  bank_name: string;
  amount: number;
  currency: string;
  reference: string;
  comment_template: string;
  instructions?: string | null;
}

/** Răspunsul la creare / detaliu comandă: comanda + (opțional) instrucțiunile. */
interface TicketOrderDetailResponse {
  order: TicketOrderResponse;
  payment?: PaymentInstructionsResponse | null;
}

/** Mapează o comandă din snake_case → camelCase. */
function mapOrder(o: TicketOrderResponse): TicketOrder {
  return {
    id: o.id,
    eventId: o.event_id ?? null,
    status: o.status as TicketOrderStatus,
    price: o.price ?? null,
    currency: o.currency ?? null,
    ticketCode: o.ticket_code ?? null,
  };
}

/** Mapează instrucțiunile de plată din snake_case → camelCase. */
function mapPayment(p: PaymentInstructionsResponse): PaymentInstructions {
  return {
    beneficiary: p.beneficiary,
    iban: p.iban,
    bankName: p.bank_name,
    amount: p.amount,
    currency: p.currency,
    reference: p.reference,
    commentTemplate: p.comment_template,
    instructions: p.instructions ?? null,
  };
}

/** Mapează detaliul (comandă + instrucțiuni) din snake_case → camelCase. */
function mapDetail(d: TicketOrderDetailResponse): TicketOrderDetail {
  return {
    order: mapOrder(d.order),
    payment: d.payment ? mapPayment(d.payment) : null,
  };
}

/** Creează o comandă de bilet pentru un eveniment și întoarce comanda + instrucțiunile de plată. */
export async function createTicketOrder(eventId: string): Promise<TicketOrderDetail> {
  const { data } = await api.post<TicketOrderDetailResponse>(
    `/events/${eventId}/ticket-orders`,
  );
  return mapDetail(data);
}

/** Declară că transferul a fost făcut; comanda trece în `payment_declared`. */
export async function declareTicketPayment(
  id: string,
  note?: string,
): Promise<TicketOrder> {
  const { data } = await api.post<TicketOrderResponse>(
    `/ticket-orders/${id}/declare`,
    note ? { note } : {},
  );
  return mapOrder(data);
}

/** Aduce toate comenzile de bilet ale utilizatorului curent. */
export async function fetchMyTicketOrders(): Promise<TicketOrder[]> {
  const { data } = await api.get<TicketOrderResponse[]>('/ticket-orders/mine');
  return (data ?? []).map(mapOrder);
}

/** Aduce o singură comandă (instrucțiuni / status / ticket_code după stare). */
export async function fetchTicketOrder(id: string): Promise<TicketOrderDetail> {
  const { data } = await api.get<TicketOrderDetailResponse>(`/ticket-orders/${id}`);
  return mapDetail(data);
}
