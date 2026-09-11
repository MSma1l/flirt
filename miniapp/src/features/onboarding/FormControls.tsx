/**
 * Controale de formular pentru înregistrare.
 *
 * Reguli comune tuturor: fiecare câmp are o etichetă legată prin `htmlFor`
 * (fără asta, cititorul de ecran citește doar „câmp text"), iar eroarea e legată
 * prin `aria-describedby` și marcată cu `aria-invalid`, ca să fie anunțată
 * atunci când apare, nu doar colorată în roșu.
 */
import type { ReactNode } from 'react';
import { useId } from 'react';

export interface FieldProps {
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
  }) => ReactNode;
}

/** Înveliș de câmp: etichetă, conținut, indiciu și eroare. */
export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span className="field__required"> *</span> : null}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipGroupProps {
  label: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (value: string) => void;
  /** `false` → o singură alegere (gen); `true` → mai multe (limbi, interese). */
  multiple?: boolean;
  error?: string | null;
  hint?: string;
  required?: boolean;
}

/**
 * Alegere din catalog, cu butoane-etichetă.
 *
 * Opțiunile vin ÎNTOTDEAUNA din `GET /profiles/reference` — nicio listă de
 * genuri, interese sau statusuri nu e scrisă în cod. Dacă serverul adaugă mâine
 * un interes, apare aici fără o nouă versiune de Mini App.
 */
export function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  error,
  hint,
  required,
}: ChipGroupProps) {
  const id = useId();
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <span className="field__label" id={id}>
        {label}
        {required ? <span className="field__required"> *</span> : null}
      </span>
      <div
        className="chips"
        role="group"
        aria-labelledby={id}
        aria-describedby={error ? errorId : undefined}
      >
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={active ? 'chip chip--active' : 'chip'}
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint">{hint}</p>
      ) : null}
    </div>
  );
}
