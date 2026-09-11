/**
 * Ecran de stare: titlu, explicație și (opțional) o acțiune.
 *
 * Un singur loc pentru TOATE stările „nu e nimic de arătat": eroare de
 * autentificare, feed gol, listă goală. Regula lui e în titlu — starea goală
 * trebuie să sune a stare goală, nu a defecțiune.
 */
import type { ReactNode } from 'react';

export interface StatusAction {
  label: string;
  onClick: () => void;
  /** `true` → butonul secundar, cu contur, nu cel plin. */
  ghost?: boolean;
  disabled?: boolean;
  testId?: string;
}

export interface StatusScreenProps {
  title: string;
  body?: string;
  /** Un semn grafic mare (emoji sau SVG) deasupra titlului. */
  icon?: ReactNode;
  actions?: StatusAction[];
  children?: ReactNode;
}

export function StatusScreen({ title, body, icon, actions, children }: StatusScreenProps) {
  return (
    <div className="screen-center">
      {icon ? <div className="status-icon" aria-hidden="true">{icon}</div> : null}
      <h1 className="title">{title}</h1>
      {body ? <p className="body-text">{body}</p> : null}
      {actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          className={action.ghost ? 'button button--ghost' : 'button'}
          onClick={action.onClick}
          disabled={action.disabled}
          data-testid={action.testId}
        >
          {action.label}
        </button>
      ))}
      {children}
    </div>
  );
}

export default StatusScreen;
