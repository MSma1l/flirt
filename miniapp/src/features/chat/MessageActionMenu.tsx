/**
 * Meniul unui mesaj, deschis prin apăsare lungă, atingere sau clic-dreapta:
 *   [ ❤️ 😂 👍 🔥 ]        ← reacțiile (fostul picker din bulă)
 *   Răspunde / Copiază / Editează / Șterge
 *
 * Stă LÂNGĂ bulă (dedesubt, sau deasupra când nu încape), într-un portal pe
 * `document.body`: astfel `position: fixed` nu e prins de un strămoș cu
 * `transform` (animațiile de intrare ale bulei / ecranului).
 *
 * Se închide la Escape și la atingerea fundalului. Fundalul se închide doar
 * dacă APĂSAREA a început pe el: ridicarea degetului de după apăsarea lungă
 * poate produce un clic „fantomă" exact acolo unde a apărut fundalul.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { ChatIcon, type ChatIconName } from './ChatIcons';
import { REACTIONS } from './MessageBubble';

/** Dreptunghiul bulei, în coordonate de viewport. */
export interface MenuAnchor {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type MessageAction = 'reply' | 'copy' | 'edit' | 'delete';

interface Props {
  anchor: MenuAnchor;
  /** Bula proprie e aliniată la dreapta — meniul la fel. */
  alignRight: boolean;
  /** Reacția curentă (evidențiată). */
  reaction: string | null;
  /** Fără el, rândul de reacții lipsește. */
  onReact?: ((emoji: string) => void) | undefined;
  actions: MessageAction[];
  onAction: (action: MessageAction) => void;
  onClose: () => void;
}

const GAP = 8;
const EDGE = 8;

const ICONS: Record<MessageAction, ChatIconName> = {
  reply: 'reply',
  copy: 'copy',
  edit: 'edit',
  delete: 'trash',
};

export function MessageActionMenu({
  anchor,
  alignRight,
  reaction,
  onReact,
  actions,
  onAction,
  onClose,
}: Props) {
  const { t } = useTranslation(['chat', 'screens']);
  const menuRef = useRef<HTMLDivElement>(null);
  const downOnBackdrop = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Poziția se calculează ÎNAINTE de desenare: meniul nu „sare" pe ecran.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = anchor.bottom + GAP;
    if (top + h > vh - EDGE) top = anchor.top - h - GAP;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    let left = alignRight ? anchor.right - w : anchor.left;
    left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
    setPos({ top, left });
  }, [anchor, alignRight]);

  // Focus pe prima acțiune (tastatură / cititor de ecran) + Escape închide.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const labels: Record<MessageAction, string> = {
    reply: t('screens:chat.actions.reply'),
    copy: t('screens:chat.actions.copy'),
    edit: t('screens:chat.actions.edit'),
    delete: t('screens:chat.actions.delete'),
  };

  return createPortal(
    <div
      className="msg-menu__backdrop"
      role="presentation"
      data-testid="message-menu-backdrop"
      onPointerDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || !downOnBackdrop.current) return;
        downOnBackdrop.current = false;
        onClose();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={menuRef}
        className="msg-menu"
        role="dialog"
        aria-modal="true"
        aria-label={t('screens:chat.actions.title')}
        data-testid="message-menu"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
      >
        {onReact ? (
          <div className="msg-menu__reactions" data-testid="reaction-picker">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={
                  reaction === emoji
                    ? 'bubble__picker-item bubble__picker-item--active'
                    : 'bubble__picker-item'
                }
                aria-label={t('chat:bubble.reactionOption', { emoji })}
                aria-pressed={reaction === emoji}
                onClick={() => onReact(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : null}

        {actions.length > 0 ? (
          <div className="msg-menu__actions">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className={
                  action === 'delete' ? 'msg-menu__item msg-menu__item--danger' : 'msg-menu__item'
                }
                data-testid={`message-action-${action}`}
                onClick={() => onAction(action)}
              >
                <ChatIcon name={ICONS[action]} size={20} />
                <span>{labels[action]}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
