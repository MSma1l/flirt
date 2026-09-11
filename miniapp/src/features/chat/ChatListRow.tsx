/**
 * Un rând din lista de dialoguri: inițială-avatar, nume, pastilă de
 * compatibilitate, ora ultimului mesaj, previzualizare și badge de necitite.
 *
 * PORT DOM al lui `mobile/src/features/chat/ChatListItem.tsx`. Structura și
 * textele sunt aceleași; se schimbă doar stratul de randare (`<a>` + CSS în loc
 * de `Pressable` + `StyleSheet`). Pragurile de culoare ale compatibilității sunt
 * REUTILIZATE din `@mobile/features/feed/compat`, alimentate cu `cssVarColors`,
 * care întoarce `var(--color-…)` — valid direct ca valoare CSS.
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { compatColor, compatLabel } from '@mobile/features/feed/compat';
import type { ChatSummary } from '@mobile/features/chat/types';

import { cssVarColors } from '@/theme/tokens';

import { chatPath } from './chatRoutes';

interface Props {
  chat: ChatSummary;
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function ChatListRowBase({ chat }: Props) {
  // Textele rândului sunt în `chat`; eticheta de compatibilitate stă în `feed`,
  // acolo unde e definită și regula scorului.
  const { t, i18n } = useTranslation(['chat', 'feed']);
  const hasUnread = chat.unreadCount > 0;

  /**
   * Timp scurt relativ: „acum", „5 min", „3 h", „2 z", altfel data.
   * Data de peste o săptămână se formatează cu LIMBA INTERFEȚEI, nu cu una
   * fixă — altfel un utilizator rus ar vedea „3 sept." în română.
   */
  const shortTime = (iso?: string): string => {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const diffMin = Math.floor((Date.now() - then) / 60000);
    if (diffMin < 1) return t('chat:list.time.now');
    if (diffMin < 60) return t('chat:list.time.minutes', { value: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t('chat:list.time.hours', { value: diffH });
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return t('chat:list.time.days', { value: diffD });
    return new Date(iso).toLocaleDateString(i18n.language, {
      day: 'numeric',
      month: 'short',
    });
  };

  return (
    <li className="chat-row__item">
      <Link className="chat-row" to={chatPath(chat.chatId)} data-testid="chat-row">
        <span className="chat-row__avatar" aria-hidden="true">
          {initial(chat.otherName)}
        </span>

        <span className="chat-row__body">
          <span className="chat-row__top">
            <span className="chat-row__name">{chat.otherName}</span>
            <span
              className="chat-row__compat"
              data-testid="chat-row-compat"
              style={{ background: compatColor(chat.compatibility, cssVarColors) }}
              aria-label={t('feed:compat.badge', {
                level: t(`feed:${compatLabel(chat.compatibility)}`),
                score: chat.compatibility,
              })}
            >
              {chat.compatibility}%
            </span>
            <time className="chat-row__time" dateTime={chat.lastMessageAt ?? undefined}>
              {shortTime(chat.lastMessageAt)}
            </time>
          </span>

          <span className="chat-row__bottom">
            <span
              className={
                hasUnread ? 'chat-row__preview chat-row__preview--unread' : 'chat-row__preview'
              }
            >
              {/* Previzualizarea vine de la server DEJA mascată — o afișăm ca atare. */}
              {chat.lastMessage ?? t('chat:list.noMessages')}
            </span>
            {hasUnread ? (
              <span
                className="chat-row__unread"
                data-testid="chat-row-unread"
                aria-label={t('chat:list.unread', { count: chat.unreadCount })}
              >
                {chat.unreadCount}
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Memoizat: la fiecare poll al listei, un rând nemodificat nu se re-randează. */
export const ChatListRow = memo(ChatListRowBase);
