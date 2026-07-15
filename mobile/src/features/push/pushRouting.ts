/**
 * Traducerea payload-ului unei notificări în ruta din aplicație (expo-router).
 *
 * E o funcție PURĂ, separată de hook-uri, ca să poată fi testată fără module
 * native — și ca să fie evident ce contract așteptăm de la backend.
 *
 * CONTRACTUL cu backend-ul (câmpul `data` al mesajului Expo):
 *   { type: 'message', chatId: '<uuid>' }  → conversația respectivă
 *   { type: 'match',   chatId?: '<uuid>' } → conversația nouă sau lista de mesaje
 *   { type: 'event',   eventId: '<uuid>' } → pagina evenimentului
 *
 * Orice altceva → `null` = deschidem doar aplicația, fără navigare. Preferăm să
 * nu ducem userul nicăieri decât să-l aruncăm pe un ecran ghicit.
 */
import type { Href } from 'expo-router';

/**
 * ID-urile din payload ajung direct într-o cale de navigare, iar payload-ul NU
 * e de încredere prin definiție: oricine cunoaște un token Expo îi poate trimite
 * mesaje dispozitivului (Expo nu cere autentificare pentru trimitere decât dacă
 * activezi „push security"). Acceptăm deci doar identificatori opaci — litere,
 * cifre, `-` și `_` — ca un `../` sau o cale absolută să nu poată fi injectate.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function readId(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : null;
}

/**
 * Ruta corespunzătoare notificării, sau `null` dacă payload-ul nu spune clar
 * unde trebuie dus userul (inclusiv cazul de azi, în care backend-ul trimite
 * doar `{title, body}`, fără `data`).
 */
export function routeFromNotificationData(data: unknown): Href | null {
  if (typeof data !== 'object' || data === null) return null;

  const payload = data as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type : null;

  switch (type) {
    case 'message': {
      const chatId = readId(payload, 'chatId');
      return chatId ? `/chat/${chatId}` : null;
    }

    case 'match': {
      // Un match creează dialogul; dacă backend-ul îl trimite, mergem direct în
      // conversație, altfel lăsăm userul în lista de mesaje — tot e locul corect.
      const chatId = readId(payload, 'chatId');
      return chatId ? `/chat/${chatId}` : '/(tabs)/mesaje';
    }

    case 'event': {
      const eventId = readId(payload, 'eventId');
      return eventId ? `/events/${eventId}` : '/events';
    }

    default:
      return null;
  }
}
