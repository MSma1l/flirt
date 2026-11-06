/**
 * Textul scurt al unui mesaj citat: în citatul din bulă și în bara de răspuns /
 * editare de deasupra composerului.
 *
 * - mesaj șters → „Mesaj șters";
 * - media → eticheta tradusă („📷 Poză"), urmată de descriere dacă există;
 * - text → corpul (DEJA mascat de server), fără prefixul fix al răspunsurilor
 *   la povești.
 */
import type { TFunction } from 'i18next';

import type { MessageKind } from './chatApi';
import { splitStoryReply } from './storyReply';

/** Plafonul citatului — același ca pe server (`reply_to.body` ≤ 120). */
export const REPLY_SNIPPET_MAX = 120;

export interface SnippetSource {
  kind?: MessageKind | undefined;
  body: string;
  isDeleted?: boolean | undefined;
}

export function messageSnippet(t: TFunction, source: SnippetSource): string {
  if (source.isDeleted) return t('screens:chat.deleted');
  const body = (splitStoryReply(source.body) ?? source.body).trim();
  const kind = source.kind ?? 'text';
  if (kind !== 'text') {
    const label = t(`screens:chat.listPreview.${kind}`);
    return body ? `${label} · ${body}` : label;
  }
  return body.length > REPLY_SNIPPET_MAX ? `${body.slice(0, REPLY_SNIPPET_MAX)}…` : body;
}
