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
});
