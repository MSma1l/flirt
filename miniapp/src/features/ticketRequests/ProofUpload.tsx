/**
 * Încărcarea chitanței plății (captură de ecran, fotografie sau PDF din
 * aplicația băncii) — pasul obligatoriu după plată, pe ORICE comandă.
 *
 * Două surse: camera (fotografie a chitanței) sau un fișier (galerie / PDF).
 * Validarea (tip + mărime) se face ÎNAINTE de upload, cu mesaje traduse; apoi
 * previzualizare (imagine sau numele PDF-ului) și progresul upload-ului. După
 * succes se reîmprospătează toate vederile care arată comanda — lista de
 * cereri, lista de bilete și detaliul comenzii — ca etapa să treacă singură în
 * „În verificare".
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UploadIcon } from '@/features/tickets/TicketIcons';
import { isEventStartedError } from '@/features/tickets/orderStage';
import type { PaymentMethod } from '@/features/tickets/paymentModel';

import {
  PAYMENT_PROOF_MAX_LABEL,
  uploadPaymentProof,
  validatePaymentProof,
  type ProofUploadOptions,
} from './ticketRequestsApi';

import './ticketRequests.css';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const FILE_ACCEPT = `${IMAGE_ACCEPT},application/pdf,.pdf`;

/** Previzualizarea locală a unei imagini (Blob URL, eliberat la schimbare). */
function usePreviewUrl(file: File | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return undefined;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => {
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(next);
    };
  }, [file]);
  return url;
}

export function ProofUpload({
  requestId,
  upload = uploadPaymentProof,
  method = null,
}: {
  requestId: string;
  /** Injectabil, ca ecranul de bilete să treacă prin propriul modul de API. */
  upload?: (id: string, file: File, options?: ProofUploadOptions) => Promise<unknown>;
  /** Metoda aleasă în datele de plată (MIA / IBAN), trimisă odată cu chitanța. */
  method?: PaymentMethod | null;
}) {
  const { t } = useTranslation('screens');
  const fileInputId = useId();
  const cameraInputId = useId();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const preview = usePreviewUrl(file);

  const mutation = useMutation({
    mutationFn: (selected: File) => {
      setProgress(0);
      return upload(requestId, selected, { method, onProgress: setProgress });
    },
    onSuccess: () => {
      setFile(undefined);
      void queryClient.invalidateQueries({ queryKey: ['ticket-requests'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-order', requestId] });
    },
    onSettled: () => setProgress(null),
  });

  const select = (next?: File) => {
    const error = validatePaymentProof(next);
    setFileError(error);
    setFile(error ? undefined : next);
  };

  const isPdf = file?.type === 'application/pdf';

  return (
    <div className="tr-proof" data-testid="proof-upload">
      <h3 className="tr-proof__title">{t('ticketRequests.proof.receiptTitle')}</h3>
      <p className="tr-proof__intro">{t('ticketRequests.proof.receiptIntro')}</p>

      <div className="tr-proof__sources">
        <label className="tr-drop tr-drop--compact" htmlFor={cameraInputId}>
          <span className="tr-drop__text">
            <strong>{t('ticketRequests.proof.camera')}</strong>
          </span>
          <input
            id={cameraInputId}
            className="tr-drop__input"
            type="file"
            accept="image/*"
            capture="environment"
            data-testid="proof-camera-input"
            onChange={(e) => select(e.currentTarget.files?.[0])}
          />
        </label>
        <label className="tr-drop" htmlFor={fileInputId}>
          <span className="tr-drop__icon" aria-hidden="true">
            <UploadIcon width={22} height={22} />
          </span>
          <span className="tr-drop__text">
            <strong>{file ? file.name : t('ticketRequests.proof.chooseFile')}</strong>
            <span className="tr-drop__hint">
              {t('ticketRequests.proof.hintWithPdf', { limit: PAYMENT_PROOF_MAX_LABEL })}
            </span>
          </span>
          <input
            id={fileInputId}
            className="tr-drop__input"
            type="file"
            accept={FILE_ACCEPT}
            data-testid="proof-input"
            onChange={(e) => select(e.currentTarget.files?.[0])}
          />
        </label>
      </div>

      {file ? (
        <div className="tr-preview" data-testid="proof-preview">
          {preview ? (
            <img className="tr-preview__img" src={preview} alt={t('ticketRequests.proof.previewAlt')} />
          ) : (
            <span className="tr-preview__doc" aria-hidden="true">
              {isPdf ? 'PDF' : '•'}
            </span>
          )}
          <span className="tr-preview__name">{file.name}</span>
          <button
            type="button"
            className="tr-preview__remove"
            onClick={() => setFile(undefined)}
            disabled={mutation.isPending}
          >
            {t('ticketRequests.proof.remove')}
          </button>
        </div>
      ) : null}

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
      {progress !== null ? (
        <div className="tr-progress" data-testid="proof-progress">
          <progress
            className="tr-progress__bar"
            max={100}
            value={progress}
            aria-label={t('ticketRequests.proof.progress', { percent: progress })}
          />
          <span className="tr-progress__label">{progress}%</span>
        </div>
      ) : null}
      <button
        type="button"
        className="button tk-cta"
        disabled={!file || mutation.isPending}
        data-testid="proof-submit"
        onClick={() => file && mutation.mutate(file)}
      >
        {mutation.isPending ? t('ticketRequests.proof.uploading') : t('ticketRequests.proof.submitReceipt')}
      </button>
    </div>
  );
}

export default ProofUpload;
