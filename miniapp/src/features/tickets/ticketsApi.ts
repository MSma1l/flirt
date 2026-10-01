/**
 * Acces la API pentru bilete, în Mini App — UN SINGUR punct de tăiere pentru
 * rețea (testele mochează acest modul, nu pe cele din `mobile/`).
 *
 * Ce se reutilizează din aplicația Expo (funcții pure, fără copiere):
 * `createTicketOrder` și `declareTicketPayment`. Ce se citește AICI, cu mapare
 * proprie, și de ce:
 *
 *  - `/ticket-orders/mine` și `/ticket-orders/{id}`: mapperul mobil aruncă
 *    `event_title`, `admin_note`, `created_at` și nu cunoaște stările noi ale
 *    cererilor manuale (`pending_payment`, `payment_proof_submitted`, …), care
 *    stau în ACELAȘI tabel și vin pe aceleași rute. Fără ele, motivul unui refuz
 *    și titlul evenimentului s-ar pierde.
 *  - `/ticket/`: contractul nou al scanerului de la intrare adaugă `status`
 *    (`valid` | `admitted` | `used` | `expired` | `cancelled`) și `admitted_at`.
 *    Un server vechi nu le trimite → rămân `null` și ecranul cade pe `used`.
 *
 * Rutele confirmate în `backend/app/api/v1/`:
 *   GET  /ticket/                            → TicketOut {code, used, status?, admitted_at?}
 *   POST /events/{event_id}/ticket-orders    → TicketOrderCreateOut (201)
 *   POST /ticket-orders/{id}/declare         → TicketOrderOut
 *   GET  /ticket-orders/mine                 → list[TicketOrderOut]
 *   GET  /ticket-orders/{id}                 → TicketOrderCreateOut
 *   POST /ticket-orders/{id}/payment-proof   → TicketOrderOut (multipart: file, method?)
 */
import { api } from '@/api/client';
import {
  proofUploadRequest,
  type ProofUploadOptions,
} from '@/features/ticketRequests/ticketRequestsApi';

import {
  mapOrder,
  parsePassStatus,
  str,
  type Ticket,
  type TicketOrder,
} from './orderModel';
import { mapPayment, type PaymentInstructions } from './paymentModel';

export {
  fetchMyTicketOrdersWithEvent,
  parsePassStatus,
  type Ticket,
  type TicketOrder,
  type TicketOrderListItem,
  type TicketOrderStatus,
  type TicketPassStatus,
} from './orderModel';

export { mapPayment, type PaymentInstructions, type PaymentMethod } from './paymentModel';

export { createTicketOrder, declareTicketPayment } from '@mobile/features/tickets/ticketsApi';

// Cererile manuale (cu dovadă de plată) și evenimentul trec tot pe aici, ca
// ecranul de bilete să aibă un singur modul de mockat.
export {
  fetchMyTicketRequests,
  uploadPaymentProof,
  type TicketRequest,
} from '@/features/ticketRequests/ticketRequestsApi';
export { fetchEvent, type EventItem } from '@/features/events/eventsApi';

export interface TicketOrderDetail {
  order: TicketOrder;
  payment: PaymentInstructions | null;
}

type Raw = Record<string, unknown>;

/** Biletul propriu, cu starea de la intrare când serverul o știe. */
export async function fetchTicket(): Promise<Ticket> {
  const { data } = await api.get<Raw>('/ticket/');
  return {
    code: String(data?.code ?? ''),
    used: Boolean(data?.used),
    status: parsePassStatus(data?.status),
    admittedAt: str(data?.admitted_at),
  };
}

/** O comandă + instrucțiunile de plată (doar cât timp e `awaiting_payment`). */
export async function fetchTicketOrder(id: string): Promise<TicketOrderDetail> {
  const { data } = await api.get<{ order: Raw; payment?: Raw | null }>(
    `/ticket-orders/${encodeURIComponent(id)}`,
  );
  return {
    order: mapOrder(data.order),
    payment: data.payment ? mapPayment(data.payment) : null,
  };
}

/**
 * Chitanța plății pe o comandă (directă SAU cerere) → comanda trece „în
 * verificare". Imagine (jpeg/png/webp) sau PDF; `method` = metoda aleasă de om.
 */
export async function uploadOrderProof(
  orderId: string,
  file: File,
  options: ProofUploadOptions = {},
): Promise<TicketOrder> {
  const { form, config } = proofUploadRequest(file, options);
  const { data } = await api.post<Raw>(
    `/ticket-orders/${encodeURIComponent(orderId)}/payment-proof`,
    form,
    config,
  );
  return mapOrder(data);
}
