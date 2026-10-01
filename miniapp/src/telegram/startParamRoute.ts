/**
 * Ecranul de pornire după parametrul de start al botului.
 *
 * Butoanele botului („Evenimente", „Biletele mele", „Confidențialitate")
 * deschid Mini App-ul cu `?startapp=events|tickets|privacy`. `MemoryRouter`
 * pornește implicit de la `/`, deci fără maparea asta toate ar ateriza în feed.
 *
 * Doar valorile cunoscute schimbă ruta: alți parametri (ex. coduri de invitație
 * din `/start <cod>`) au alt rost și lasă pornirea neschimbată. Porțile de
 * autentificare, acord și onboarding rămân în fața oricărei rute.
 */
import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { LEGAL_HUB_PATH } from '@/features/legal/legalRoutes';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';

const START_ROUTES: Readonly<Record<string, string>> = {
  events: EVENTS_PATH,
  tickets: TICKETS_PATH,
  privacy: LEGAL_HUB_PATH,
};

export function initialPathFromStartParam(param: string | null): string {
  if (!param) return '/';
  return START_ROUTES[param.trim().toLowerCase()] ?? '/';
}
