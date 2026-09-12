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
 *   GET  /events/{id}                  → fetchEvent
 *   POST /events/{id}/going            → setGoing
 *   POST /events/{id}/checkin          → checkin
 *   GET  /ticket-orders/mine           → fetchMyTicketOrders
 *   POST /events/{id}/ticket-orders    → createTicketOrder
 *
 * Detaliul evenimentului are nevoie de ambele familii: evenimentul în sine și
 * comanda de bilet online pentru el, de aceea stau împreună în acest modul.
 */
export {
  checkin,
  fetchEvent,
  fetchEvents,
  setGoing,
} from '@mobile/features/events/eventsApi';

export {
  createTicketOrder,
  fetchMyTicketOrders,
} from '@mobile/features/tickets/ticketsApi';

export type { EventItem } from '@mobile/features/events/types';
export type { TicketOrder } from '@mobile/features/tickets/types';
