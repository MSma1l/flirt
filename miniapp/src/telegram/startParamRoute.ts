/**
 * Ecranul de pornire după parametrul de start al botului.
 *
 * Butoanele botului („Evenimente", „Biletele mele", „Confidențialitate")
 * deschid Mini App-ul cu `?startapp=events|tickets|privacy`. `MemoryRouter`
 * pornește implicit de la `/`, deci fără maparea asta toate ar ateriza în feed.
 *
 * Notificările botului (mesaj nou, like, match, poveste) poartă și ele un
 * buton `web_app` cu un parametru care țintește un ecran anume:
 *   `chat_<uuid>`    → conversația aceea;
 *   `stories_<uuid>` → feedul, cu poveștile autorului deschise peste el;
 *   `likes`          → feedul (Mini App-ul nu are încă ecranul „Ți-au dat like");
 *   `feed`           → feedul.
 * UUID-ul se VALIDEAZĂ: parametrul vine dintr-un link pe care îl poate scrie
 * oricine, iar un identificator nevalid ar deschide o conversație care dă 404.
 *
 * Doar valorile cunoscute schimbă ruta: alți parametri (ex. coduri de invitație
 * din `/start <cod>`) au alt rost și lasă pornirea neschimbată. Porțile de
 * autentificare, acord și onboarding rămân în fața oricărei rute.
 */
import { chatPath } from '@/features/chat/chatRoutes';
import { EVENTS_PATH } from '@/features/events/eventRoutes';
import { LEGAL_HUB_PATH } from '@/features/legal/legalRoutes';
import { FEED_PATH } from '@/features/onboarding/paths';
import { storiesDeepLinkPath } from '@/features/stories/storyRoutes';
import { TICKETS_PATH } from '@/features/tickets/ticketRoutes';

const START_ROUTES: Readonly<Record<string, string>> = {
  events: EVENTS_PATH,
  tickets: TICKETS_PATH,
  privacy: LEGAL_HUB_PATH,
  // Feedul e rădăcina aplicației (`/` cade pe `/feed`), deci pornim de la `/`.
  feed: '/',
  likes: '/',
};

/** UUID canonic (cu cratime) sau compact (32 hex) — ambele se normalizează. */
const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/;

/** Forma canonică `8-4-4-4-12`, cu litere mici, sau `null` dacă nu e UUID. */
export function normalizeUuid(raw: string): string | null {
  const value = raw.toLowerCase();
  if (!UUID_RE.test(value)) return null;
  const hex = value.replace(/-/g, '');
  // Cratimele parțiale („a-bc…") trec de regex, dar lungimea le prinde.
  if (hex.length !== 32 || (value.length !== 32 && value.length !== 36)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parametrii cu identificator: `<prefix>_<uuid>` → calea ecranului. */
const PREFIXED_ROUTES: Readonly<Record<string, (id: string) => string>> = {
  chat: chatPath,
  stories: storiesDeepLinkPath,
};

export function initialPathFromStartParam(param: string | null): string {
  if (!param) return '/';
  const value = param.trim().toLowerCase();
  const fixed = START_ROUTES[value];
  if (fixed) return fixed;

  const sep = value.indexOf('_');
  if (sep > 0) {
    const build = PREFIXED_ROUTES[value.slice(0, sep)];
    const id = normalizeUuid(value.slice(sep + 1));
    if (build && id) return build(id);
  }
  return '/';
}

/** Feedul (cu sau fără parametri) e rădăcina: nu are ce pune dedesubt. */
function isRootPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0] ?? '';
  return pathname === '/' || pathname === FEED_PATH;
}

/**
 * Istoricul inițial al routerului pentru o cale de start.
 *
 * Un ecran de start în adâncime (ex. `/tickets`, o conversație) primește `/`
 * dedesubt: altfel `navigate(-1)` din `DeepScreen` n-ar avea unde să întoarcă
 * și butonul ÎNAPOI (nativ sau din antet) n-ar face nimic. Feedul însuși NU
 * primește încă un feed dedesubt — ÎNAPOI ar duce în același ecran.
 */
export function initialEntriesForStartPath(path: string): string[] {
  return isRootPath(path) ? [path] : ['/', path];
}
