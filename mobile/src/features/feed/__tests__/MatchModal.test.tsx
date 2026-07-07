import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { MatchModal } from '../MatchModal';

function renderModal(props: Partial<React.ComponentProps<typeof MatchModal>> = {}) {
  const onWriteMessage = jest.fn();
  const onContinue = jest.fn();
  const utils = render(
    <ThemeProvider>
      <MatchModal
        visible
        name="Ana"
        onWriteMessage={onWriteMessage}
        onContinue={onContinue}
        {...props}
      />
    </ThemeProvider>,
  );
  return { ...utils, onWriteMessage, onContinue };
}

describe('MatchModal', () => {
  it('afișează titlul „Connect" și numele celuilalt', () => {
    const { getByText } = renderModal();
    expect(getByText('Connect! 💘')).toBeTruthy();
    expect(getByText('Tu și Ana v-ați plăcut reciproc.')).toBeTruthy();
  });

  it('butonul „Scrie un mesaj" apelează onWriteMessage', () => {
    const { getByTestId, onWriteMessage } = renderModal();
    fireEvent.press(getByTestId('match-write'));
    expect(onWriteMessage).toHaveBeenCalledTimes(1);
  });

  it('butonul „Continuă" apelează onContinue', () => {
    const { getByTestId, onContinue } = renderModal();
    fireEvent.press(getByTestId('match-continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
