/**
 * Căile rutelor modulului de evenimente.
 *
 * Există ca fișier separat din același motiv ca `features/chat/chatRoutes.ts`:
 * harta rutelor (`src/routes.tsx`) aparține altui agent, iar ecranele care fac
 * legături între ele (lista → detaliu, detaliul → bilete) nu au voie să scrie
 * adrese cu mâna. O singură constantă, importată din ambele părți, face ca o
 * eventuală redenumire să fie o singură editare.
 */

/** Lista de evenimente. */
export const EVENTS_PATH = '/events';

/** Tiparul rutei de detaliu, pentru `<Route path=…>`. */
export const EVENT_ROUTE_PATTERN = '/events/:eventId';

/** Numele parametrului din tipar, pentru `useParams()`. */
export const EVENT_ID_PARAM = 'eventId';

/** Adresa detaliului unui eveniment. */
export function eventPath(eventId: string): string {
  return `${EVENTS_PATH}/${encodeURIComponent(eventId)}`;
}
