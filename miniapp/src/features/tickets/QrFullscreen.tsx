/**
 * „Mărește codul QR": un buton care deschide codul pe tot ecranul, pe fundal
 * ALB. La intrare, în întuneric, cu telefonul pe luminozitate mică, un QR mic
 * pe un card închis la culoare e greu de citit; un ecran alb cu un QR cât
 * lățimea lui aprinde ecranul și se scanează din prima.
 *
 * Telegram nu dă acces la luminozitatea ecranului, deci fundalul alb e tot ce
 * putem face — plus indiciul „mărește luminozitatea" de sub bilet.
 *
 * Fereastra stă într-un portal pe `body`: biletul are animații cu `transform`,
 * iar un `position: fixed` în interiorul unui element transformat s-ar lipi de
 * el, nu de ecran. Se închide cu butonul, cu Escape sau atingând fundalul;
 * focusul revine pe butonul care a deschis-o.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { QrCode } from './QrCode';

import './tickets.css';

/** Latura QR-ului: cât încape pe ecran, cu margini, între 200 și 420 px. */
function fullscreenSize(): number {
  const side = Math.min(window.innerWidth || 360, window.innerHeight || 640) - 64;
  return Math.max(200, Math.min(420, side));
}

export function QrFullscreen({
  value,
  label,
  caption,
  testId = 'qr-fullscreen',
}: {
  value: string;
  /** Eticheta accesibilă a codului („Cod bilet"). */
  label: string;
  /** Textul mare de sub cod (ex. codul scurt al biletului). */
  caption?: string | null;
  testId?: string;
}) {
  const { t } = useTranslation('screens');
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    const trigger = triggerRef.current;
    return () => {
      document.removeEventListener('keydown', onKey);
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="tk-qr-zoom"
        data-testid={`${testId}-open`}
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t('tickets.pass.fullscreen')}
      </button>
      {open
        ? createPortal(
            <div
              className="tk-qr-full"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              data-testid={testId}
              onClick={(event) => {
                if (event.target === event.currentTarget) setOpen(false);
              }}
            >
              <p className="tk-qr-full__title" id={titleId}>
                {t('tickets.pass.fullscreenTitle')}
              </p>
              <QrCode value={value} size={fullscreenSize()} label={label} showCode={false} testId={`${testId}-qr`} />
              {caption ? <p className="tk-qr-full__caption">{caption}</p> : null}
              <button
                ref={closeRef}
                type="button"
                className="tk-qr-full__close"
                data-testid={`${testId}-close`}
                onClick={() => setOpen(false)}
              >
                {t('tickets.pass.close')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default QrFullscreen;
