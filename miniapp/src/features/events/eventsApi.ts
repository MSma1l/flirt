/**
 * Stratul de rețea al modulului de evenimente — un SINGUR punct de trecere.
 *
 * DE CE EXISTĂ, dacă nu face decât să re-exporte:
 *
 * 1. UN SINGUR MODUL DE MOCKAT ÎN TESTE. Ecranele importă `./eventsApi`, iar
 *    testele scriu `vi.mock('../eventsApi')`. Dacă fiecare ecran ar importa
 *    direct din `@mobile/features/...`, fiecare test ar trebui să mockeze două
 *    module diferite (evenimente + bilete) și, mai rău, ar verifica axios în loc
 *    de deciziile ecranului.
 * 2. UN SINGUR PUNCT DE REUTILIZARE. Funcțiile din aplicația Expo sunt PURE
 *    (axios + mapare snake_case → camelCase, zero React Native) și ajung aici
 *    prin alias-ul `@mobile/`. `@/services/api` din interiorul lor e mapat pe
 *    clientul HTTP al Mini App-ului (vezi `tsconfig.json`), deci aceleași
 *    funcții vorbesc cu backendul cu tokenul de aici. Nicio linie copiată.
 * 3. Dacă mâine se schimbă o rută sau o mapare, se schimbă în aplicația mobilă
 *    și Mini App-ul primește schimbarea fără nicio editare.
 *
 * Rutele acoperite (`backend/app/api/v1/events.py`, `ticket_orders.py`):
 *   GET  /events/                      → fetchEvents
 *   GET  /events/{id}                  → fetchEvent (mapare locală, vezi mai jos)
 *   POST /events/{id}/going            → setGoing
 *   POST /events/{id}/checkin          → checkin
 *   GET  /ticket-orders/mine           → fetchMyTicketOrders
 *   POST /events/{id}/ticket-orders    → createTicketOrder
 *
 * Detaliul evenimentului are nevoie de ambele familii: evenimentul în sine și
 * comanda de bilet online pentru el, de aceea stau împreună în acest modul.
 */
import { api } from '@/api/client';
import type { EventItem as MobileEventItem } from '@mobile/features/events/types';

export {
  checkin,
  fetchEvents,
  setGoing,
} from '@mobile/features/events/eventsApi';

export { createTicketOrder } from '@mobile/features/tickets/ticketsApi';

// Comenzile vin prin modelul local (nu prin mapperul mobil): aceeași cheie de
// cache `['ticket-orders']` e citită și de ecranul de bilete, deci forma
// trebuie să fie identică în ambele locuri. Modelul cunoaște și stările
// cererilor manuale, pe care mapperul mobil nu le știe.
export { fetchMyTicketOrdersWithEvent as fetchMyTicketOrders } from '@/features/tickets/orderModel';

/**
 * Evenimentul, plus fereastra de vânzare online (contract nou, opțional):
 * `ticketSalesEndAt` = închiderea efectivă (ISO), `ticketSalesOpen` = verdictul
 * serverului acum. Pe un server vechi lipsesc → vânzarea e tratată ca deschisă.
 */
export interface EventItem extends MobileEventItem {
  ticketSalesEndAt?: string | null;
  ticketSalesOpen?: boolean | null;
}

type Raw = Record<string, unknown>;

/**
 * Detaliul unui eveniment. Mapat AICI (nu prin funcția mobilă) pentru că
 * mapperul mobil aruncă orice câmp pe care nu-l cunoaște — inclusiv fereastra
 * de vânzare. Restul mapării e identic cu cel din `mobile/`.
 */
export async function fetchEvent(id: string): Promise<EventItem> {
  const { data } = await api.get<Raw>(`/events/${encodeURIComponent(id)}`);
  const e = data ?? {};
  const optNum = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const optStr = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  return {
    id: String(e.id ?? ''),
    title: String(e.title ?? ''),
    description: String(e.description ?? ''),
    startsAt: String(e.starts_at ?? ''),
    city: String(e.city ?? ''),
    venue: String(e.venue ?? ''),
    lat: optNum(e.lat),
    lng: optNum(e.lng),
    kind: String(e.kind ?? ''),
    coverUrl: optStr(e.cover_url) ?? undefined,
    attendeeCount: typeof e.attendee_count === 'number' ? e.attendee_count : 0,
    iAmGoing: Boolean(e.i_am_going),
    promoDiscountPercent: typeof e.promo_discount_percent === 'number' ? e.promo_discount_percent : null,
    promoCode: optStr(e.promo_code),
    promoDescription: optStr(e.promo_description),
    ticketPrice: typeof e.ticket_price === 'number' ? e.ticket_price : null,
    ticketCurrency: optStr(e.ticket_currency),
    ticketSalesEndAt: optStr(e.ticket_sales_end_at),
    ticketSalesOpen: typeof e.ticket_sales_open === 'boolean' ? e.ticket_sales_open : null,
  };
}
export type { TicketOrderListItem as TicketOrder } from '@/features/tickets/orderModel';
