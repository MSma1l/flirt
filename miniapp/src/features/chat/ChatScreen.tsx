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

import { compatColor, compatLabel } from '@mobile/features/feed/compat';
import { hasHtml } from '@mobile/utils/validation';

import { useAuthStore } from '@/auth/authStore';
import { AiAssistBar } from '@/features/ai';
import { cssVarColors } from '@/theme/tokens';

import { BlockDialog } from './BlockDialog';
import { ChatComposer } from './ChatComposer';
import { ChatIcon } from './ChatIcons';
import { MediaPreviewSheet } from './MediaPreviewSheet';
import { MessageBubble, type GroupPosition } from './MessageBubble';
import { ReportDialog } from './ReportDialog';
import {
  fetchChats,
  fetchMessagesPage,
  markRead,
  reactToMessage,
  sendMessage,
  uploadAttachment,
  type ChatMessageEx,
  type ChatSummaryEx,
  type MessagePage,
} from './chatApi';
import {
  makeObjectUrl,
  mediaErrorKey,
  prepareImage,
  revokeObjectUrl,
  uploadErrorReason,
  validateMedia,
  type MediaErrorReason,
  type MediaKind,
} from './chatMedia';
import { CHAT_ID_PARAM } from './chatRoutes';
import { usePollInterval } from './usePollInterval';
import { audioExtension, type VoiceRecording } from './useVoiceRecorder';

import './chat.css';

/** Conversația deschisă se reîmprospătează des — ca pe mobil. */
export const MESSAGES_POLL_MS = 3000;

/** Mesajele consecutive ale aceluiași emitent, la mai puțin de atât, formează un grup. */
const GROUP_GAP_MS = 5 * 60_000;

/** Un atașament încă netrimis: bula optimistă din capătul firului. */
interface PendingUpload {
  localId: string;
  kind: MediaKind;
  blob: Blob;
  fileName: string;
  caption: string;
  durationMs?: number;
  previewUrl: string;
  createdAt: string;
  status: 'uploading' | 'error';
  progress: number;
  errorReason?: MediaErrorReason;
}

let localCounter = 0;

/** Cheia zilei locale („2026-09-01"), pentru separatoarele de zi. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Unește paginile după `id` și le ordonează cronologic crescător. */
function mergeMessages(older: ChatMessageEx[], latest: ChatMessageEx[]): ChatMessageEx[] {
  const byId = new Map<string, ChatMessageEx>();
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
  const { t, i18n } = useTranslation(['chat', 'feed', 'auth', 'screens']);
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
  const [older, setOlder] = useState<ChatMessageEx[]>([]);
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
  const { data: chats } = useQuery<ChatSummaryEx[]>({
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


  /* ——— Atașamente: foaia de previzualizare, uploadul optimist, reîncercarea ——— */

  const [preview, setPreview] = useState<{ file: File; kind: 'image' | 'video' } | null>(null);
  const [mediaError, setMediaError] = useState<MediaErrorReason | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const pendingRef = useRef<PendingUpload[]>([]);
  pendingRef.current = pending;

  // La ieșirea din ecran eliberăm previzualizările locale.
  useEffect(
    () => () => {
      for (const p of pendingRef.current) revokeObjectUrl(p.previewUrl);
    },
    [],
  );

  const patchPending = useCallback((localId: string, patch: Partial<PendingUpload>) => {
    setPending((list) => list.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }, []);

  const runUpload = useCallback(
    async (item: PendingUpload) => {
      patchPending(item.localId, { status: 'uploading', progress: 0, errorReason: undefined });
      try {
        await uploadAttachment(chatId, item.blob, {
          fileName: item.fileName,
          ...(item.caption ? { caption: item.caption } : {}),
          ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
          onProgress: (fraction) => patchPending(item.localId, { progress: fraction }),
        });
        setPending((list) => list.filter((p) => p.localId !== item.localId));
        revokeObjectUrl(item.previewUrl);
        void queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
      } catch (error) {
        patchPending(item.localId, {
          status: 'error',
          errorReason: uploadErrorReason(error, item.kind),
        });
      }
    },
    [chatId, patchPending, queryClient],
  );

  const enqueue = useCallback(
    (item: Omit<PendingUpload, 'localId' | 'createdAt' | 'status' | 'progress' | 'previewUrl'>) => {
      localCounter += 1;
      const full: PendingUpload = {
        ...item,
        localId: `local-${Date.now()}-${localCounter}`,
        createdAt: new Date().toISOString(),
        status: 'uploading',
        progress: 0,
        previewUrl: makeObjectUrl(item.blob),
      };
      setPending((list) => [...list, full]);
      void runUpload(full);
    },
    [runUpload],
  );

  const onPickFile = useCallback((file: File) => {
    setMediaError(null);
    const check = validateMedia(file);
    if (!check.ok) {
      setMediaError(check.reason);
      return;
    }
    if (check.kind === 'voice') {
      setMediaError('unsupported');
      return;
    }
    setPreview({ file, kind: check.kind });
  }, []);

  const sendPreview = async (caption: string) => {
    if (!preview) return;
    const { file, kind } = preview;
    setPreview(null);
    if (kind === 'image') {
      const prepared = await prepareImage(file);
      enqueue({ kind, blob: prepared.blob, fileName: prepared.fileName, caption });
    } else {
      enqueue({ kind, blob: file, fileName: file.name || 'video.mp4', caption });
    }
  };

  const onVoice = useCallback(
    (rec: VoiceRecording) => {
      setMediaError(null);
      const check = validateMedia(rec.blob, rec.durationMs);
      if (!check.ok) {
        setMediaError(check.reason);
        return;
      }
      enqueue({
        kind: 'voice',
        blob: rec.blob,
        fileName: `voice-${Date.now()}.${audioExtension(rec.mime)}`,
        caption: '',
        durationMs: rec.durationMs,
      });
    },
    [enqueue],
  );

  const removePending = useCallback((localId: string) => {
    setPending((list) => {
      const item = list.find((p) => p.localId === localId);
      if (item) revokeObjectUrl(item.previewUrl);
      return list.filter((p) => p.localId !== localId);
    });
  }, []);

  // Derulăm la ultimul mesaj când apare unul nou (sau la prima încărcare).
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastId =
    pending.length > 0
      ? pending[pending.length - 1]?.localId
      : messages.length > 0
        ? messages[messages.length - 1]?.id
        : null;
  useEffect(() => {
    // Apel defensiv: `scrollIntoView` lipsește în jsdom și în WebView-uri vechi.
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lastId]);

  const trimmed = draft.trim();
  // Non-gol + ≤2000 (plafonat de `maxLength`) + fără marcaje HTML — simetric cu
  // `safe_str(MESSAGE_MAX_LENGTH)` din `backend/app/schemas/chat.py`.
  const draftError = trimmed.length > 0 && hasHtml(trimmed) ? t('auth:validation.noHtml') : null;
  const canSend = trimmed.length > 0 && !draftError && !sendMutation.isPending;

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    setMediaError(null);
  }, []);

  const onReact = useCallback(
    (messageId: string, reaction: string | null) =>
      reactMutation.mutate({ messageId, reaction }),
    [reactMutation],
  );

  /* ——— Firul: separatoare de zi + grupare ——— */

  const lang = i18n.language;
  const timeOf = useCallback(
    (iso: string): string => {
      const d = new Date(iso);
      return Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    },
    [lang],
  );
  const dayLabel = (iso: string): string => {
    const d = new Date(iso);
    const now = new Date();
    const key = dayKey(iso);
    if (key === dayKey(now.toISOString())) return t('screens:chat.day.today');
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (key === dayKey(yesterday.toISOString())) return t('screens:chat.day.yesterday');
    return d.toLocaleDateString(lang, {
      day: 'numeric',
      month: 'long',
      ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
  };

  const pendingMessages: { message: ChatMessageEx; item: PendingUpload }[] = pending.map((p) => ({
    item: p,
    message: {
      id: p.localId,
      senderId: currentUserId,
      body: p.caption,
      wasMasked: false,
      isRead: false,
      createdAt: p.createdAt,
      reaction: null,
      kind: p.kind,
      attachment: {
        url: p.previewUrl,
        mime: p.blob.type,
        sizeBytes: p.blob.size,
        durationMs: p.durationMs ?? null,
        width: null,
        height: null,
      },
    },
  }));
  const pendingById = new Map(pendingMessages.map((p) => [p.message.id, p.item]));
  const thread: ChatMessageEx[] = [...messages, ...pendingMessages.map((p) => p.message)];

  const sameGroup = (a: ChatMessageEx | undefined, b: ChatMessageEx | undefined): boolean => {
    if (!a || !b || a.senderId !== b.senderId) return false;
    if (dayKey(a.createdAt) !== dayKey(b.createdAt)) return false;
    const gap = Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return Number.isFinite(gap) && gap <= GROUP_GAP_MS;
  };

  const rows: React.ReactElement[] = [];
  thread.forEach((message, index) => {
    const prev = thread[index - 1];
    const next = thread[index + 1];
    const day = dayKey(message.createdAt);
    if (day && (!prev || dayKey(prev.createdAt) !== day)) {
      rows.push(
        <li key={`day-${day}`} className="chat-day" data-testid="day-separator">
          <span>{dayLabel(message.createdAt)}</span>
        </li>,
      );
    }
    const withPrev = sameGroup(prev, message);
    const withNext = sameGroup(message, next);
    const position: GroupPosition =
      withPrev && withNext ? 'middle' : withPrev ? 'last' : withNext ? 'first' : 'single';
    const item = pendingById.get(message.id);
    rows.push(
      <MessageBubble
        key={message.id}
        message={message}
        currentUserId={currentUserId}
        position={position}
        timeLabel={timeOf(message.createdAt)}
        {...(item
          ? {
              pending: {
                status: item.status,
                progress: item.progress,
                ...(item.errorReason ? { errorText: t(mediaErrorKey(item.errorReason)) } : {}),
                onRetry: () => void runUpload(item),
                onRemove: () => removePending(item.localId),
              },
            }
          : { onReact: (reaction: string | null) => onReact(message.id, reaction) })}
      />,
    );
  });

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
  } else if (thread.length === 0) {
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

        <ul className="chat-thread__list">{rows}</ul>
        <div ref={bottomRef} />
      </div>
    );
  }

  const subtitle = [summary?.otherAge, summary?.otherCity].filter(Boolean).join(' · ');

  let composerError: string | null = null;
  let composerErrorId: string | undefined;
  if (draftError) {
    composerError = draftError;
    composerErrorId = 'message-error';
  } else if (mediaError) {
    composerError = t(mediaErrorKey(mediaError));
    composerErrorId = 'media-error';
  } else if (sendMutation.isError) {
    composerError = t('chat:conversation.sendError');
    composerErrorId = 'send-error';
  }

  return (
    <div className="chat-screen">
      {/* Antetul conversației: identitatea celuilalt + acțiunile de siguranță.
          Navigarea ÎNAPOI nu e aici: ruta montează ecranul în `DeepScreen`,
          care leagă butonul nativ al Telegramului. Al doilea buton „înapoi" ar
          fi doar zgomot. */}
      <header className="chat-header">
        <span className="chat-header__avatar" aria-hidden="true">
          {summary?.otherPhotoUrl ? (
            <img src={summary.otherPhotoUrl} alt="" />
          ) : (
            headerName.trim().charAt(0).toUpperCase() || '?'
          )}
        </span>
        <div className="chat-header__info">
          <h2 className="chat-header__title">{headerName}</h2>
          {subtitle ? <span className="chat-header__subtitle">{subtitle}</span> : null}
        </div>
        {typeof summary?.compatibility === 'number' ? (
          <span
            className="chat-header__compat"
            style={{ '--compat-color': compatColor(summary.compatibility, cssVarColors) } as React.CSSProperties}
            aria-label={t('feed:compat.badge', {
              level: t(`feed:${compatLabel(summary.compatibility)}`),
              score: summary.compatibility,
            })}
          >
            <ChatIcon name="heart" size={12} />
            {summary.compatibility}%
          </span>
        ) : null}
        <button
          type="button"
          className="chat-icon-button chat-header__icon"
          data-testid="chat-report"
          aria-label={t('chat:conversation.report')}
          disabled={!otherUserId}
          onClick={() => setReportOpen(true)}
        >
          <ChatIcon name="flag" size={20} />
        </button>
        <button
          type="button"
          className="chat-icon-button chat-header__icon chat-header__icon--danger"
          data-testid="chat-block"
          aria-label={t('chat:conversation.block')}
          disabled={!otherUserId}
          onClick={() => setBlockOpen(true)}
        >
          <ChatIcon name="block" size={20} />
        </button>
      </header>

      {body}

      {/* Bara AI stă ÎNTRE fir și composer, deasupra câmpului de scriere: acolo
          se uită utilizatorul când se gândește ce să răspundă.
          Se randează singură DOAR dacă funcția e pornită din setări — inclusiv
          cererile spre `/ai` pleacă doar de acolo (vezi `features/ai/`).
          `onInsert` scrie în ciorna locală și ATÂT. Nu există și nu trebuie să
          existe o cale prin care sugestia să ajungă la `sendMutation`: un mesaj
          trimis automat ar vorbi în numele utilizatorului. */}
      <AiAssistBar chatId={chatId} otherUserId={otherUserId} onInsert={setDraft} />

      <ChatComposer
        draft={draft}
        onDraftChange={onDraftChange}
        canSend={canSend}
        onSubmit={() => sendMutation.mutate(trimmed)}
        errorText={composerError}
        {...(composerErrorId ? { errorTestId: composerErrorId } : {})}
        onPickFile={onPickFile}
        onVoice={onVoice}
      />

      {preview ? (
        <MediaPreviewSheet
          file={preview.file}
          kind={preview.kind}
          onCancel={() => setPreview(null)}
          onSend={(caption) => void sendPreview(caption)}
        />
      ) : null}

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
