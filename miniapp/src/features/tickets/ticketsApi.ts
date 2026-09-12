/**
 * Acces la API pentru bilete, în Mini App.
 *
 * REUTILIZAT din aplicația Expo, fără copiere (`@mobile/features/tickets/ticketsApi`
 * și `@mobile/features/settings/settingsApi`): acele fișiere sunt pure, iar
 * alias-ul `@/services/api` din ele e mapat pe clientul axios de aici (vezi
 * `vite.config.ts`), deci primesc automat instanța web.
 *
 * Testele mochează ACEST modul, nu pe cele din `mobile/`: ecranul importă doar
 * de aici, deci există un singur punct de tăiere pentru rețea.
 *
 * Rutele confirmate în `backend/app/api/v1/`:
 *   GET  /ticket/                            → TicketOut {code, used}
 *   POST /events/{event_id}/ticket-orders    → TicketOrderCreateOut (201)
 *   POST /ticket-orders/{id}/declare         → TicketOrderOut
 *   GET  /ticket-orders/mine                 → list[TicketOrderOut]
 *   GET  /ticket-orders/{id}                 → TicketOrderCreateOut
 */
import { api } from '@/api/client';

import type { TicketOrder, TicketOrderStatus } from '@mobile/features/tickets/types';

export {
  createTicketOrder,
  declareTicketPayment,
  fetchMyTicketOrders,
  fetchTicketOrder,
} from '@mobile/features/tickets/ticketsApi';

export { fetchTicket } from '@mobile/features/settings/settingsApi';
export type { Ticket } from '@mobile/features/settings/settingsApi';

export type {
  PaymentInstructions,
  TicketOrder,
  TicketOrderDetail,
  TicketOrderStatus,
} from '@mobile/features/tickets/types';

/**
 * O comandă din listă, cu datele evenimentului alăturate.
 *
 * DE CE există pe lângă `TicketOrder`: `TicketOrderOut`
 * (`backend/app/schemas/ticket_order.py`) trimite ÎNTOTDEAUNA `event_title`,
 * `event_starts_at`, `reference` și `created_at`, dar mapperul din
 * `mobile/src/features/tickets/ticketsApi.ts` le aruncă — pe mobil lista de
 * comenzi nu are ecran propriu, comenzile se văd doar din pagina evenimentului,
 * unde titlul e deja pe ecran. Aici lista E ecranul: fără titlu și dată, un rând
 * ar fi un UUID și un preț. Sarcina interzice modificarea fișierului din
 * `mobile/`, deci maparea bogată trăiește aici.
 */
export interface TicketOrderListItem extends TicketOrder {
  /** Titlul evenimentului, așa cum îl trimite backendul. */
  eventTitle: string;
  /** Începutul evenimentului (ISO 8601). */
  eventStartsAt: string;
  /** Referința userului (`U-XXXXXXXX`), de pus în comentariul transferului. */
  reference: string;
  /** Momentul plasării comenzii (ISO 8601) — ordinea din listă. */
  createdAt: string;
}

/** Forma brută (snake_case) a unei comenzi, ca în `TicketOrderOut`. */
interface TicketOrderListResponse {
  id: string;
  event_id: string;
  event_title: string;
  event_starts_at: string;
  price: number;
  currency: string;
  reference: string;
  status: string;
  ticket_code?: string | null;
  created_at: string;
}

/**
 * Comenzile utilizatorului curent, cu evenimentul alăturat (cea mai recentă
 * prima — ordinea o dă backendul, nu o rescriem aici).
 *
 * `ticket_code` vine doar pe comenzile `approved`; în rest e `null`, pentru că
 * un bilet neverificat n-are cod valid.
 */
export async function fetchMyTicketOrdersWithEvent(): Promise<TicketOrderListItem[]> {
  const { data } = await api.get<TicketOrderListResponse[]>('/ticket-orders/mine');
  return (data ?? []).map((o) => ({
    id: o.id,
    eventId: o.event_id ?? null,
    eventTitle: o.event_title,
    eventStartsAt: o.event_starts_at,
    status: o.status as TicketOrderStatus,
    price: o.price ?? null,
    currency: o.currency ?? null,
    reference: o.reference,
    ticketCode: o.ticket_code ?? null,
    createdAt: o.created_at,
  }));
}
