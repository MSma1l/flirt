/**
 * Fereastră de confirmare proprie, pentru acțiuni distructive.
 *
 * DE CE NU `confirm()` / `alert()`: dialogurile native ale browserului blochează
 * firul de randare al WebView-ului Telegram — pe unii clienți Android fereastra
 * nu apare deloc, iar Mini App-ul rămâne înghețat. Deci o construim noi.
 *
 * Stă în `features/profile/` fiindcă ăsta e unul dintre folderele deținute de
 * agentul care a scris-o; `src/components/` aparține altcuiva. Ecranul de Setări
 * o importă de aici (`../profile/ConfirmDialog`), ca să nu existe două copii.
 *
 * Accesibilitate: `role="dialog"` + `aria-modal`, titlu legat prin
 * `aria-labelledby`, focus pus pe butonul de confirmare la deschidere, Escape =
 * anulare, clic pe fundal = anulare. Butonul distructiv e marcat vizual, dar
 * confirmarea rămâne o apăsare deliberată, niciodată implicită.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import './confirm-dialog.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  /** Eticheta butonului de confirmare; implicit `common:actions.confirm`. */
  confirmLabel?: string;
  /** Eticheta butonului de anulare; implicit `common:actions.cancel`. */
  cancelLabel?: string;
  /** Colorează confirmarea ca acțiune ireversibilă. */
  destructive?: boolean;
  /** Blochează ambele butoane cât timp acțiunea e în curs. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const confirmRef = useRef<HTMLButtonElement>(null);

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
    <div className="confirm-backdrop" data-testid="confirm-backdrop" onClick={cancel}>
      <div
        className="confirm-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        data-testid="confirm-dialog"
        // Un clic în interiorul cutiei nu trebuie să închidă fereastra.
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="confirm-title" id="confirm-title">
          {title}
        </h2>
        {body ? <p className="confirm-body">{body}</p> : null}
        <div className="confirm-actions">
          <button
            type="button"
            className="button button--ghost confirm-action"
            disabled={busy}
            onClick={cancel}
            data-testid="confirm-cancel"
          >
            {cancelLabel ?? t('actions.cancel')}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`button confirm-action${destructive ? ' pf-button--danger' : ''}`}
            disabled={busy}
            onClick={onConfirm}
            data-testid="confirm-accept"
          >
            {confirmLabel ?? t('actions.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
