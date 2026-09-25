export const TICKET_REQUESTS_PATH = '/ticket-requests';
export const TICKET_REQUEST_ROUTE_PATTERN = '/events/:eventId/ticket-request';

export function ticketRequestPath(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}/ticket-request`;
}
