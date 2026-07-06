import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Login from '../login';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
// Prefixul `mock` este necesar ca jest să permită referința în factory-ul hoistat.
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

// Mock store: `useAuthStore(selector)` returnează câmpul cerut dintr-un state fals.
const mockLogin = jest.fn<Promise<void>, [string, string]>(() => Promise.resolve());
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { login: typeof mockLogin }) => unknown) =>
    selector({ login: mockLogin }),
}));

function renderLogin() {
  return render(
    <ThemeProvider>
      <Login />
    </ThemeProvider>,
  );
}

describe('Login', () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockReplace.mockClear();
  });

  it('apelează login din store cu date valide', async () => {
    const { getByTestId } = renderLogin();

    fireEvent.changeText(getByTestId('login-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('login-password'), 'parola123');
    fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('nume@exemplu.com', 'parola123');
    });
  });

  it('NU apelează login când datele sunt invalide', () => {
    const { getByTestId } = renderLogin();

    fireEvent.changeText(getByTestId('login-email'), 'invalid');
    fireEvent.changeText(getByTestId('login-password'), '123');
    fireEvent.press(getByTestId('login-submit'));

    expect(mockLogin).not.toHaveBeenCalled();
  });
});
