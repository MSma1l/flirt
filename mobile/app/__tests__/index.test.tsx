import { render } from '@testing-library/react-native';
import React from 'react';

import Index from '../index';
import { ThemeProvider } from '@theme/index';

/**
 * Ecranul nu mai decide nimic: e doar splash-ul pe care userul așteaptă cât
 * timp `AuthGuard` (`app/_layout.tsx`) hotărăște unde trebuie dus. Testele de
 * navigare stau la el, în `authGuard.test.tsx` — aici verificăm exact ce mai
 * face ecranul ăsta: arată logo-ul și NU navighează.
 */
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <Index />
    </ThemeProvider>,
  );
}

describe('Index (splash)', () => {
  beforeEach(() => mockRedirect.mockClear());

  it('arată brandul', () => {
    const { getByLabelText, getByText } = renderScreen();
    expect(getByLabelText('FLIRT')).toBeTruthy();
    expect(getByText('No Regrets')).toBeTruthy();
  });

  it('NU redirecționează singur: decizia e a porții, într-un singur loc', () => {
    // Regresie: aici exista un al doilea set de reguli de navigare, care știa
    // doar de `profile_completed`. La cold-start ateriza în feed peste userul
    // fără test de umor, iar serverul îi refuza apoi fiecare swipe cu 403.
    renderScreen();
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
