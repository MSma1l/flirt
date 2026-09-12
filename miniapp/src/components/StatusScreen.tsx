/**
 * Ecranul de stare — SINGURUL component pentru tot ce nu e conținut.
 *
 * Se încarcă, deschis în afara Telegram, date invalide, date expirate, fără
 * rețea, eroare de server, sesiune expirată, feed gol: toate trec pe aici și
 * arată la fel — logo, titlu, explicație, una sau două acțiuni.
 *
 * DE CE contează. Ecranele astea erau text simplu pe fundal alb, fără logo și
 * fără niciun buton. Utilizatorul care deschidea adresa în browser primea o
 * propoziție („Aplicația funcționează doar în interiorul Telegram") și o
 * fundătură: nimic de apăsat, niciun drum înapoi. Un ecran de stare are voie să
 * fie scurt, dar NU are voie să fie o fundătură — de aici regula că fiecare
 * stare primește cel puțin o acțiune, chiar dacă acțiunea e „du-mă în Telegram".
 *
 * A doua regulă, la fel de importantă: ecranul arată a PRODUS. Logo, accentul
 * roz, butoane pastilă, lățime limitată (pe desktop textul se întindea pe toată
 * fereastra). Vezi `styles/status.css`.
 */
import type { ReactNode } from 'react';

import { BrandLogo } from './BrandLogo';

export interface StatusAction {
  label: string;
  /**
   * Ce se întâmplă la apăsare. Pentru acțiunile cu `href` poate lipsi (link
   * obișnuit) sau poate intercepta navigarea (vezi `telegram/botLink.ts`).
   */
  onClick?: (event: { preventDefault: () => void }) => void;
  /**
   * Adresă externă. Prezența ei transformă acțiunea într-o legătură reală
   * `<a href>`, nu într-un buton cu `window.open`: așa funcționează și
   * „deschide în filă nouă", și copierea adresei, și clientul Telegram.
   */
  href?: string;
  /** `true` → butonul secundar, cu contur, nu cel plin. */
  ghost?: boolean;
  disabled?: boolean;
  testId?: string;
}

export interface StatusScreenProps {
  title: string;
  body?: string;
  /** Ascunde logoul. Implicit e afișat — e semnul că ecranul e al aplicației. */
  logo?: boolean;
  /** Un semn grafic mic sub logo (emoji sau SVG), pentru stări fără eroare. */
  icon?: ReactNode;
  /** Arată rotița în locul logoului mare: starea „se încarcă". */
  loading?: boolean;
  actions?: StatusAction[];
  children?: ReactNode;
  testId?: string;
}

/** O acțiune: buton obișnuit, sau legătură când are `href`. */
function ActionControl({ action }: { action: StatusAction }) {
  const className = `status-screen__action button${action.ghost ? ' button--ghost' : ''}`;

  if (action.href && !action.disabled) {
    return (
      <a
        className={className}
        href={action.href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={action.onClick}
        data-testid={action.testId}
      >
        {action.label}
      </a>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={action.onClick ? () => action.onClick?.({ preventDefault: () => undefined }) : undefined}
      disabled={action.disabled}
      data-testid={action.testId}
    >
      {action.label}
    </button>
  );
}

export function StatusScreen({
  title,
  body,
  logo = true,
  icon,
  loading = false,
  actions,
  children,
  testId,
}: StatusScreenProps) {
  return (
    <div className="screen-center status-screen" data-testid={testId}>
      <div className="status-screen__inner">
        {logo ? <BrandLogo /> : null}

        {loading ? <div className="spinner" role="status" aria-label={title} /> : null}
        {!loading && icon ? (
          <div className="status-icon" aria-hidden="true">
            {icon}
          </div>
        ) : null}

        {/* „Se încarcă" NU e un titlu de ecran: ecranul care vine e titlul.
            Un `<h1>` aici ar fi al doilea titlu de nivel 1 în aceeași rută și
            ar anunța ceva ce spinnerul (`role="status"`) spune deja. */}
        {loading ? (
          <p className="title status-screen__title">{title}</p>
        ) : (
          <h1 className="title status-screen__title">{title}</h1>
        )}
        {body ? <p className="body-text status-screen__body">{body}</p> : null}

        {actions?.length ? (
          <div className="status-screen__actions">
            {actions.map((action) => (
              <ActionControl key={action.label} action={action} />
            ))}
          </div>
        ) : null}

        {children}
      </div>
    </div>
  );
}

export default StatusScreen;
