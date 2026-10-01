/**
 * Căile modulului de bilete. Vezi `features/events/eventRoutes.ts` pentru de ce
 * adresele stau în constante, nu scrise cu mâna în ecrane.
 */

/** Biletul propriu Flirt Party + comenzile de bilete la evenimente. */
export const TICKETS_PATH = '/tickets';

/**
 * Parametrul de interogare care deschide direct o comandă (`/tickets?order=…`).
 * Query, nu rută nouă: harta rutelor aparține altui modul, iar ecranul de
 * bilete rămâne unul singur.
 */
export const TICKET_ORDER_PARAM = 'order';

/** Ecranul de bilete, cu o comandă deschisă. */
export function ticketOrderPath(orderId: string): string {
  return `${TICKETS_PATH}?${TICKET_ORDER_PARAM}=${encodeURIComponent(orderId)}`;
}
