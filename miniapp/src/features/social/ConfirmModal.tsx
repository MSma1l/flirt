/**
 * Fereastră proprie de confirmare, pentru acțiunile care nu se pot lua înapoi.
 *
 * DE CE NU `confirm()` / `alert()`: dialogurile native ale browserului blochează
 * firul de randare al WebView-ului Telegram. Pe unii clienți Android fereastra
 * nu apare deloc, iar Mini App-ul rămâne înghețat, fără nicio cale de ieșire.
 * Deci confirmarea o construim noi, în DOM, ca orice alt ecran.
 *
 * UNDE STĂ ȘI DE CE: `src/components/` aparține altui agent, deci componenta
 * trăiește în `features/social/`, unul dintre folderele deținute de agentul care
 * a scris-o. Ecranele de stories și de bilete o importă de aici
 * (`@/features/social/ConfirmModal`) ca să nu existe trei copii ale aceleiași
 * ferestre. Prefixul `cm-` din clasele CSS ține stilurile separate de restul
 * aplicației, ca două module cu nume asemănătoare să nu se calce în picioare.
 *
 * Accesibilitate: `role="dialog"` + `aria-modal`, titlul legat prin
 * `aria-labelledby`, focus pe butonul de confirmare la deschidere, Escape =
 * anulare, clic pe fundal = anulare. Confirmarea rămâne mereu o apăsare
 * deliberată — nu există confirmare implicită.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import './confirm-modal.css';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body?: string;
  /** Eticheta confirmării; implicit `common:actions.confirm`. */
  confirmLabel?: string;
  /** Eticheta anulării; implicit `common:actions.cancel`. */
  cancelLabel?: string;
  /** Marchează vizual confirmarea drept acțiune ireversibilă. */
  destructive?: boolean;
  /** Blochează ambele butoane cât timp acțiunea e în curs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
  testId = 'confirm-modal',
}: ConfirmModalProps) {
  const { t } = useTranslation('common');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const cancel = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, cancel]);

  if (!open) return null;

  return (
    <div className="cm-backdrop" data-testid={`${testId}-backdrop`} onClick={cancel}>
      <div
        className="cm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid={testId}
        // Un clic ÎN interiorul ferestrei nu are voie să o închidă.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="cm-title" id={titleId}>
          {title}
        </h2>
        {body ? <p className="cm-body">{body}</p> : null}
        <div className="cm-actions">
          <button
            type="button"
            className="button button--ghost cm-action"
            disabled={busy}
            onClick={cancel}
            data-testid={`${testId}-cancel`}
          >
            {cancelLabel ?? t('actions.cancel')}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`button cm-action${destructive ? ' cm-action--danger' : ''}`}
            disabled={busy}
            onClick={onConfirm}
            data-testid={`${testId}-accept`}
          >
            {confirmLabel ?? t('actions.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
