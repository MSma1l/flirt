export const TICKET_REQUESTS_PATH = '/ticket-requests';
export const TICKET_REQUEST_ROUTE_PATTERN = '/events/:eventId/ticket-request';

/** `tierId` = tipul de bilet ales pe pagina evenimentului (preselectat în formular). */
export function ticketRequestPath(eventId: string, tierId?: string | null): string {
  const base = `/events/${encodeURIComponent(eventId)}/ticket-request`;
  return tierId ? `${base}?tier=${encodeURIComponent(tierId)}` : base;
}
