/**
 * Adresele ecranelor de chat, într-un singur loc.
 *
 * Lista de dialoguri construiește linkul spre o conversație, iar `ChatScreen`
 * citește același identificator din parametrul de rută — ca cele două să nu se
 * despartă, forma adresei stă aici.
 *
 * Prefixul vine din `@/features/onboarding/paths` (`CHATS_PATH`), unde tabela de
 * rute din `routes.tsx` își ține căile: dacă secțiunea se redenumește acolo,
 * linkurile de aici o urmează singure.
 */
import { CHATS_PATH } from '@/features/onboarding/paths';

/** Numele parametrului de rută, așa cum e declarat în `routes.tsx`. */
export const CHAT_ID_PARAM = 'chatId' as const;

/** Șablonul de rută pentru un dialog, ex. `/mesaje/:chatId`. */
export const CHAT_ROUTE_PATTERN = `${CHATS_PATH}/:${CHAT_ID_PARAM}`;

/** Adresa unui dialog concret. */
export function chatPath(chatId: string): string {
  return `${CHATS_PATH}/${encodeURIComponent(chatId)}`;
}
