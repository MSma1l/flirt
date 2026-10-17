/** Căile modulului Stories. Vezi `features/events/eventRoutes.ts`. */
import { FEED_PATH } from '@/features/onboarding/paths';

/** Vizualizatorul de povești + crearea unei povești noi. */
export const STORIES_PATH = '/stories';

/**
 * Parametrul din adresa feedului care cere deschiderea poveștilor unui autor
 * (ex. din notificarea botului „X a publicat o poveste"). `StoriesStrip` îl
 * citește o singură dată și îl șterge din adresă.
 */
export const OPEN_STORY_PARAM = 'story' as const;

/** Feedul cu poveștile autorului dat deschise peste el. */
export function storiesDeepLinkPath(authorUserId: string): string {
  return `${FEED_PATH}?${OPEN_STORY_PARAM}=${encodeURIComponent(authorUserId)}`;
}
