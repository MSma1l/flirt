import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { SendFirstMessageSheet } from '../SendFirstMessageSheet';

function renderSheet(props: Partial<React.ComponentProps<typeof SendFirstMessageSheet>> = {}) {
  const onSend = jest.fn();
  const onSkip = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <ThemeProvider>
      <SendFirstMessageSheet
        visible
        name="Ana"
        onSend={onSend}
        onSkip={onSkip}
        onClose={onClose}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ...utils, onSend, onSkip, onClose };
}

describe('SendFirstMessageSheet', () => {
  it('afișează titlul cu numele și variantele rapide', () => {
    const { getByText } = renderSheet();
    expect(getByText('Scrie-i lui Ana')).toBeTruthy();
    expect(getByText('Salut 👋')).toBeTruthy();
    expect(getByText('Salut, ce faci?')).toBeTruthy();
  });

  it('„Trimite" este dezactivat inițial (câmp gol)', () => {
    const { getByTestId, onSend } = renderSheet();
    fireEvent.press(getByTestId('first-msg-send'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('varianta rapidă completează câmpul și „Trimite" trimite textul (trim)', () => {
    const { getByTestId, onSend } = renderSheet();
    fireEvent.press(getByTestId('first-msg-quick-Salut 👋'));
    fireEvent.press(getByTestId('first-msg-send'));
    expect(onSend).toHaveBeenCalledWith('Salut 👋');
  });

  it('text scris manual este forwardat la onSend', () => {
    const { getByTestId, onSend } = renderSheet();
    fireEvent.changeText(getByTestId('first-msg-input'), 'Bună ziua');
    fireEvent.press(getByTestId('first-msg-send'));
    expect(onSend).toHaveBeenCalledWith('Bună ziua');
  });

  it('„Doar like" apelează onSkip', () => {
    const { getByTestId, onSkip } = renderSheet();
    fireEvent.press(getByTestId('first-msg-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  /* --- Regresie: backdrop-ul NU mai e părintele conținutului (buton în buton pe web) --- */

  it('apăsarea pe „Salut 👋" trimite mesajul și NU închide foaia', () => {
    const { getByTestId, onSend, onClose } = renderSheet();

    fireEvent.press(getByTestId('first-msg-quick-Salut 👋'));
    // Cât timp backdrop-ul era părinte, pe web click-ul putea ajunge la el și
    // închidea foaia în loc să completeze mesajul.
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('first-msg-send'));
    expect(onSend).toHaveBeenCalledWith('Salut 👋');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('apăsarea pe butoanele din sheet nu declanșează onClose', () => {
    const { getByTestId, onClose } = renderSheet();

    fireEvent.press(getByTestId('first-msg-quick-Salut, ce faci?'));
    fireEvent.press(getByTestId('first-msg-skip'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('tap în afara sheet-ului (backdrop) închide foaia', () => {
    const { getByLabelText, onClose } = renderSheet();
    fireEvent.press(getByLabelText('Închide'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
