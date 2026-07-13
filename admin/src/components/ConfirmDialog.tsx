/**
 * Confirmarea acțiunilor distructive.
 *
 * REGULA PROIECTULUI: nicio acțiune distructivă (ban, ascundere profil, ștergere
 * GDPR, ștergere eveniment) nu pleacă spre backend fără trecerea prin acest
 * dialog. Callback-ul `onConfirm` este SINGURA cale de execuție.
 *
 * Pentru acțiuni IREVERSIBILE (ștergerea GDPR a unui cont) se dă `confirmPhrase`:
 * butonul rămâne dezactivat până când adminul TASTEAZĂ exact fraza cerută
 * (de regulă emailul contului) — a doua confirmare, împotriva click-ului reflex.
 */
import { useState, type FormEvent } from 'react';

import { Button, Field, TextArea, TextInput } from './ui';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  title: string;
  /** Ce se întâmplă, în cuvinte clare. */
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Dacă e dat, confirmarea cere tastarea EXACTĂ a acestei fraze. */
  confirmPhrase?: string;
  /** Dacă e dat, se cere și un motiv (ajunge în jurnalul de audit). */
  reasonLabel?: string;
  reasonRequired?: boolean;
  busy?: boolean;
  errorMessage?: string | null;
  onConfirm: (reason?: string) => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = true,
  confirmPhrase,
  reasonLabel,
  reasonRequired = false,
  busy = false,
  errorMessage = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');

  const phraseOk = confirmPhrase === undefined || typed.trim() === confirmPhrase;
  const reasonOk = !reasonRequired || reason.trim().length > 0;
  const canConfirm = phraseOk && reasonOk && !busy;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canConfirm) return;
    onConfirm(reasonLabel ? reason.trim() : undefined);
  };

  return (
    <Modal title={title} onClose={onCancel}>
      <form className="modal__body" onSubmit={submit}>
        <p style={{ margin: 0 }}>{message}</p>

        {reasonLabel ? (
          <Field label={reasonLabel} htmlFor="confirm-reason">
            <TextArea
              id="confirm-reason"
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Motivul intră în jurnalul de audit"
            />
          </Field>
        ) : null}

        {confirmPhrase !== undefined ? (
          <Field
            label={`Scrie „${confirmPhrase}" ca să confirmi. Acțiunea este IREVERSIBILĂ.`}
            htmlFor="confirm-phrase"
          >
            <TextInput
              id="confirm-phrase"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </Field>
        ) : null}

        {errorMessage ? <div className="alert">{errorMessage}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Anulează
          </Button>
          <Button
            type="submit"
            variant={danger ? 'danger' : 'primary'}
            disabled={!canConfirm}
          >
            {busy ? 'Se execută…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
