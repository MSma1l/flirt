/**
 * Încărcarea dovezii de plată (captură / fotografie a chitanței).
 *
 * Validarea (tip + mărime) se face ÎNAINTE de upload, cu mesaje traduse; după
 * succes se reîmprospătează toate vederile care arată comanda — lista de
 * cereri, lista de bilete și detaliul comenzii — ca etapa să treacă singură în
 * „În verificare".
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UploadIcon } from '@/features/tickets/TicketIcons';
import { isEventStartedError } from '@/features/tickets/orderStage';

import {
  PAYMENT_PROOF_MAX_LABEL,
  uploadPaymentProof,
  validatePaymentProof,
} from './ticketRequestsApi';

import './ticketRequests.css';

export function ProofUpload({
  requestId,
  upload = uploadPaymentProof,
}: {
  requestId: string;
  /** Injectabil, ca ecranul de bilete să treacă prin propriul modul de API. */
  upload?: (id: string, file: File) => Promise<unknown>;
}) {
  const { t } = useTranslation('screens');
  const inputId = useId();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (selected: File) => upload(requestId, selected),
    onSuccess: () => {
      setFile(undefined);
      void queryClient.invalidateQueries({ queryKey: ['ticket-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-order', requestId] });
    },
  });

  const select = (next?: File) => {
    const error = validatePaymentProof(next);
    setFileError(error);
    setFile(error ? undefined : next);
  };

  return (
    <div className="tr-proof" data-testid="proof-upload">
      <label className="tr-drop" htmlFor={inputId}>
        <span className="tr-drop__icon" aria-hidden="true">
          <UploadIcon width={22} height={22} />
        </span>
        <span className="tr-drop__text">
          <strong>{file ? file.name : t('ticketRequests.proof.label')}</strong>
          <span className="tr-drop__hint">
            {t('ticketRequests.proof.hint', { limit: PAYMENT_PROOF_MAX_LABEL })}
          </span>
        </span>
        <input
          id={inputId}
          className="tr-drop__input"
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          data-testid="proof-input"
          onChange={(e) => select(e.currentTarget.files?.[0])}
        />
      </label>
      {fileError ? (
        <p className="field__error" role="alert">
          {fileError}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="field__error" role="alert" data-testid="proof-error">
          {isEventStartedError(mutation.error)
            ? t('tickets.eventStarted')
            : t('ticketRequests.proof.uploadFailed')}
        </p>
      ) : null}
      <button
        type="button"
        className="button"
        disabled={!file || mutation.isPending}
        data-testid="proof-submit"
        onClick={() => file && mutation.mutate(file)}
      >
        {mutation.isPending ? t('ticketRequests.proof.uploading') : t('ticketRequests.proof.submit')}
      </button>
    </div>
  );
}

export default ProofUpload;
