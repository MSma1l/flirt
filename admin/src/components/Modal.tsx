/**
 * Dialog modal accesibil (role="dialog", aria-modal, Escape închide, focus inițial
 * pe conținut). Fără biblioteci externe.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  wide = false,
  className,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  /** Clasă suplimentară (ex. o lățime proprie paginii). */
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Dialoguri suprapuse (confirmare peste detaliu): Escape îl închide doar pe
      // cel de deasupra, nu pe toate odată.
      const open = document.querySelectorAll('.modal');
      if (open.length > 0 && open[open.length - 1] !== ref.current) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={['modal', wide ? 'modal--wide' : '', className ?? ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2 className="modal__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
