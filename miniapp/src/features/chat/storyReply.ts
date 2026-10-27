/**
 * Răspunsurile la povești ajung în chat ca mesaje text obișnuite, cu un
 * prefix FIX în română pus de server:
 *   `backend/app/services/story_service.py::STORY_REPLY_PREFIX`
 *   = "↩️ A răspuns la povestea ta: "
 *
 * Stocarea rămâne așa (compatibilă cu mesajele vechi și cu aplicația nativă);
 * Mini App-ul recunoaște prefixul și îl înlocuiește la AFIȘARE cu un text din
 * cataloagele i18n — altfel un utilizator rus sau englez vede românește.
 *
 * Șirul de mai jos e un MARCAJ de protocol venit de la server, nu un text de
 * interfață — nu se traduce aici.
 */

/** Prefixul exact de pe server (sincron cu `STORY_REPLY_PREFIX`). */
export const STORY_REPLY_SERVER_PREFIX = '↩️ A răspuns la povestea ta: ';

/**
 * Toleranță: emoji-ul cu sau fără selectorul de variantă (U+FE0F), spații
 * multiple după două puncte. Ancorat la începutul textului.
 */
const PREFIX_RE = /^↩️?\s*A răspuns la povestea ta:\s*/;

/** Textul mesajului fără prefix, sau `null` dacă nu e un răspuns la poveste. */
export function splitStoryReply(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = PREFIX_RE.exec(body);
  return match ? body.slice(match[0].length) : null;
}
