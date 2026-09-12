/**
 * Fereastra de confirmare, pe care se sprijină mai multe module (social,
 * stories, bilete). Testăm CONTRACTUL ei, nu aspectul: ce anume anulează, ce
 * NU anulează și ce se întâmplă cât timp acțiunea e în curs.
 *
 * DE CE contează fiecare caz: o fereastră care se închide la un clic în
 * interiorul ei pierde acțiunea utilizatorului; una care nu se închide la
 * Escape blochează navigarea la tastatură; una care lasă butoanele active cât
 * timp cererea zboară trimite acțiunea de două ori.
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/harness';

import { ConfirmModal } from '../ConfirmModal';

interface Overrides {
  open?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

function renderModal(overrides: Overrides = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  renderWithProviders(
    <ConfirmModal
      open={overrides.open ?? true}
      title="Scoți din favorite?"
      body="Îl poți adăuga oricând la loc."
      busy={overrides.busy ?? false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ConfirmModal', () => {
  it('închisă, nu randează nimic', () => {
    renderModal({ open: false });
    expect(screen.queryByTestId('confirm-modal')).not.toBeInTheDocument();
  });

  it('deschisă, arată titlul și textul și pune focusul pe confirmare', () => {
    renderModal();

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Scoți din favorite?');
    expect(screen.getByText('Îl poți adăuga oricând la loc.')).toBeInTheDocument();
    // Focusul pe confirmare: cu tastatura, Enter duce acțiunea la capăt fără
    // niciun Tab, iar Escape rămâne ieșirea.
    expect(screen.getByTestId('confirm-modal-accept')).toHaveFocus();
  });

  it('Escape anulează', () => {
    const { onCancel, onConfirm } = renderModal();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('clicul pe fundal anulează', () => {
    const { onCancel } = renderModal();

    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clicul ÎN cutie nu închide fereastra', () => {
    const { onCancel, onConfirm } = renderModal();

    fireEvent.click(screen.getByTestId('confirm-modal'));

    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirmarea cheamă `onConfirm`, nu `onCancel`', () => {
    const { onCancel, onConfirm } = renderModal();

    fireEvent.click(screen.getByTestId('confirm-modal-accept'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('`busy` blochează ambele butoane, Escape și clicul pe fundal', () => {
    const { onCancel, onConfirm } = renderModal({ busy: true });

    expect(screen.getByTestId('confirm-modal-accept')).toBeDisabled();
    expect(screen.getByTestId('confirm-modal-cancel')).toBeDisabled();

    fireEvent.click(screen.getByTestId('confirm-modal-accept'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('confirm-modal-backdrop'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
