/**
 * Încărcarea chitanței plății (captură de ecran, fotografie sau PDF din
 * aplicația băncii) — pasul obligatoriu după plată, pe ORICE comandă.
 *
 * Două surse: camera (fotografie a chitanței) sau un fișier (galerie / PDF).
 * Validarea (tip + mărime + fișier gol) se face ÎNAINTE de upload, cu mesaje
 * traduse; tipul lipsă (unele WebView-uri Android) se deduce din extensie.
 * Apoi previzualizare (imagine sau numele PDF-ului) și progresul upload-ului.
 * După succes se reîmprospătează toate vederile care arată comanda — lista de
 * cereri, lista de bilete și detaliul comenzii — ca etapa să treacă singură în
 * „În verificare".
 *
 * Refuzurile serverului au fiecare explicația lor: 413 = prea mare, 422 = nu e
 * o imagine / un PDF valid, 409 `event_started` = evenimentul a început, alt
 * 409 = comanda și-a schimbat starea între timp (atunci și reîncărcăm comanda,
 * ca ecranul să arate starea nouă în loc de un formular inutil).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { UploadIcon } from '@/features/tickets/TicketIcons';
import { apiErrorCode, EVENT_STARTED } from '@/features/tickets/orderStage';
import type { PaymentMethod } from '@/features/tickets/paymentModel';
import { haptic } from '@/telegram/bridge';

import {
  normalizePaymentProof,
  PAYMENT_PROOF_MAX_LABEL,
  uploadPaymentProof,
  validatePaymentProof,
  type ProofUploadOptions,
} from './ticketRequestsApi';

import './ticketRequests.css';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const FILE_ACCEPT = `${IMAGE_ACCEPT},application/pdf,.pdf`;

/** Cheia mesajului (namespace `screens`) pentru un refuz la upload. */
export function proofErrorKey(error: unknown): string {
  const { status, code } = apiErrorCode(error);
  if (code === EVENT_STARTED) return 'tickets.eventStarted';
  if (status === 413) return 'ticketRequests.proof.tooLarge';
  if (status === 422) return 'ticketRequests.proof.unreadable';
  if (status === 409) return 'ticketRequests.proof.notAccepted';
  return 'ticketRequests.proof.uploadFailed';
}

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
  title,
  intro,
  showSuccess = false,
}: {
  requestId: string;
  /** Injectabil, ca ecranul de bilete să treacă prin propriul modul de API. */
  upload?: (id: string, file: File, options?: ProofUploadOptions) => Promise<unknown>;
  /** Metoda aleasă în datele de plată (MIA / IBAN), trimisă odată cu chitanța. */
  method?: PaymentMethod | null;
  /** Titlul blocului; implicit „Încarcă chitanța plății". */
  title?: string;
  /** Explicația de sub titlu; implicit „fără ea nu putem confirma biletul". */
  intro?: string;
  /**
   * Confirmarea în pagină după succes. Doar unde componenta RĂMÂNE pe ecran
   * după upload (înlocuirea chitanței) — altfel etapa se schimbă oricum.
   */
  showSuccess?: boolean;
}) {
  const { t } = useTranslation('screens');
  const fileInputId = useId();
  const cameraInputId = useId();
  const errorId = useId();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sent, setSent] = useState(false);
  // Garda contra dublei trimiteri: două atingeri rapide pot ajunge înainte ca
  // butonul să apuce să se dezactiveze.
  const inFlight = useRef(false);
  const preview = usePreviewUrl(file);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-order', requestId] });
  };

  const mutation = useMutation({
    mutationFn: (selected: File) => {
      setProgress(0);
      return upload(requestId, selected, { method, onProgress: setProgress });
    },
    onSuccess: () => {
      setFile(undefined);
      setSent(true);
      haptic('medium');
      refresh();
    },
    onError: (error) => {
      // Starea comenzii s-a schimbat (aprobată, anulată, eveniment început):
      // aducem starea nouă, ca ecranul să nu mai ceară ce nu se mai poate.
      if (apiErrorCode(error).status === 409) refresh();
    },
    onSettled: () => {
      inFlight.current = false;
      setProgress(null);
    },
  });

  const select = (input: HTMLInputElement) => {
    const picked = input.files?.[0];
    // Golim input-ul: altfel aceeași chitanță, aleasă din nou după „Schimbă",
    // nu mai declanșează `change`.
    input.value = '';
    if (!picked) return;
    const next = normalizePaymentProof(picked);
    const error = validatePaymentProof(next);
    mutation.reset();
    setSent(false);
    setFileError(error);
    setFile(error ? undefined : next);
  };

  const submit = () => {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(file);
  };

  const isPdf = file?.type === 'application/pdf';
  const errorText = fileError ?? (mutation.isError ? t(proofErrorKey(mutation.error), { limit: PAYMENT_PROOF_MAX_LABEL }) : null);

  return (
    <div className="tr-proof" data-testid="proof-upload">
      <h3 className="tr-proof__title">{title ?? t('ticketRequests.proof.receiptTitle')}</h3>
      <p className="tr-proof__intro">{intro ?? t('ticketRequests.proof.receiptIntro')}</p>

      <div className="tr-proof__sources">
        <label className="tr-drop" htmlFor={fileInputId}>
          <span className="tr-drop__icon" aria-hidden="true">
            <UploadIcon width={22} height={22} />
          </span>
          <span className="tr-drop__text">
            <strong>{t('ticketRequests.proof.chooseFile')}</strong>
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
            aria-describedby={errorText ? errorId : undefined}
            disabled={mutation.isPending}
            onChange={(e) => select(e.currentTarget)}
          />
        </label>
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
            disabled={mutation.isPending}
            onChange={(e) => select(e.currentTarget)}
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
            onClick={() => {
              setFile(undefined);
              setFileError(null);
              mutation.reset();
            }}
            disabled={mutation.isPending}
          >
            {t('ticketRequests.proof.remove')}
          </button>
        </div>
      ) : null}

      {errorText ? (
        <p className="field__error" role="alert" id={errorId} data-testid={fileError ? 'proof-file-error' : 'proof-error'}>
          {errorText}
        </p>
      ) : null}
      {showSuccess && sent && !file ? (
        <p className="tr-proof__sent" role="status" data-testid="proof-sent">
          {t('tickets.proofSent')}
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
        onClick={submit}
      >
        {mutation.isPending ? t('ticketRequests.proof.uploading') : t('ticketRequests.proof.submitReceipt')}
      </button>
    </div>
  );
}

export default ProofUpload;
