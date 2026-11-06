/**
 * O bulă de mesaj: aliniere și culoare după emitent, grupare (coadă doar pe
 * ultima bulă dintr-un grup), ora + bifele de citire ÎN bulă, reacție,
 * indiciu de mascare, și conținut media (poză, video, vocal).
 *
 * PORT DOM al lui `mobile/src/features/chat/MessageBubble.tsx`, extins.
 *
 * REGULĂ DE PRODUS (TZ 5.5): corpul mesajului vine DEJA mascat de server
 * (`backend/app/services/contact_masker.py` înlocuiește telefoane, email-uri,
 * linkuri și handle-uri cu `****` ÎNAINTE de a persista). Interfața afișează
 * textul exact așa cum îl primește — nu încearcă să-l „repare", să-l
 * reconstruiască sau să-l evidențieze altfel. Când serverul semnalează că a
 * mascat ceva (`was_masked`), sub bulă apare explicația portată din mobil
 * (`chat:bubble.maskedHint`).
 *
 * MENIUL MESAJULUI (reacții + Răspunde / Copiază / Editează / Șterge) se
 * deschide la APĂSARE LUNGĂ (gesturile din `useMessageGestures`; meniul
 * contextual al WebView-ului e suprimat), la clic-dreapta pe desktop și, la
 * bulele text, și la o atingere scurtă — ca în Telegram. La bulele media (care
 * au propriile butoane: deschide poza, play) atingerea scurtă rămâne a lor;
 * meniul are și un buton mic alături. Meniul însuși e randat O SINGURĂ DATĂ, de
 * `ChatScreen` (`MessageActionMenu`), nu în fiecare bulă.
 *
 * GLISAREA SPRE STÂNGA pe bulă → răspuns la mesaj.
 *
 * Mesajele ȘTERSE apar ca o bulă estompată „Mesaj șters", fără reacții și fără
 * meniu. Mesajele EDITATE au eticheta „editat" lângă oră.
 */
import { memo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Photo } from '@/components/Photo';

import { ChatIcon } from './ChatIcons';
import type { ChatMessageEx, MessageKind } from './chatApi';
import { formatDuration } from './chatMedia';
import { emojiOnlyCount } from './emojiData';
import type { MenuAnchor } from './MessageActionMenu';
import { MediaViewer } from './MediaViewer';
import { messageSnippet } from './replyPreview';
import { splitStoryReply } from './storyReply';
import { useMessageGestures } from './useMessageGestures';
import { VideoNotePlayer } from './VideoNotePlayer';
import { VoicePlayer } from './VoicePlayer';

/** Emoji-urile din picker — aceleași ca în aplicația nativă. */
export const REACTIONS = ['❤️', '😂', '👍', '🔥'] as const;

/** Poziția bulei în grupul de mesaje consecutive ale aceluiași emitent. */
export type GroupPosition = 'single' | 'first' | 'middle' | 'last';

/** Starea unui mesaj media încă netrimis (bulă optimistă). */
export interface PendingState {
  status: 'uploading' | 'error';
  /** 0..1 */
  progress: number;
  /** Textul erorii, deja tradus. */
  errorText?: string;
  onRetry: () => void;
  onRemove: () => void;
}

interface Props {
  message: ChatMessageEx;
  /** Id-ul utilizatorului curent, pentru a decide alinierea. */
  currentUserId: string;
  position?: GroupPosition;
  /** Prezent doar la bulele optimiste (upload în curs / eșuat). */
  pending?: PendingState;
  /** Ora deja formatată (HH:MM). */
  timeLabel?: string;
  /** Numele partenerului, pentru citatele din răspunsuri. */
  partnerName?: string;
  /** Evidențiere scurtă (după un salt din citat). */
  highlighted?: boolean;
  /**
   * Deschide meniul mesajului lângă bulă. Fără el (sau la bule optimiste /
   * șterse) bula nu are meniu și nici gesturi. Callback STABIL — bula e memoizată.
   */
  onOpenMenu?: (message: ChatMessageEx, anchor: MenuAnchor) => void;
  /** Glisarea spre stânga: răspuns la mesaj. Callback stabil. */
  onSwipeReply?: (message: ChatMessageEx) => void;
  /** Atingerea citatului: salt la mesajul original. Callback stabil. */
  onQuoteClick?: (messageId: string) => void;
}

/** Proporția pozei, plafonată ca o poză-panoramă să nu devină o fâșie. */
function aspectOf(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return '4 / 3';
  const ratio = Math.min(1.8, Math.max(0.6, width / height));
  return `${ratio}`;
}

function ProgressRing({ progress }: { progress: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg className="progress-ring" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={r} className="progress-ring__track" />
      <circle
        cx="24"
        cy="24"
        r={r}
        className="progress-ring__value"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.03, Math.min(1, progress)))}
      />
    </svg>
  );
}

function MessageBubbleBase({
  message,
  currentUserId,
  position = 'single',
  pending,
  timeLabel,
  partnerName,
  highlighted = false,
  onOpenMenu,
  onSwipeReply,
  onQuoteClick,
}: Props) {
  const { t } = useTranslation(['chat', 'screens']);
  const isOwn = message.senderId === currentUserId;
  const [viewerOpen, setViewerOpen] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const isDeleted = !!message.isDeleted;
  const kind: MessageKind = message.kind ?? 'text';
  const attachment = isDeleted ? null : (message.attachment ?? null);
  const isMedia = kind !== 'text' && !!attachment;
  // Răspuns la o poveste: textul fără prefixul fix (românesc) pus de server.
  const storyReplyText = !isMedia && !isDeleted ? splitStoryReply(message.body) : null;
  const emojiCount =
    !isMedia && !isDeleted && storyReplyText === null && !message.replyTo
      ? emojiOnlyCount(message.body)
      : 0;
  const isJumbo = emojiCount > 0 && emojiCount <= 3 && !message.wasMasked;
  const hasTail = position === 'single' || position === 'last';
  const interactive = !!onOpenMenu && !pending && !isDeleted;

  const openMenu = () => {
    if (!interactive) return;
    const r = bubbleRef.current?.getBoundingClientRect();
    onOpenMenu?.(message, {
      top: r?.top ?? 0,
      bottom: r?.bottom ?? 0,
      left: r?.left ?? 0,
      right: r?.right ?? 0,
    });
  };

  const gestures = useMessageGestures({
    enabled: interactive,
    onLongPress: openMenu,
    onSwipe: interactive && onSwipeReply ? () => onSwipeReply(message) : undefined,
  });

  let statusIcon: React.ReactElement | null = null;
  if (isOwn) {
    if (pending) {
      statusIcon = (
        <span className="bubble__ticks" aria-label={t('screens:chat.status.sending')}>
          <ChatIcon name={pending.status === 'error' ? 'alert' : 'clock'} size={14} />
        </span>
      );
    } else if (message.isRead) {
      statusIcon = (
        <span
          className="bubble__ticks bubble__ticks--read"
          data-testid="read-ticks"
          aria-label={t('screens:chat.status.read')}
        >
          <ChatIcon name="checks" size={16} />
        </span>
      );
    } else {
      statusIcon = (
        <span className="bubble__ticks" data-testid="sent-tick" aria-label={t('screens:chat.status.sent')}>
          <ChatIcon name="check" size={16} />
        </span>
      );
    }
  }

  const edited = !!message.editedAt && !isDeleted;
  const meta =
    timeLabel || statusIcon || edited ? (
      <span className="bubble__meta">
        {edited ? (
          <span className="bubble__edited" data-testid="edited-label">
            {t('screens:chat.edited')}
          </span>
        ) : null}
        {timeLabel ? <time dateTime={message.createdAt}>{timeLabel}</time> : null}
        {statusIcon}
      </span>
    ) : null;

  const classes = [
    'bubble',
    isOwn ? 'bubble--own' : '',
    hasTail ? 'bubble--tail' : '',
    isJumbo ? `bubble--emoji bubble--emoji-${emojiCount}` : '',
    isMedia ? `bubble--media bubble--${kind}` : '',
    isMedia && !message.body ? 'bubble--bare' : '',
    isDeleted ? 'bubble--deleted' : '',
    interactive ? 'bubble--interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  let media: React.ReactElement | null = null;
  if (isMedia && attachment) {
    if (kind === 'image') {
      media = (
        <button
          type="button"
          className="media-thumb"
          style={{ aspectRatio: aspectOf(attachment.width, attachment.height) }}
          aria-label={t('screens:chat.media.openPhoto')}
          disabled={!!pending}
          onClick={() => setViewerOpen(true)}
        >
          {/* În bulă: varianta de 480px. Ecranul întreg (`MediaViewer`) rămâne pe original. */}
          <Photo src={attachment.url || undefined} size={480} alt={t('screens:chat.media.photo')} />
        </button>
      );
    } else if (kind === 'video_note') {
      media = (
        <VideoNotePlayer
          src={attachment.url}
          durationMs={attachment.durationMs}
          disabled={!!pending}
        />
      );
    } else if (kind === 'video') {
      media = (
        <div
          className="media-thumb media-thumb--video"
          style={{ aspectRatio: aspectOf(attachment.width, attachment.height) }}
        >
          {/* `#t=0.1` face ca WebView-urile să deseneze primul cadru ca previzualizare. */}
          <video src={attachment.url ? `${attachment.url}#t=0.1` : undefined} preload="metadata" muted playsInline />
          {!pending ? (
            <button
              type="button"
              className="media-thumb__play"
              aria-label={t('screens:chat.media.playVideo')}
              onClick={() => setViewerOpen(true)}
            >
              <ChatIcon name="play" size={26} />
            </button>
          ) : null}
          {attachment.durationMs ? (
            <span className="media-thumb__badge">{formatDuration(attachment.durationMs)}</span>
          ) : null}
        </div>
      );
    } else {
      media = (
        <VoicePlayer
          id={message.id}
          src={attachment.url}
          durationMs={attachment.durationMs}
          own={isOwn}
        />
      );
    }
  }

  const pendingOverlay = pending ? (
    <span className="bubble__pending" data-testid="upload-pending">
      {pending.status === 'uploading' ? (
        <span
          className="bubble__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pending.progress * 100)}
          aria-label={t('screens:chat.upload.progress', { percent: Math.round(pending.progress * 100) })}
        >
          <ProgressRing progress={pending.progress} />
        </span>
      ) : (
        <span className="bubble__failed">
          <button
            type="button"
            className="bubble__failed-btn"
            data-testid="upload-retry"
            aria-label={t('screens:chat.upload.retry')}
            onClick={pending.onRetry}
          >
            <ChatIcon name="retry" size={20} />
          </button>
          <button
            type="button"
            className="bubble__failed-btn"
            aria-label={t('screens:chat.upload.remove')}
            onClick={pending.onRemove}
          >
            <ChatIcon name="trash" size={20} />
          </button>
        </span>
      )}
    </span>
  ) : null;

  const wrapClasses = [
    'bubble-wrap',
    isOwn ? 'bubble-wrap--own' : '',
    `bubble-wrap--${position}`,
    pending ? 'bubble-wrap--pending' : '',
    highlighted ? 'bubble-wrap--highlight' : '',
  ]
    .filter(Boolean)
    .join(' ');

  // Citatul mesajului la care acesta răspunde (nu și la mesajele șterse).
  const replyTo = !isDeleted ? (message.replyTo ?? null) : null;
  const quote = replyTo ? (
    <button
      type="button"
      className="bubble__quote"
      data-testid="reply-quote"
      onClick={(event) => {
        // Saltul la original, nu meniul bulei.
        event.stopPropagation();
        onQuoteClick?.(replyTo.id);
      }}
    >
      <span className="bubble__quote-name">
        {replyTo.senderId === currentUserId
          ? t('screens:chat.reply.you')
          : partnerName || t('chat:conversation.fallbackTitle')}
      </span>
      <span className="bubble__quote-text">{messageSnippet(t, replyTo)}</span>
    </button>
  ) : null;

  let bubble: React.ReactElement;
  if (isDeleted) {
    bubble = (
      <div ref={bubbleRef} className={classes} data-testid="deleted-message">
        <span className="bubble__text bubble__deleted-text">
          <span aria-hidden="true">🚫 </span>
          {t('screens:chat.deleted')}
        </span>
        {meta}
      </div>
    );
  } else if (isMedia) {
    bubble = (
      <div className="bubble-row">
        <div ref={bubbleRef} className={classes}>
          {quote}
          {media}
          {pendingOverlay}
          {message.body ? <span className="bubble__text bubble__caption">{message.body}</span> : null}
          {meta}
        </div>
        {interactive ? (
          <button
            type="button"
            className="bubble__react-btn"
            aria-label={t('chat:bubble.react')}
            aria-haspopup="dialog"
            onClick={openMenu}
          >
            <ChatIcon name="smile" size={18} />
          </button>
        ) : null}
      </div>
    );
  } else {
    bubble = (
      <div
        ref={bubbleRef}
        className={classes}
        // Atingerea scurtă deschide meniul (reacții + acțiuni), ca în Telegram.
        {...(interactive
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-haspopup': 'dialog' as const,
              onClick: openMenu,
              onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openMenu();
                }
              },
            }
          : {})}
      >
        {quote}
        {storyReplyText !== null ? (
          <>
            {/* Prefixul românesc de pe server → eticheta în limba interfeței. */}
            <span className="bubble__story-reply" data-testid="story-reply-label">
              {isOwn ? t('screens:chat.storyReply.own') : t('screens:chat.storyReply.received')}
            </span>
            <span className="bubble__text">{storyReplyText}</span>
          </>
        ) : (
          <span className="bubble__text">{message.body}</span>
        )}
        {meta}
      </div>
    );
  }

  return (
    <li
      className={wrapClasses}
      data-testid="message-bubble"
      data-message-id={message.id}
      data-kind={kind}
      aria-label={isOwn ? t('chat:bubble.own') : t('chat:bubble.received')}
    >
      {/* Zona gesturilor: apăsare lungă, glisare spre stânga, clic-dreapta.
          Săgeata de răspuns stă SUB bulă, la marginea dreaptă, și se dezvăluie
          pe măsură ce bula alunecă spre stânga. */}
      <div className="bubble-swipe" {...gestures.handlers}>
        {interactive && onSwipeReply ? (
          <span className="bubble-swipe__arrow" ref={gestures.arrowRef} aria-hidden="true">
            <ChatIcon name="reply" size={18} />
          </span>
        ) : null}
        <div className="bubble-swipe__track" ref={gestures.trackRef}>
          {bubble}
        </div>
      </div>

      {pending?.status === 'error' && pending.errorText ? (
        <span className="bubble__error" role="alert" data-testid="upload-error">
          {pending.errorText}
        </span>
      ) : null}

      {message.reaction && !isDeleted ? (
        <span
          className="bubble__reaction"
          data-testid="reaction-badge"
          aria-label={t('chat:bubble.reaction', { emoji: message.reaction })}
        >
          {message.reaction}
        </span>
      ) : null}

      {message.wasMasked && !isDeleted ? (
        <span className="bubble__masked" data-testid="masked-hint">
          {t('chat:bubble.maskedHint')}
        </span>
      ) : null}

      {viewerOpen && attachment && (kind === 'image' || kind === 'video') ? (
        <MediaViewer kind={kind} src={attachment.url} onClose={() => setViewerOpen(false)} />
      ) : null}
    </li>
  );
}

/** Memoizat: la fiecare poll / tastare în composer, bulele nemodificate stau. */
export const MessageBubble = memo(MessageBubbleBase);
