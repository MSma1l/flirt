/**
 * Datele de plată ale unei comenzi de bilet: suma, destinația plății (textul
 * EXACT de scris la transfer), beneficiarul, IBAN-ul, banca, termenul și pașii.
 *
 * Fiecare câmp are buton de copiere. În WebView-ul Telegram `navigator.clipboard`
 * poate lipsi sau poate fi refuzat; atunci încercăm `execCommand('copy')`, iar
 * dacă și acela cade, valoarea rămâne text selectabil — copierea nu e niciodată
 * o fundătură și nu afișăm erori pentru ceva ce omul poate face cu degetul.
 *
 * Folosit și de fluxul de cumpărare directă (`TicketsScreen`), și de cererea
 * manuală (`ticketRequests/`), ca o plată să arate la fel oriunde.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatEventDate } from '@/features/events/eventFormat';

import { CheckIcon, ClockIcon, CopyIcon } from './TicketIcons';

import './tickets.css';

/** Cât rămâne aprins indiciul „Copiat" după o copiere reușită. */
const COPY_FEEDBACK_MS = 1600;

function legacyCopy(value: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'absolute';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
}

export function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const copy = useCallback((key: string, value: string) => {
    const done = () => {
      setCopiedKey(key);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => setCopiedKey((current) => (current === key ? null : current)),
        COPY_FEEDBACK_MS,
      );
    };
    void (async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
        await navigator.clipboard.writeText(value);
        done();
      } catch {
        if (legacyCopy(value)) done();
        else setCopiedKey(null);
      }
    })();
  }, []);

  return { copiedKey, copy };
}

function CopyButton({
  copyKey,
  value,
  label,
  copiedKey,
  onCopy,
  large,
}: {
  copyKey: string;
  value: string;
  label: string;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
  large?: boolean;
}) {
  const { t } = useTranslation('screens');
  const copied = copiedKey === copyKey;
  return (
    <button
      type="button"
      className={`tk-copy${copied ? ' tk-copy--done' : ''}${large ? ' tk-copy--large' : ''}`}
      onClick={() => onCopy(copyKey, value)}
      data-testid={`copy-${copyKey}`}
      aria-label={t('tickets.pay.copyField', { field: label })}
    >
      {copied ? <CheckIcon width={16} height={16} /> : <CopyIcon width={16} height={16} />}
      <span aria-live="polite">{copied ? t('tickets.copied') : t('tickets.copy')}</span>
    </button>
  );
}

export interface PaymentDetailsProps {
  amount: number;
  currency: string;
  beneficiary?: string | null;
  iban?: string | null;
  bankName?: string | null;
  /** Textul exact al destinației plății. */
  purpose?: string | null;
  /** Codul de plată al userului (`U-XXXXXXXX`). */
  reference?: string | null;
  phone?: string | null;
  accountDetails?: string | null;
  instructions?: string | null;
  /** Termenul de plată (ISO), dacă îl știm. */
  deadline?: string | null;
  /** Ultimul pas: „Am plătit" (cumpărare directă) sau dovada (cerere manuală). */
  finalStep: 'declare' | 'proof';
}

export function PaymentDetails(props: PaymentDetailsProps) {
  const { t } = useTranslation('screens');
  const { copiedKey, copy } = useCopy();
  const amountLabel = `${props.amount} ${props.currency}`;

  const rows: { key: string; label: string; value: string; mono?: boolean; testId?: string }[] = [];
  if (props.beneficiary) rows.push({ key: 'beneficiary', label: t('tickets.pay.recipient'), value: props.beneficiary });
  if (props.iban) rows.push({ key: 'iban', label: t('tickets.pay.iban'), value: props.iban, mono: true, testId: 'pay-iban' });
  if (props.bankName) rows.push({ key: 'bank', label: t('tickets.pay.bank'), value: props.bankName });
  if (props.phone) rows.push({ key: 'phone', label: t('tickets.pay.phone'), value: props.phone, mono: true });
  if (props.accountDetails) rows.push({ key: 'account', label: t('tickets.pay.account'), value: props.accountDetails, mono: true });
  if (props.reference) rows.push({ key: 'reference', label: t('tickets.pay.reference'), value: props.reference, mono: true, testId: 'pay-reference' });

  const steps = [
    t('tickets.pay.step1'),
    t('tickets.pay.step2', { amount: amountLabel }),
    t('tickets.pay.step3'),
    props.finalStep === 'declare' ? t('tickets.pay.step4Declare') : t('tickets.pay.step4Proof'),
  ];

  return (
    <div className="tk-pay" data-testid="order-instructions">
      <div className="tk-pay__amount">
        <span className="tk-eyebrow">{t('tickets.pay.amountLabel')}</span>
        <div className="tk-pay__amount-row">
          <span className="tk-pay__amount-value" data-testid="pay-amount">
            {amountLabel}
          </span>
          <CopyButton
            copyKey="amount"
            value={String(props.amount)}
            label={t('tickets.pay.amountLabel')}
            copiedKey={copiedKey}
            onCopy={copy}
          />
        </div>
        {props.deadline ? (
          <p className="tk-pay__deadline" data-testid="pay-deadline">
            <ClockIcon width={16} height={16} />
            {t('tickets.pay.deadline', { date: formatEventDate(props.deadline) })}
          </p>
        ) : null}
      </div>

      {props.purpose ? (
        <div className="tk-pay__purpose">
          <span className="tk-eyebrow">{t('tickets.pay.purpose')}</span>
          <p className="tk-pay__purpose-text tk-selectable" data-testid="pay-comment">
            {props.purpose}
          </p>
          <p className="tk-pay__purpose-hint">{t('tickets.pay.purposeHint')}</p>
          <CopyButton
            copyKey="comment"
            value={props.purpose}
            label={t('tickets.pay.purpose')}
            copiedKey={copiedKey}
            onCopy={copy}
            large
          />
        </div>
      ) : null}

      {rows.length > 0 ? (
        <dl className="tk-pay__fields">
          {rows.map((row) => (
            <div className="tk-pay__field" key={row.key}>
              <dt className="tk-pay__label">{row.label}</dt>
              <dd className="tk-pay__value">
                <span className={`tk-selectable${row.mono ? ' tk-mono' : ''}`} data-testid={row.testId}>
                  {row.value}
                </span>
                <CopyButton
                  copyKey={row.key}
                  value={row.value}
                  label={row.label}
                  copiedKey={copiedKey}
                  onCopy={copy}
                />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="tk-note">{t('tickets.pay.bankUnavailable')}</p>
      )}

      {props.instructions ? <p className="tk-note">{props.instructions}</p> : null}

      <div className="tk-pay__steps">
        <h4 className="tk-pay__steps-title">{t('tickets.pay.stepsTitle')}</h4>
        <ol className="tk-steps" data-testid="pay-steps">
          {steps.map((step, index) => (
            <li key={step} className="tk-steps__item">
              <span className="tk-steps__num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="tk-steps__text">{step}</span>
            </li>
          ))}
        </ol>
        <p className="tk-note">{t('tickets.pay.after')}</p>
      </div>
    </div>
  );
}

export default PaymentDetails;
