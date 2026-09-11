/**
 * O bulă de mesaj: aliniere și culoare după emitent, reacție, indiciu de
 * mascare.
 *
 * PORT DOM al lui `mobile/src/features/chat/MessageBubble.tsx`.
 *
 * REGULĂ DE PRODUS (TZ 5.5): corpul mesajului vine DEJA mascat de server
 * (`backend/app/services/contact_masker.py` înlocuiește telefoane, email-uri,
 * linkuri și handle-uri cu `****` ÎNAINTE de a persista). Interfața afișează
 * textul exact așa cum îl primește — nu încearcă să-l „repare", să-l
 * reconstruiască sau să-l evidențieze altfel. Când serverul semnalează că a
 * mascat ceva (`was_masked`), sub bulă apare explicația portată din mobil
 * (`chat:bubble.maskedHint`), ca utilizatorul să înțeleagă de ce textul lui
 * arată altfel decât l-a scris.
 *
 * Deosebirea față de nativ: picker-ul de reacții se deschide la CLIC pe bulă,
 * nu la apăsare lungă — într-un WebView apăsarea lungă e furată de meniul
 * contextual al sistemului.
 */
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ChatMessage } from '@mobile/features/chat/types';

/** Emoji-urile din picker — aceleași ca în aplicația nativă. */
export const REACTIONS = ['❤️', '😂', '👍', '🔥'] as const;

interface Props {
  message: ChatMessage;
  /** Id-ul utilizatorului curent, pentru a decide alinierea. */
  currentUserId: string;
  /** Aplică o reacție sau o scoate (`null`, la re-selectarea aceleiași). */
  onReact?: (reaction: string | null) => void;
}

function MessageBubbleBase({ message, currentUserId, onReact }: Props) {
  const { t } = useTranslation('chat');
  const isOwn = message.senderId === currentUserId;
  const [pickerOpen, setPickerOpen] = useState(false);

  const pick = (emoji: string) => {
    setPickerOpen(false);
    // Re-selectarea aceleiași reacții o scoate.
    onReact?.(message.reaction === emoji ? null : emoji);
  };

  return (
    <li
      className={isOwn ? 'bubble-wrap bubble-wrap--own' : 'bubble-wrap'}
      data-testid="message-bubble"
      aria-label={isOwn ? t('bubble.own') : t('bubble.received')}
    >
      <button
        type="button"
        className={isOwn ? 'bubble bubble--own' : 'bubble'}
        aria-label={t('bubble.react')}
        aria-expanded={pickerOpen}
        disabled={!onReact}
        onClick={() => onReact && setPickerOpen((open) => !open)}
      >
        {message.body}
      </button>

      {message.reaction ? (
        <span
          className="bubble__reaction"
          data-testid="reaction-badge"
          aria-label={t('bubble.reaction', { emoji: message.reaction })}
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
              aria-label={t('bubble.reactionOption', { emoji })}
              onClick={() => pick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </span>
      ) : null}

      {message.wasMasked ? (
        <span className="bubble__masked" data-testid="masked-hint">
          {t('bubble.maskedHint')}
        </span>
      ) : null}
    </li>
  );
}

/** Memoizat: la fiecare poll / tastare în composer, bulele nemodificate stau. */
export const MessageBubble = memo(MessageBubbleBase);
