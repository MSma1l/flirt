/**
 * Primitivele de UI ale panoului (buton, card, badge, câmpuri, stări).
 * Toate se sprijină exclusiv pe token-urile FLIRT din `styles/tokens.css`.
 *
 * REGULĂ: nicăieri `dangerouslySetInnerHTML` — datele afișate (nume, bio, note de
 * raport) sunt input netrusted; React le escapează automat ca text.
 */
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

type ButtonVariant = 'primary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
}

export function Button({
  variant = 'ghost',
  small = false,
  block = false,
  className,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const classes = [
    'btn',
    `btn--${variant}`,
    small ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <button type={type} className={classes} {...rest} />;
}

export function Card({
  title,
  actions,
  className,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <div className="section-head" style={{ marginBottom: 'var(--space-4)' }}>
          {title ? <h2 className="card__title" style={{ margin: 0 }}>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export type BadgeTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral' | 'count';

export function Badge({
  tone = 'accent',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}): JSX.Element {
  const suffix = tone === 'accent' ? '' : ` badge--${tone}`;
  return <span className={`badge${suffix}`}>{children}</span>;
}

export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className={['card', 'stat', accent ? 'stat--accent' : ''].filter(Boolean).join(' ')}>
      <span className="stat__label">{label}</span>
      <span className="stat__value mono">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, children }: FieldProps): JSX.Element {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  const { className, ...rest } = props;
  return <input className={['input', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): JSX.Element {
  const { className, ...rest } = props;
  return <textarea className={['textarea', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  const { className, ...rest } = props;
  return <select className={['select', className ?? ''].filter(Boolean).join(' ')} {...rest} />;
}

export function Spinner(): JSX.Element {
  return <div className="spinner" role="status" aria-label="Se încarcă" />;
}

export function LoadingState({ label = 'Se încarcă…' }: { label?: string }): JSX.Element {
  return (
    <div className="state">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }): JSX.Element {
  return (
    <div className="state">
      <span className="state__title">{title}</span>
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="state">
      <span className="state__title">Ceva n-a mers</span>
      <span role="alert">{message}</span>
      {onRetry ? (
        <Button variant="ghost" small onClick={onRetry}>
          Reîncearcă
        </Button>
      ) : null}
    </div>
  );
}
