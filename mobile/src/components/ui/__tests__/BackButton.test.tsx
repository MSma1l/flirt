import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { BackButton } from '../BackButton';

// Router mock la nivel de modul: `back` e partajat, ca să verificăm că apăsarea
// butonului îl cheamă. `useRouter` întoarce mereu aceeași instanță.
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

function renderBack(props: Partial<React.ComponentProps<typeof BackButton>> = {}) {
  return render(
    <ThemeProvider>
      <BackButton {...props} />
    </ThemeProvider>,
  );
}

describe('BackButton', () => {
  beforeEach(() => {
    mockBack.mockClear();
  });

  it('implicit: apăsarea cheamă router.back()', () => {
    const { getByLabelText } = renderBack();
    fireEvent.press(getByLabelText('Înapoi'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('cu onPress: folosește callback-ul dat, NU router.back()', () => {
    const onPress = jest.fn();
    const { getByLabelText } = renderBack({ onPress });
    fireEvent.press(getByLabelText('Înapoi'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('are rol de buton și eticheta implicită „Înapoi"', () => {
    const { getByRole } = renderBack();
    expect(getByRole('button')).toBeTruthy();
    expect(getByRole('button').props.accessibilityLabel).toBe('Înapoi');
  });

  it('acceptă o etichetă custom (ex. „Închide" pentru modale)', () => {
    const { getByLabelText } = renderBack({ accessibilityLabel: 'Închide' });
    expect(getByLabelText('Închide')).toBeTruthy();
  });

  it('zona de atins (hitSlop) atinge minimul HIG de 44px', () => {
    const { getByRole } = renderBack({ size: 28 });
    // (44 - 28) / 2 = 8px pe fiecare latură → 28 + 2×8 = 44.
    expect(getByRole('button').props.hitSlop).toEqual({
      top: 8,
      bottom: 8,
      left: 8,
      right: 8,
    });
  });
});
