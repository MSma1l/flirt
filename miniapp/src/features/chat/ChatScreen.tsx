/**
 * Ecranul de conversație (TZ secț. 5.2) pentru Mini App.
 *
 * PORT al lui `mobile/app/chat/[id].tsx`, cu o completare: PAGINAREA
 * istoricului, pe care mobilul nu o folosește (cere mereu doar ultima pagină).
 *
 * MODELUL DE DATE, gândit pentru polling ieftin:
 *   - o interogare POLLING pentru ULTIMA pagină de mesaje (cele mai noi ~50),
 *     exact ca pe mobil — o singură cerere la fiecare 3 secunde;
 *   - o stivă LOCALĂ de pagini mai vechi, încărcate la cerere prin cursorul
 *     `X-Next-Cursor` (vezi `chatApi.fetchMessagesPage`).
 *   Cele două se unesc după `id` la randare. Alternativa (`useInfiniteQuery` cu
 *   `refetchInterval`) ar fi reinterogat TOATE paginile la fiecare 3 secunde.
 *
 * LIMITA CUNOSCUTĂ a modelului: dacă între două poll-uri ar apărea mai multe
 * mesaje decât încape într-o pagină (50 în 3 secunde), fereastra „ultimei
 * pagini" ar sări peste unele; ele rămân accesibile prin „Încarcă mai multe".
 * Într-un dialog 1:1 cazul e teoretic.
 *
 * MASCAREA CONTACTELOR (TZ 5.5) e o REGULĂ DE PRODUS, nu un detaliu: serverul
 * înlocuiește datele de contact cu `****` ÎNAINTE de a salva mesajul
 * (`backend/app/services/contact_masker.py`). Ecranul afișează textul EXACT cum
 * vine de la server și nu încearcă niciodată să-l refacă; explicația pentru
 * utilizator e portată în `MessageBubble` (`chat:bubble.maskedHint`).
 *
 * Fără `alert()` / `confirm()`: dialogurile native blochează WebView-ul Telegram.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';

import type { ChatMessage, ChatSummary } from '@mobile/features/chat/types';
import { compatColor, compatLabel } from '@mobile/features/feed/compat';
import { hasHtml, LIMITS } from '@mobile/utils/validation';

import { useAuthStore } from '@/auth/authStore';
import { cssVarColors } from '@/theme/tokens';

import { BlockDialog } from './BlockDialog';
import { MessageBubble } from './MessageBubble';
import { ReportDialog } from './ReportDialog';
import {
  fetchChats,
  fetchMessagesPage,
  markRead,
  reactToMessage,
  sendMessage,
  type MessagePage,
} from './chatApi';
import { CHAT_ID_PARAM } from './chatRoutes';
import { usePollInterval } from './usePollInterval';

import './chat.css';

/** Conversația deschisă se reîmprospătează des — ca pe mobil. */
export const MESSAGES_POLL_MS = 3000;

/** Unește paginile după `id` și le ordonează cronologic crescător. */
function mergeMessages(older: ChatMessage[], latest: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of older) byId.set(m.id, m);
  // Pagina proaspătă are ultimul cuvânt: ea poartă reacțiile și `is_read` noi.
  for (const m of latest) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id.localeCompare(b.id)
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

export function ChatScreen() {
  const { t } = useTranslation(['chat', 'feed', 'auth']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Identificatorul conversației vine din parametrul de rută.
  const params = useParams();
  const chatId = params[CHAT_ID_PARAM] ?? '';

  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const refetchInterval = usePollInterval(MESSAGES_POLL_MS);

  const [draft, setDraft] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  // Paginile mai VECHI, încărcate la cerere. Rămân locale: polling-ul nu le
  // atinge, deci istoricul deschis nu se re-descarcă la fiecare 3 secunde.
  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderStarted, setOlderStarted] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState(false);

  const {
    data: page,
    isPending,
    isError,
    refetch,
    isFetching,
  } = useQuery<MessagePage>({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessagesPage(chatId),
    enabled: !!chatId,
    refetchInterval,
  });

  /**
   * Numele celuilalt vine din lista de dialoguri: backendul NU expune un
   * endpoint pentru un chat singular (`backend/app/api/v1/chat.py` are doar
   * `GET /chats/`). Folosim aceeași cheie `['chats']` ca lista, deci de obicei
   * datele sunt deja în cache; la intrare directă pe link, React Query le aduce.
   */
  const { data: chats } = useQuery<ChatSummary[]>({
    queryKey: ['chats'],
    queryFn: fetchChats,
  });
  const summary = chats?.find((c) => c.chatId === chatId);
  const headerName = summary?.otherName || t('chat:conversation.fallbackTitle');

  const latest = useMemo(() => page?.items ?? [], [page]);
  const messages = useMemo(() => mergeMessages(older, latest), [older, latest]);

  // Celălalt participant: primul emitent diferit de mine, altfel din rezumat.
  const otherUserId =
    messages.find((m) => m.senderId !== currentUserId)?.senderId ?? summary?.otherUserId ?? '';

  // Cursorul următoarei pagini de istoric: al ultimei pagini vechi încărcate,
  // sau, înainte de prima încărcare, al paginii proaspete.
  const historyCursor = olderStarted ? olderCursor : (page?.nextCursor ?? null);

  const loadOlder = useCallback(async () => {
    if (!historyCursor || olderLoading || !chatId) return;
    setOlderLoading(true);
    setOlderError(false);
    try {
      const older_ = await fetchMessagesPage(chatId, historyCursor);
      setOlder((prev) => mergeMessages(older_.items, prev));
      setOlderCursor(older_.nextCursor);
      setOlderStarted(true);
    } catch {
      setOlderError(true);
    } finally {
      setOlderLoading(false);
    }
  }, [chatId, historyCursor, olderLoading]);

  /**
   * Marcăm citit la deschidere ȘI de fiecare dată când sosește un mesaj primit
   * mai nou — utilizatorul îl are în fața ochilor, deci nu mai e „necitit".
   * Eșecul nu blochează conversația.
   */
  const lastIncomingId =
    [...latest].reverse().find((m) => m.senderId !== currentUserId)?.id ?? null;
  useEffect(() => {
    if (!chatId || !lastIncomingId) return;
    markRead(chatId)
      .then(() =>
        // `refetchType: 'none'` — marcăm lista ca învechită, dar NU declanșăm o
        // cerere acum: ea se reîncarcă oricum la următorul poll sau la
        // întoarcerea în listă. Altfel fiecare mesaj primit ar costa două
        // cereri (read + chats) în loc de una.
        queryClient.invalidateQueries({ queryKey: ['chats'], refetchType: 'none' }),
      )
      .catch(() => {
        /* marcarea e best-effort: eșecul nu blochează conversația */
      });
  }, [chatId, lastIncomingId, queryClient]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => sendMessage(chatId, body),
    onSuccess: () => {
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  const reactMutation = useMutation({
    mutationFn: (vars: { messageId: string; reaction: string | null }) =>
      reactToMessage(chatId, vars.messageId, vars.reaction),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    },
  });

  // Derulăm la ultimul mesaj când apare unul nou (sau la prima încărcare).
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastId = messages.length > 0 ? messages[messages.length - 1]?.id : null;
  useEffect(() => {
    // Apel defensiv: `scrollIntoView` lipsește în jsdom și în WebView-uri vechi.
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lastId]);

  const trimmed = draft.trim();
  // Non-gol + ≤2000 (plafonat de `maxLength`) + fără marcaje HTML — simetric cu
  // `safe_str(MESSAGE_MAX_LENGTH)` din `backend/app/schemas/chat.py`.
  const draftError = trimmed.length > 0 && hasHtml(trimmed) ? t('auth:validation.noHtml') : null;
  const canSend = trimmed.length > 0 && !draftError && !sendMutation.isPending;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    sendMutation.mutate(trimmed);
  };

  const onReact = useCallback(
    (messageId: string, reaction: string | null) =>
      reactMutation.mutate({ messageId, reaction }),
    [reactMutation],
  );

  let body: React.ReactElement;
  if (isPending) {
    body = (
      <div className="chat-state">
        <div className="spinner" role="status" aria-label={headerName} />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="chat-state" data-testid="messages-error">
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
  } else if (messages.length === 0) {
    body = (
      <div className="chat-state" data-testid="messages-empty">
        <p className="body-text">{t('chat:conversation.empty')}</p>
      </div>
    );
  } else {
    body = (
      <div className="chat-thread">
        {historyCursor ? (
          <div className="chat-thread__more">
            <button
              type="button"
              className="button button--ghost"
              data-testid="load-older"
              disabled={olderLoading}
              onClick={() => void loadOlder()}
            >
              {t('chat:loadMore')}
            </button>
            {olderError ? (
              <p className="error-text" data-testid="load-older-error">
                {t('chat:loadMoreError')}
              </p>
            ) : null}
          </div>
        ) : null}

        <ul className="chat-thread__list">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              currentUserId={currentUserId}
              onReact={(reaction) => onReact(message.id, reaction)}
            />
          ))}
        </ul>
        <div ref={bottomRef} />
      </div>
    );
  }

  return (
    <div className="chat-screen">
      {/* Antetul conversației: identitatea celuilalt + acțiunile de siguranță.
          Navigarea ÎNAPOI nu e aici: ruta montează ecranul în `DeepScreen`,
          care leagă butonul nativ al Telegramului. Al doilea buton „înapoi" ar
          fi doar zgomot. */}
      <header className="chat-header">
        <h2 className="chat-header__title">{headerName}</h2>
        {typeof summary?.compatibility === 'number' ? (
          <span
            className="chat-header__compat"
            style={{ background: compatColor(summary.compatibility, cssVarColors) }}
            aria-label={t('feed:compat.badge', {
              level: t(`feed:${compatLabel(summary.compatibility)}`),
              score: summary.compatibility,
            })}
          >
            {summary.compatibility}%
          </span>
        ) : null}
        <button
          type="button"
          className="chat-header__icon"
          data-testid="chat-report"
          aria-label={t('chat:conversation.report')}
          disabled={!otherUserId}
          onClick={() => setReportOpen(true)}
        >
          ⚠
        </button>
        <button
          type="button"
          className="chat-header__icon"
          data-testid="chat-block"
          aria-label={t('chat:conversation.block')}
          disabled={!otherUserId}
          onClick={() => setBlockOpen(true)}
        >
          🚫
        </button>
      </header>

      {body}

      <form className="chat-composer" onSubmit={handleSubmit}>
        {draftError ? (
          <p className="error-text" data-testid="message-error">
            {draftError}
          </p>
        ) : sendMutation.isError ? (
          <p className="error-text" data-testid="send-error">
            {t('chat:conversation.sendError')}
          </p>
        ) : null}

        <div className="chat-composer__row">
          <textarea
            className="chat-composer__input"
            value={draft}
            rows={1}
            maxLength={LIMITS.message}
            placeholder={t('chat:conversation.placeholder')}
            aria-label={t('chat:conversation.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="button" disabled={!canSend}>
            {t('chat:conversation.send')}
          </button>
        </div>
      </form>

      {reportOpen && otherUserId ? (
        <ReportDialog
          reportedUserId={otherUserId}
          chatId={chatId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}

      {blockOpen && otherUserId ? (
        <BlockDialog
          targetUserId={otherUserId}
          {...(summary?.otherName ? { targetName: summary.otherName } : {})}
          onClose={() => setBlockOpen(false)}
          onBlocked={() => {
            setBlockOpen(false);
            void navigate(-1);
          }}
        />
      ) : null}
    </div>
  );
}

export default ChatScreen;
