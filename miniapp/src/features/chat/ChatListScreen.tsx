/**
 * Lista de dialoguri (TZ secț. 5.1) pentru Mini App.
 *
 * PORT al lui `mobile/app/(tabs)/mesaje.tsx`, cu aceeași împărțire pe secțiuni:
 *   1. „Match nou"   — dialoguri cu mesaje NEcitite sau proaspete, fără mesaj încă;
 *   2. „Conversații" — restul, citite.
 * Secțiunile goale nu se randează: un antet fără rânduri sub el e spațiu mort.
 *
 * NU sunt portate secțiunile „Ți-au dat like" / „În așteptare"
 * (`ReceivedLikesSection` / `PendingLikesSection`): ele țin de modulul social,
 * nu de chat, și nu sunt în perimetrul acestui ecran.
 *
 * Datele vin din `GET /chats/` (`backend/app/api/v1/chat.py::list_chats`),
 * reinterogat periodic. Polling-ul se OPREȘTE când fereastra nu e vizibilă —
 * vezi `usePollInterval`.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatSummary } from '@mobile/features/chat/types';

import { ChatListRow } from './ChatListRow';
import { fetchChats } from './chatApi';
import { usePollInterval } from './usePollInterval';

import './chat.css';

/**
 * Lista e polling, nu realtime. 12s e compromisul din aplicația nativă: se
 * actualizează singură, dar cu mult mai puțin trafic decât la 3s (interval
 * rezervat conversației deschise, unde chiar contează).
 */
export const CHATS_POLL_MS = 12000;

/**
 * Un dialog e „nou / necitit" dacă are mesaje necitite SAU e proaspăt, fără
 * niciun mesaj încă (`lastMessage` lipsă). Regula e copiată 1:1 din mobil ca
 * gruparea să fie identică în ambele aplicații.
 */
function isNewOrUnread(chat: ChatSummary): boolean {
  return chat.unreadCount > 0 || !chat.lastMessage;
}

interface Section {
  key: 'new' | 'active';
  title: string;
  hint?: string;
  rows: ChatSummary[];
}

export function ChatListScreen() {
  const { t } = useTranslation(['chat', 'common']);
  const refetchInterval = usePollInterval(CHATS_POLL_MS);

  const { data, isPending, isError, refetch, isFetching } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
    refetchInterval,
  });

  const chats = data ?? [];
  const allSections: Section[] = [
    {
      key: 'new',
      title: t('chat:sections.newTitle'),
      hint: t('chat:sections.newHint'),
      rows: chats.filter(isNewOrUnread),
    },
    {
      key: 'active',
      title: t('chat:sections.activeTitle'),
      rows: chats.filter((c) => !isNewOrUnread(c)),
    },
  ];
  const sections = allSections.filter((s) => s.rows.length > 0);

  let body: ReactElement;
  if (isPending) {
    body = (
      <div className="chat-state">
        <div className="spinner" role="status" aria-label={t('chat:title')} />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="chat-state" data-testid="chats-error">
        <p className="error-text">{t('chat:loadError')}</p>
        <button
          type="button"
          className="button"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          {t('chat:retry')}
        </button>
      </div>
    );
  } else if (chats.length === 0) {
    body = (
      <div className="chat-state" data-testid="chats-empty">
        <p className="body-text">{t('chat:empty')}</p>
        <p className="caption">{t('chat:noConversations')}</p>
      </div>
    );
  } else {
    body = (
      <div className="chat-list__sections">
        {sections.map((section) => (
          <section key={section.key} className="chat-list__section">
            <h2 className="chat-list__section-title">{section.title}</h2>
            {section.hint ? <p className="caption">{section.hint}</p> : null}
            <ul className="chat-list__rows">
              {section.rows.map((chat) => (
                <ChatListRow key={chat.chatId} chat={chat} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="chat-list">
      <h1 className="title chat-list__title">{t('chat:title')}</h1>
      {body}
    </div>
  );
}

export default ChatListScreen;
