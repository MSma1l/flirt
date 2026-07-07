import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Register from '../register';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
// Prefixul `mock` e necesar ca jest să permită referința în factory-ul hoistat.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

// Mock store: `useAuthStore(selector)` întoarce `register` dintr-un state fals.
const mockRegister = jest.fn<Promise<void>, [string, string]>(() => Promise.resolve());
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { register: typeof mockRegister }) => unknown) =>
    selector({ register: mockRegister }),
}));

function renderRegister() {
  return render(
    <ThemeProvider>
      <Register />
    </ThemeProvider>,
  );
}

describe('Register', () => {
  beforeEach(() => {
    mockRegister.mockClear();
    mockReplace.mockClear();
  });

  it('NU apelează register când emailul este invalid', () => {
    const { getByTestId } = renderRegister();

    fireEvent.changeText(getByTestId('register-email'), 'invalid');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'parola123');
    fireEvent.press(getByTestId('register-submit'));

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('NU apelează register când parolele nu se potrivesc', () => {
    const { getByTestId } = renderRegister();

    fireEvent.changeText(getByTestId('register-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'alta-parola');
    fireEvent.press(getByTestId('register-submit'));

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('afișează eroare de coincidență a parolelor și nu trimite', () => {
    const { getByTestId, getByText } = renderRegister();

    fireEvent.changeText(getByTestId('register-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'alta-parola');
    fireEvent.press(getByTestId('register-submit'));

    expect(getByText('Parolele nu coincid.')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('apelează register din store cu date valide (email trimuit)', async () => {
    const { getByTestId } = renderRegister();

    fireEvent.changeText(getByTestId('register-email'), '  nume@exemplu.com ');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'parola123');
    fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('nume@exemplu.com', 'parola123');
    });
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });
});
