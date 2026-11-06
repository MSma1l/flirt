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
 * ACȚIUNILE PE MESAJ (apăsare lungă / atingere / clic-dreapta pe bulă): un
 * singur `MessageActionMenu` pentru tot firul — reacții, Răspunde, Copiază,
 * Editează (doar text propriu), Șterge (doar mesaj propriu, cu confirmare în
 * `DeleteMessageDialog`). Glisarea spre stânga pe bulă = Răspunde.
 * Răspunsurile din PATCH / DELETE se aplică IMEDIAT în cache-ul React Query și
 * în paginile vechi locale; poll-ul următor aduce oricum aceeași stare.
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
import { haptic } from '@/telegram/bridge';
import { Photo } from '@/components/Photo';
import { AiAssistBar } from '@/features/ai';
import { cssVarColors } from '@/theme/tokens';

import { BlockDialog } from './BlockDialog';
import { ChatComposer } from './ChatComposer';
import { ChatIcon } from './ChatIcons';
import { DeleteMessageDialog } from './DeleteMessageDialog';
import { MediaPreviewSheet } from './MediaPreviewSheet';
import {
  MessageActionMenu,
  type MenuAnchor,
  type MessageAction,
} from './MessageActionMenu';
import { MessageBubble, type GroupPosition } from './MessageBubble';
import { ReportDialog } from './ReportDialog';
import {
  editMessage,
  fetchChats,
  fetchMessagesPage,
  markRead,
  reactToMessage,
  sendMessage,
  uploadAttachment,
  type ChatMessageEx,
  type ChatSummaryEx,
  type MessagePage,
  type ReplyRef,
} from './chatApi';
import {
  makeObjectUrl,
  mediaErrorKey,
  prepareImage,
  revokeObjectUrl,
  uploadErrorReason,
  validateMedia,
  validateVideoNote,
  type MediaErrorReason,
  type MediaKind,
} from './chatMedia';
import { CHAT_ID_PARAM, chatProfilePath } from './chatRoutes';
import { messageSnippet, REPLY_SNIPPET_MAX } from './replyPreview';
import { splitStoryReply } from './storyReply';
import { usePollInterval } from './usePollInterval';
import { videoExtension, type VideoNoteRecording } from './useVideoNoteRecorder';
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
  /** Mesajul la care atașamentul răspunde (fixat în momentul trimiterii). */
  replyTo?: ReplyRef;
}

let localCounter = 0;

/** Cât rămâne evidențiat mesajul la care s-a sărit dintr-un citat. */
const HIGHLIGHT_MS = 1600;

/** Referința de citat a unui mesaj din fir (pentru bula optimistă). */
function toReplyRef(m: ChatMessageEx): ReplyRef {
  return {
    id: m.id,
    senderId: m.senderId,
    body: m.isDeleted || (m.kind && m.kind !== 'text') ? '' : m.body.slice(0, REPLY_SNIPPET_MAX),
    kind: m.kind ?? 'text',
    isDeleted: !!m.isDeleted,
  };
}

/**
 * Înlocuiește în listă mesajul actualizat (editat / șters) și împrospătează
 * citatele care îl referă — fără să aștepte poll-ul.
 */
function patchMessages(list: ChatMessageEx[], updated: ChatMessageEx): ChatMessageEx[] {
  let changed = false;
  const next = list.map((m) => {
    if (m.id === updated.id) {
      changed = true;
      return updated;
    }
    if (m.replyTo && m.replyTo.id === updated.id) {
      changed = true;
      const textual = m.replyTo.kind === 'text';
      return {
        ...m,
        replyTo: {
          ...m.replyTo,
          body: updated.isDeleted || !textual ? '' : updated.body.slice(0, REPLY_SNIPPET_MAX),
          isDeleted: !!updated.isDeleted,
        },
      };
    }
    return m;
  });
  return changed ? next : list;
}

/**
 * Dintre două copii ale aceluiași mesaj, cea mai NOUĂ: ștergerea e definitivă,
 * apoi editarea mai recentă; la egalitate câștigă `b` (sursa mai proaspătă).
 * Așa un poll pornit ÎNAINTE de o editare nu readuce textul vechi.
 */
function fresher(a: ChatMessageEx, b: ChatMessageEx): ChatMessageEx {
  if (!!a.isDeleted !== !!b.isDeleted) return a.isDeleted ? a : b;
  const ea = a.editedAt ?? '';
  const eb = b.editedAt ?? '';
  return ea > eb ? a : b;
}

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
  // Pagina proaspătă are ultimul cuvânt (reacțiile și `is_read` noi) — cu
  // excepția unei copii vechi a unui mesaj deja editat / șters local.
  for (const m of latest) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? fresher(prev, m) : m);
  }
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

  // Acțiunile pe mesaj: meniul deschis, ținta răspunsului, editarea, ștergerea.
  const [menu, setMenu] = useState<{ message: ChatMessageEx; anchor: MenuAnchor } | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessageEx | null>(null);
  const [editing, setEditing] = useState<ChatMessageEx | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessageEx | null>(null);
  const [editError, setEditError] = useState<'generic' | 'deleted' | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Ciorna de dinainte de editare: Anulează o readuce.
  const savedDraftRef = useRef('');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const replyToRef = useRef<ChatMessageEx | null>(null);
  replyToRef.current = replyTo;

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
    mutationFn: (vars: { body: string; replyToId: string | null }) =>
      // Fără răspuns, apelul e identic cu cel de dinainte (`{body}`).
      vars.replyToId
        ? sendMessage(chatId, vars.body, vars.replyToId)
        : sendMessage(chatId, vars.body),
    onSuccess: () => {
      setDraft('');
      setReplyTo(null);
      void queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });

  /**
   * Aplică imediat un mesaj întors de server (editat / șters) — în pagina
   * proaspătă din cache și în paginile vechi locale. Un poll aflat în zbor e
   * anulat întâi: altfel ar putea rescrie cache-ul cu copia de dinainte.
   */
  const applyServerMessage = useCallback(
    async (updated: ChatMessageEx) => {
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] });
      queryClient.setQueryData<MessagePage>(['messages', chatId], (prev) =>
        prev ? { ...prev, items: patchMessages(prev.items, updated) } : prev,
      );
      setOlder((prev) => patchMessages(prev, updated));
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    [chatId, queryClient],
  );

  const editMutation = useMutation({
    mutationFn: (vars: { id: string; body: string }) => editMessage(chatId, vars.id, vars.body),
    onSuccess: async (updated) => {
      await applyServerMessage(updated);
      setEditing(null);
      setDraft(savedDraftRef.current);
      savedDraftRef.current = '';
    },
    onError: (error) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      setEditError(status === 409 ? 'deleted' : 'generic');
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
          ...(item.kind === 'video_note' ? { kind: 'video_note' as const } : {}),
          ...(item.replyTo ? { replyToId: item.replyTo.id } : {}),
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
    (
      item: Omit<
        PendingUpload,
        'localId' | 'createdAt' | 'status' | 'progress' | 'previewUrl' | 'replyTo'
      >,
    ) => {
      localCounter += 1;
      // Răspunsul activ pleacă împreună cu atașamentul, apoi bara se închide.
      const target = replyToRef.current;
      if (target) setReplyTo(null);
      const full: PendingUpload = {
        ...item,
        ...(target ? { replyTo: toReplyRef(target) } : {}),
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
    if (check.kind !== 'image' && check.kind !== 'video') {
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

  const onVideoNote = useCallback(
    (rec: VideoNoteRecording) => {
      setMediaError(null);
      const check = validateVideoNote(rec.blob, rec.durationMs);
      if (!check.ok) {
        setMediaError(check.reason);
        return;
      }
      enqueue({
        kind: 'video_note',
        blob: rec.blob,
        fileName: `video-note-${Date.now()}.${videoExtension(rec.mime)}`,
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
  const busy = editing ? editMutation.isPending : sendMutation.isPending;
  const canSend = trimmed.length > 0 && !draftError && !busy;

  const onDraftChange = useCallback((value: string) => {
    setDraft(value);
    setMediaError(null);
    setEditError(null);
  }, []);

  /* ——— Acțiunile pe mesaj ——— */

  const focusComposer = useCallback(() => setFocusToken((n) => n + 1), []);

  /** Iese din editare și readuce ciorna de dinainte. */
  const leaveEdit = useCallback(() => {
    setEditing(null);
    setEditError(null);
    setDraft(savedDraftRef.current);
    savedDraftRef.current = '';
  }, []);

  const editingRef = useRef<ChatMessageEx | null>(null);
  editingRef.current = editing;

  const startReply = useCallback(
    (message: ChatMessageEx) => {
      if (message.isDeleted) return;
      // Răspunsul și editarea se exclud: ieșim din editare, cu ciorna înapoi.
      if (editingRef.current) leaveEdit();
      setReplyTo(message);
      focusComposer();
    },
    [focusComposer, leaveEdit],
  );

  const startEdit = useCallback(
    (message: ChatMessageEx) => {
      // Ciorna se salvează o singură dată, la intrarea în modul de editare.
      if (!editingRef.current) savedDraftRef.current = draftRef.current;
      setReplyTo(null);
      setEditError(null);
      setEditing(message);
      setDraft(message.body);
      focusComposer();
    },
    [focusComposer],
  );

  const onOpenMenu = useCallback((message: ChatMessageEx, anchor: MenuAnchor) => {
    setMenu({ message, anchor });
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const onSwipeReply = useCallback((message: ChatMessageEx) => startReply(message), [startReply]);

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  /** Saltul din citat la mesajul original, dacă e încărcat în fir. */
  const onQuoteClick = useCallback((messageId: string) => {
    const el = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).find(
      (node) => node.dataset.messageId === messageId,
    );
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setHighlightId(messageId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
  }, []);

  const onMenuAction = (action: MessageAction) => {
    const target = menuMessage;
    setMenu(null);
    if (!target) return;
    if (action === 'reply') startReply(target);
    else if (action === 'edit') startEdit(target);
    else if (action === 'delete') setDeleteTarget(target);
    else {
      const text = splitStoryReply(target.body) ?? target.body;
      try {
        void navigator.clipboard?.writeText(text).then(
          () => haptic('light'),
          () => {},
        );
      } catch {
        /* clipboard indisponibil în acest WebView */
      }
    }
  };

  const onMenuReact = (emoji: string) => {
    const target = menuMessage;
    setMenu(null);
    if (!target) return;
    // Re-selectarea aceleiași reacții o scoate.
    reactMutation.mutate({
      messageId: target.id,
      reaction: target.reaction === emoji ? null : emoji,
    });
  };

  const onDeleted = useCallback(
    (deleted: ChatMessageEx) => {
      setDeleteTarget(null);
      void applyServerMessage(deleted);
      // Mesajul șters nu mai poate fi nici citat, nici editat.
      setReplyTo((current) => (current?.id === deleted.id ? null : current));
      if (editingRef.current?.id === deleted.id) leaveEdit();
    },
    [applyServerMessage, leaveEdit],
  );

  const onComposerSubmit = () => {
    if (editing) {
      // Text neschimbat: doar ieșim din editare, fără cerere.
      if (trimmed === editing.body.trim()) {
        leaveEdit();
        return;
      }
      editMutation.mutate({ id: editing.id, body: trimmed });
      return;
    }
    sendMutation.mutate({ body: trimmed, replyToId: replyTo?.id ?? null });
  };

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
      replyTo: p.replyTo ?? null,
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

  const partnerName = summary?.otherName || t('chat:conversation.fallbackTitle');
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
        partnerName={partnerName}
        highlighted={highlightId === message.id}
        onQuoteClick={onQuoteClick}
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
          : { onOpenMenu, onSwipeReply })}
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

  const openProfile = () => {
    if (!chatId) return;
    void navigate(chatProfilePath(chatId), { state: { fromChat: true } });
  };

  let composerError: string | null = null;
  let composerErrorId: string | undefined;
  if (draftError) {
    composerError = draftError;
    composerErrorId = 'message-error';
  } else if (mediaError) {
    composerError = t(mediaErrorKey(mediaError));
    composerErrorId = 'media-error';
  } else if (editing && editError) {
    composerError =
      editError === 'deleted' ? t('screens:chat.edit.deletedError') : t('screens:chat.edit.error');
    composerErrorId = 'edit-error';
  } else if (!editing && sendMutation.isError) {
    composerError = t('chat:conversation.sendError');
    composerErrorId = 'send-error';
  }

  // Bara de deasupra câmpului: răspuns sau editare.
  const composerContext = editing
    ? {
        mode: 'edit' as const,
        title: t('screens:chat.edit.title'),
        snippet: messageSnippet(t, editing),
        cancelLabel: t('screens:chat.edit.cancel'),
        onCancel: leaveEdit,
      }
    : replyTo
      ? {
          mode: 'reply' as const,
          title:
            replyTo.senderId === currentUserId ? t('screens:chat.reply.you') : partnerName,
          snippet: messageSnippet(t, replyTo),
          cancelLabel: t('screens:chat.reply.cancel'),
          onCancel: () => setReplyTo(null),
        }
      : null;

  // Meniul lucrează pe copia CURENTĂ a mesajului (un poll o poate fi schimbat);
  // dacă între timp a fost șters, meniul dispare.
  const liveMenuMessage = menu
    ? (thread.find((m) => m.id === menu.message.id) ?? menu.message)
    : null;
  const menuMessage = liveMenuMessage && !liveMenuMessage.isDeleted ? liveMenuMessage : null;

  // Acțiunile meniului, după proprietar și tipul mesajului.
  const menuActions: MessageAction[] = [];
  if (menuMessage) {
    const m = menuMessage;
    const own = m.senderId === currentUserId;
    const textual = (m.kind ?? 'text') === 'text';
    menuActions.push('reply');
    if (m.body.trim()) menuActions.push('copy');
    // Răspunsurile la povești poartă un prefix fix de server: nu se editează.
    if (own && textual && splitStoryReply(m.body) === null) menuActions.push('edit');
    if (own) menuActions.push('delete');
  }

  return (
    <div className="chat-screen">
      {/* Antetul conversației: identitatea celuilalt + acțiunile de siguranță.
          Navigarea ÎNAPOI nu e aici: ruta montează ecranul în `DeepScreen`,
          care leagă butonul nativ al Telegramului. Al doilea buton „înapoi" ar
          fi doar zgomot. */}
      <header className="chat-header">
        {/* Avatarul și numele deschid profilul partenerului (toate pozele, bio,
            interese). `fromChat` îi spune ecranului de profil că „înapoi la
            chat" e un pas înapoi în istoric, nu o conversație nouă în stivă. */}
        <button
          type="button"
          className="chat-header__avatar chat-header__avatar--button"
          data-testid="chat-open-profile"
          aria-label={t('screens:chat.partner.open', { name: headerName })}
          disabled={!chatId}
          onClick={openProfile}
        >
          {summary?.otherPhotoUrl ? (
            <Photo
              src={summary.otherPhotoUrl}
              size={256}
              priority
              alt=""
              referrerPolicy="no-referrer"
            />
          ) : (
            headerName.trim().charAt(0).toUpperCase() || '?'
          )}
        </button>
        <div className="chat-header__info" onClick={openProfile}>
          <h2 className="chat-header__title">
            {/* Fără handler propriu: click-ul (și Enter de la tastatură) urcă
                la `chat-header__info`. */}
            <button type="button" className="chat-header__name" data-testid="chat-open-profile-name">
              {headerName}
            </button>
          </h2>
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
        onSubmit={onComposerSubmit}
        context={composerContext}
        focusToken={focusToken}
        errorText={composerError}
        {...(composerErrorId ? { errorTestId: composerErrorId } : {})}
        onPickFile={onPickFile}
        onVoice={onVoice}
        onVideoNote={onVideoNote}
      />

      {preview ? (
        <MediaPreviewSheet
          file={preview.file}
          kind={preview.kind}
          onCancel={() => setPreview(null)}
          onSend={(caption) => void sendPreview(caption)}
        />
      ) : null}

      {menu && menuMessage ? (
        <MessageActionMenu
          anchor={menu.anchor}
          alignRight={menuMessage.senderId === currentUserId}
          reaction={menuMessage.reaction ?? null}
          onReact={onMenuReact}
          actions={menuActions}
          onAction={onMenuAction}
          onClose={closeMenu}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteMessageDialog
          chatId={chatId}
          messageId={deleteTarget.id}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
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
