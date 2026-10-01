/**
 * Biletul de intrare, ca obiect: un pass închis la culoare, cu cotor perforat,
 * QR pe o placă albă rotunjită, cod scurt de citit cu ochiul și starea de la
 * intrare scrisă mare.
 *
 * Starea (`status`) vine din contractul scanerului de la intrare:
 *   valid → „Valid · arată-l la intrare"; admitted → banda verde „INTRARE
 *   PERMISĂ · ora"; used / expired → pass stins; cancelled → roșu.
 * Pe un server vechi `status` lipsește: dacă știm `legacyUsed` (biletul Flirt
 * Party), arătăm vechiul FOLOSIT / NEFOLOSIT; altfel, nicio etichetă inventată.
 *
 * `reveal` pornește animația de „deschidere" (prima dată când omul își vede
 * biletul aprobat). Animațiile sunt oprite sub `prefers-reduced-motion`.
 */
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatEventDate } from '@/features/events/eventFormat';

import { formatTicketCode, QrCode } from './QrCode';
import { CheckIcon, SunIcon } from './TicketIcons';
import { formatTime, shortTicketCode } from './orderStage';
import type { TicketPassStatus } from './ticketsApi';

import './tickets.css';

export interface TicketPassProps {
  code: string;
  title: string;
  eyebrow?: string;
  startsAt?: string | null;
  venue?: string | null;
  holder?: string | null;
  admits?: number | null;
  /** `null` = serverul nu ne-a spus starea. */
  status: TicketPassStatus | null;
  /** Doar pentru serverele vechi, când `status` lipsește. */
  legacyUsed?: boolean;
  admittedAt?: string | null;
  reveal?: boolean;
  statusTestId?: string;
  testId?: string;
}

function StatusLine({
  status,
  legacyUsed,
  admittedAt,
  testId,
}: Pick<TicketPassProps, 'status' | 'legacyUsed' | 'admittedAt'> & { testId: string }) {
  const { t } = useTranslation(['screens', 'social']);

  if (status === 'admitted') {
    const time = formatTime(admittedAt);
    return (
      <div className="tk-pass__admitted" data-testid={testId} role="status">
        <span className="tk-pass__admitted-icon" aria-hidden="true">
          <CheckIcon width={22} height={22} strokeWidth={2.6} />
        </span>
        <span>
          {time
            ? t('screens:tickets.pass.status.admitted', { time })
            : t('screens:tickets.pass.status.admittedNoTime')}
        </span>
      </div>
    );
  }

  if (status) {
    return (
      <span className={`tk-pass__status tk-pass__status--${status}`} data-testid={testId}>
        {t(`screens:tickets.pass.status.${status}`)}
      </span>
    );
  }

  if (legacyUsed !== undefined) {
    return (
      <span
        className={`tk-pass__status tk-pass__status--${legacyUsed ? 'used' : 'valid'}`}
        data-testid={testId}
      >
        {legacyUsed ? t('social:myTicket.used') : t('social:myTicket.unused')}
      </span>
    );
  }

  return null;
}

export function TicketPass({
  code,
  title,
  eyebrow,
  startsAt,
  venue,
  holder,
  admits,
  status,
  legacyUsed,
  admittedAt,
  reveal,
  statusTestId = 'ticket-status',
  testId = 'ticket-pass',
}: TicketPassProps) {
  const { t } = useTranslation(['screens', 'social']);
  const [showFull, setShowFull] = useState(false);
  const fullCodeId = useId();

  const visual = status ?? (legacyUsed ? 'used' : 'valid');
  const inactive = visual === 'used' || visual === 'expired' || visual === 'cancelled';

  const meta: { key: string; label: string; value: string }[] = [];
  if (startsAt) meta.push({ key: 'date', label: t('screens:tickets.pass.date'), value: formatEventDate(startsAt) });
  if (venue) meta.push({ key: 'venue', label: t('screens:tickets.pass.venue'), value: venue });
  if (holder) meta.push({ key: 'holder', label: t('screens:tickets.pass.holder'), value: holder });
  if (admits && admits > 1) meta.push({ key: 'admits', label: t('screens:tickets.pass.admits'), value: String(admits) });

  return (
    <article
      className={`tk-pass tk-pass--${visual}${reveal ? ' tk-pass--reveal' : ''}`}
      data-testid={testId}
    >
      <div className="tk-pass__head">
        <div className="tk-pass__brand-row">
          <span className="tk-pass__brand">FLIRT</span>
          <span className="tk-eyebrow tk-eyebrow--light">
            {eyebrow ?? t('screens:tickets.pass.eyebrow')}
          </span>
        </div>
        {reveal ? (
          <p className="tk-pass__ready" data-testid="ticket-reveal">
            {t('screens:tickets.pass.ready')}
          </p>
        ) : null}
        <h3 className="tk-pass__title">{title}</h3>
        {meta.length > 0 ? (
          <dl className="tk-pass__meta">
            {meta.map((m) => (
              <div key={m.key} className="tk-pass__meta-item">
                <dt>{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <div className="tk-pass__tear" aria-hidden="true" />

      <div className="tk-pass__body">
        <div className={`tk-pass__tile${inactive ? ' tk-pass__tile--inactive' : ''}`}>
          <QrCode value={code} size={200} label={t('social:myTicket.code')} showCode={false} />
          <span className="tk-pass__shine" aria-hidden="true" />
        </div>

        <div className="tk-pass__code">
          <span className="tk-eyebrow tk-eyebrow--light">{t('screens:tickets.pass.code')}</span>
          <span className="tk-pass__short-code" data-testid="ticket-short-code">
            {shortTicketCode(code)}
          </span>
          {showFull ? (
            <span className="tk-pass__full-code" id={fullCodeId} data-testid="ticket-full-code">
              {formatTicketCode(code)}
            </span>
          ) : null}
          <button
            type="button"
            className="tk-pass__toggle"
            aria-expanded={showFull}
            aria-controls={showFull ? fullCodeId : undefined}
            onClick={() => setShowFull((v) => !v)}
            data-testid="ticket-code-toggle"
          >
            {showFull ? t('screens:tickets.pass.hideFull') : t('screens:tickets.pass.showFull')}
          </button>
        </div>

        <StatusLine
          status={status}
          legacyUsed={legacyUsed}
          admittedAt={admittedAt}
          testId={statusTestId}
        />

        {!inactive && visual !== 'admitted' ? (
          <p className="tk-pass__hint">
            <SunIcon width={16} height={16} />
            {t('screens:tickets.pass.brightness')}
          </p>
        ) : null}
      </div>
    </article>
  );
}

export default TicketPass;
