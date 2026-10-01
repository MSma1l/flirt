/**
 * Datele de plată ale unei comenzi de bilet, pe metode, în ordinea serverului:
 *  - MIA Plăți Instant (după numărul de telefon) — primul, cardul premium;
 *  - transfer bancar (IBAN) — suma, destinația plății (textul EXACT de scris la
 *    transfer), beneficiarul, IBAN-ul, banca, termenul și pașii.
 * Cu ambele metode configurate apare un comutator MIA | IBAN (implicit MIA).
 * Un server vechi (fără `payment_methods`) → exact afișarea de dinainte (IBAN).
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

import { getWebApp } from '@/telegram/bridge';

import type { PaymentMethod } from './paymentModel';
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
  /** MIA: telefonul destinatarului (`+373XXXXXXXX`). */
  miaPhone?: string | null;
  /** MIA: numele pe care plătitorul îl vede în aplicația băncii. */
  miaRecipientName?: string | null;
  /** MIA: imaginea codului QR (de scanat din aplicația băncii). */
  miaQrUrl?: string | null;
  /** Metodele configurate, în ordinea serverului; gol/absent = afișarea veche. */
  methods?: readonly PaymentMethod[] | null;
  /** Anunță metoda aleasă (ca dovada plății să o poată trimite serverului). */
  onMethodChange?: (method: PaymentMethod) => void;
}

/** `+37369123456` → `+373 69 123 456` (doar afișare; se copiază forma brută). */
export function formatMdPhone(phone: string): string {
  const match = /^\+373(\d{2})(\d{3})(\d{3})$/.exec(phone);
  return match ? `+373 ${match[1]} ${match[2]} ${match[3]}` : phone;
}

type CopyFn = (key: string, value: string) => void;

function FieldRows({
  rows,
  copiedKey,
  onCopy,
}: {
  rows: { key: string; label: string; value: string; mono?: boolean; testId?: string }[];
  copiedKey: string | null;
  onCopy: CopyFn;
}) {
  return (
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
              onCopy={onCopy}
            />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Steps({ steps }: { steps: string[] }) {
  const { t } = useTranslation('screens');
  return (
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
  );
}

function Deadline({ deadline }: { deadline?: string | null }) {
  const { t } = useTranslation('screens');
  if (!deadline) return null;
  return (
    <p className="tk-pay__deadline" data-testid="pay-deadline">
      <ClockIcon width={16} height={16} />
      {t('tickets.pay.deadline', { date: formatEventDate(deadline) })}
    </p>
  );
}

/**
 * Deschide QR-ul la mărime completă — în Telegram prin `openLink` (browserul
 * extern permite „Salvează imaginea"), altfel într-un tab nou. Cine plătește de
 * pe ACELAȘI telefon nu-și poate scana ecranul: salvează imaginea și o încarcă
 * în aplicația băncii la „Plată prin QR".
 */
function openFullSize(url: string): void {
  const app = getWebApp();
  if (app && typeof app.openLink === 'function') {
    app.openLink(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Cardul MIA: QR-ul, telefonul mare, numele destinatarului, suma, comentariul, pașii. */
function MiaDetails(props: PaymentDetailsProps & { copiedKey: string | null; onCopy: CopyFn }) {
  const { t } = useTranslation('screens');
  const amountLabel = `${props.amount} ${props.currency}`;
  const comment = props.purpose || props.reference || null;
  const phoneLabel = props.miaPhone ? formatMdPhone(props.miaPhone) : null;
  const qrUrl = props.miaQrUrl ?? null;

  const rows: { key: string; label: string; value: string; mono?: boolean; testId?: string }[] = [
    { key: 'mia-amount', label: t('tickets.pay.mia.amount'), value: String(props.amount), testId: 'mia-amount' },
  ];
  if (comment) {
    rows.push({ key: 'mia-comment', label: t('tickets.pay.mia.comment'), value: comment, mono: true, testId: 'mia-comment' });
  }
  if (props.reference && comment !== props.reference && !comment?.includes(props.reference)) {
    rows.push({ key: 'mia-reference', label: t('tickets.pay.reference'), value: props.reference, mono: true });
  }

  const steps = [
    t('tickets.pay.mia.step1'),
    phoneLabel ? t('tickets.pay.mia.step2') : t('tickets.pay.mia.step2Qr'),
    phoneLabel
      ? t('tickets.pay.mia.step3', { phone: phoneLabel, amount: amountLabel })
      : t('tickets.pay.mia.step3Qr', { amount: amountLabel }),
    t('tickets.pay.mia.step4'),
    props.finalStep === 'declare' ? t('tickets.pay.mia.step5Declare') : t('tickets.pay.mia.step5Proof'),
  ];

  return (
    <div className="tk-pay" data-testid="pay-mia">
      <section className="tk-mia" aria-label={t('tickets.pay.mia.title')}>
        <div className="tk-mia__head">
          <span className="tk-mia__badge" aria-hidden="true">
            MIA
          </span>
          <div className="tk-mia__heading">
            <h4 className="tk-mia__title">{t('tickets.pay.mia.title')}</h4>
            <p className="tk-mia__subtitle">{t('tickets.pay.mia.subtitle')}</p>
          </div>
        </div>
        {qrUrl ? (
          <figure className="tk-mia__qr" data-testid="mia-qr">
            <span className="tk-mia__qr-tile">
              <img className="tk-mia__qr-img" src={qrUrl} alt={t('tickets.pay.mia.qrAlt')} />
            </span>
            <figcaption className="tk-mia__qr-caption">{t('tickets.pay.mia.qrCaption')}</figcaption>
            <button
              type="button"
              className="tk-copy tk-copy--large"
              data-testid="mia-qr-open"
              onClick={() => openFullSize(qrUrl)}
            >
              {t('tickets.pay.mia.qrSave')}
            </button>
            <p className="tk-mia__qr-hint">{t('tickets.pay.mia.qrSameDevice')}</p>
          </figure>
        ) : null}
        {phoneLabel && props.miaPhone ? (
          <>
            <span className="tk-eyebrow tk-eyebrow--light">{t('tickets.pay.mia.phone')}</span>
            <div className="tk-pay__amount-row">
              <span className="tk-mia__phone" data-testid="mia-phone">
                {phoneLabel}
              </span>
              <CopyButton
                copyKey="mia-phone"
                value={props.miaPhone}
                label={t('tickets.pay.mia.phone')}
                copiedKey={props.copiedKey}
                onCopy={props.onCopy}
              />
            </div>
          </>
        ) : null}
        {props.miaRecipientName ? (
          <div className="tk-mia__recipient">
            <span className="tk-eyebrow tk-eyebrow--light">{t('tickets.pay.mia.recipient')}</span>
            <strong className="tk-mia__recipient-name" data-testid="mia-recipient">
              {props.miaRecipientName}
            </strong>
            <span className="tk-mia__recipient-hint">{t('tickets.pay.mia.recipientHint')}</span>
          </div>
        ) : null}
        <p className="tk-mia__amount" data-testid="pay-amount">
          {amountLabel}
        </p>
        <Deadline deadline={props.deadline} />
      </section>

      <FieldRows rows={rows} copiedKey={props.copiedKey} onCopy={props.onCopy} />
      {comment ? <p className="tk-pay__purpose-hint">{t('tickets.pay.purposeHint')}</p> : null}

      {props.instructions ? <p className="tk-note">{props.instructions}</p> : null}
      <Steps steps={steps} />
    </div>
  );
}

/** Transferul bancar (IBAN) — afișarea de dinainte, neschimbată. */
function IbanDetails(props: PaymentDetailsProps & { testId: string; copiedKey: string | null; onCopy: CopyFn }) {
  const { t } = useTranslation('screens');
  const { copiedKey, onCopy: copy } = props;
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
    <div className="tk-pay" data-testid={props.testId}>
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
        <Deadline deadline={props.deadline} />
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
        <FieldRows rows={rows} copiedKey={copiedKey} onCopy={copy} />
      ) : (
        <p className="tk-note">{t('tickets.pay.bankUnavailable')}</p>
      )}

      {props.instructions ? <p className="tk-note">{props.instructions}</p> : null}

      <Steps steps={steps} />
    </div>
  );
}

export function PaymentDetails(props: PaymentDetailsProps) {
  const { t } = useTranslation('screens');
  const { copiedKey, copy } = useCopy();
  const miaReady = Boolean(props.miaPhone || props.miaQrUrl);
  const methods = (props.methods ?? []).filter((m) => m !== 'mia' || miaReady);
  const hasMia = methods.includes('mia') && miaReady;
  const hasIban = methods.includes('iban');
  const [chosen, setChosen] = useState<PaymentMethod>('mia');
  const active: PaymentMethod = hasMia && (chosen === 'mia' || !hasIban) ? 'mia' : 'iban';
  const { onMethodChange } = props;

  // Metoda se raportează doar când serverul a spus ce metode există; pe un
  // server vechi nu ghicim (chitanța pleacă fără `method`).
  const known = methods.length > 0;
  useEffect(() => {
    if (known) onMethodChange?.(active);
  }, [active, known, onMethodChange]);

  // Server vechi sau doar IBAN → afișarea de dinainte, neschimbată.
  if (!hasMia) {
    return <IbanDetails {...props} testId="order-instructions" copiedKey={copiedKey} onCopy={copy} />;
  }

  return (
    <div className="tk-pay" data-testid="order-instructions">
      {hasIban ? (
        <div className="tk-seg" role="radiogroup" aria-label={t('tickets.pay.methodLabel')}>
          {(['mia', 'iban'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active === m}
              className={`tk-seg__btn${active === m ? ' tk-seg__btn--on' : ''}`}
              data-testid={`pay-method-${m}`}
              onClick={() => setChosen(m)}
            >
              {m === 'mia' ? t('tickets.pay.methodMia') : t('tickets.pay.methodIban')}
            </button>
          ))}
        </div>
      ) : null}
      {active === 'mia' ? (
        <MiaDetails {...props} copiedKey={copiedKey} onCopy={copy} />
      ) : (
        <>
          <h4 className="tk-pay__alt-title">{t('tickets.pay.ibanAlternative')}</h4>
          <IbanDetails {...props} testId="pay-iban-section" copiedKey={copiedKey} onCopy={copy} />
        </>
      )}
    </div>
  );
}

export default PaymentDetails;
