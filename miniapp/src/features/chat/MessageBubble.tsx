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
 * Deosebirea față de nativ: picker-ul de reacții se deschide la CLIC pe bulă,
 * nu la apăsare lungă — într-un WebView apăsarea lungă e furată de meniul
 * contextual al sistemului. La bulele media (care au propriile butoane: deschide
 * poza, play) reacția are un buton mic alături.
 */
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChatIcon } from './ChatIcons';
import type { ChatMessageEx, MessageKind } from './chatApi';
import { formatDuration } from './chatMedia';
import { emojiOnlyCount } from './emojiData';
import { MediaViewer } from './MediaViewer';
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
  /** Aplică o reacție sau o scoate (`null`, la re-selectarea aceleiași). */
  onReact?: (reaction: string | null) => void;
  position?: GroupPosition;
  /** Prezent doar la bulele optimiste (upload în curs / eșuat). */
  pending?: PendingState;
  /** Ora deja formatată (HH:MM). */
  timeLabel?: string;
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
  onReact,
  position = 'single',
  pending,
  timeLabel,
}: Props) {
  const { t } = useTranslation(['chat', 'screens']);
  const isOwn = message.senderId === currentUserId;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  const kind: MessageKind = message.kind ?? 'text';
  const attachment = message.attachment ?? null;
  const isMedia = kind !== 'text' && !!attachment;
  const emojiCount = !isMedia ? emojiOnlyCount(message.body) : 0;
  const isJumbo = emojiCount > 0 && emojiCount <= 3 && !message.wasMasked;
  const hasTail = position === 'single' || position === 'last';
  const reactable = !!onReact && !pending;

  const pick = (emoji: string) => {
    setPickerOpen(false);
    // Re-selectarea aceleiași reacții o scoate.
    onReact?.(message.reaction === emoji ? null : emoji);
  };

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

  const meta =
    timeLabel || statusIcon ? (
      <span className="bubble__meta">
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
          <img src={attachment.url || undefined} alt={t('screens:chat.media.photo')} loading="lazy" decoding="async" />
        </button>
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
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li
      className={wrapClasses}
      data-testid="message-bubble"
      data-kind={kind}
      aria-label={isOwn ? t('chat:bubble.own') : t('chat:bubble.received')}
    >
      {isMedia ? (
        <div className="bubble-row">
          <div className={classes}>
            {media}
            {pendingOverlay}
            {message.body ? <span className="bubble__text bubble__caption">{message.body}</span> : null}
            {meta}
          </div>
          {reactable ? (
            <button
              type="button"
              className="bubble__react-btn"
              aria-label={t('chat:bubble.react')}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <ChatIcon name="smile" size={18} />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className={classes}
          aria-label={t('chat:bubble.react')}
          aria-expanded={pickerOpen}
          disabled={!reactable}
          onClick={() => reactable && setPickerOpen((open) => !open)}
        >
          <span className="bubble__text">{message.body}</span>
          {meta}
        </button>
      )}

      {pending?.status === 'error' && pending.errorText ? (
        <span className="bubble__error" role="alert" data-testid="upload-error">
          {pending.errorText}
        </span>
      ) : null}

      {message.reaction ? (
        <span
          className="bubble__reaction"
          data-testid="reaction-badge"
          aria-label={t('chat:bubble.reaction', { emoji: message.reaction })}
        >
          {message.reaction}
        </span>
      ) : null}

      {pickerOpen ? (
        <span className="bubble__picker" data-testid="reaction-picker">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="bubble__picker-item"
              aria-label={t('chat:bubble.reactionOption', { emoji })}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : null}

      {message.wasMasked ? (
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
