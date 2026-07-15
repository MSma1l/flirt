/**
 * Tap pe notificare → ecranul corect. Rutele testate aici există fizic în `app/`
 * (`app/chat/[id].tsx`, `app/(tabs)/mesaje.tsx`, `app/events/[id].tsx`).
 */
import { routeFromNotificationData } from '../pushRouting';

describe('routeFromNotificationData', () => {
  it('mesaj nou → conversația respectivă', () => {
    expect(routeFromNotificationData({ type: 'message', chatId: 'abc-123' })).toBe('/chat/abc-123');
  });

  it('match cu dialog creat → direct în conversație', () => {
    expect(routeFromNotificationData({ type: 'match', chatId: 'ch-9' })).toBe('/chat/ch-9');
  });

  it('match fără dialog → lista de mesaje', () => {
    expect(routeFromNotificationData({ type: 'match' })).toBe('/(tabs)/mesaje');
  });

  it('eveniment → pagina evenimentului', () => {
    expect(routeFromNotificationData({ type: 'event', eventId: 'ev-1' })).toBe('/events/ev-1');
  });

  it('payload fără `data` (ce trimite backend-ul azi) → nicio navigare, doar deschidem aplicația', () => {
    expect(routeFromNotificationData(undefined)).toBeNull();
    expect(routeFromNotificationData(null)).toBeNull();
    expect(routeFromNotificationData({})).toBeNull();
    expect(routeFromNotificationData({ type: 'necunoscut' })).toBeNull();
  });

  it('id malformat → refuzat (oricine cunoaște tokenul Expo poate trimite payload-uri)', () => {
    expect(routeFromNotificationData({ type: 'message', chatId: '../../paywall' })).toBeNull();
    expect(routeFromNotificationData({ type: 'message', chatId: 'https://evil.example' })).toBeNull();
    expect(routeFromNotificationData({ type: 'message', chatId: '' })).toBeNull();
    expect(routeFromNotificationData({ type: 'message', chatId: 42 })).toBeNull();
  });
});
