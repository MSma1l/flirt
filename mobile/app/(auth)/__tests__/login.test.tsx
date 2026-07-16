import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Login from '../login';
import i18n from '@/i18n';
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

  /**
   * TIPARUL de testare a unui ecran migrat (de copiat la celelalte ecrane):
   * i18n e inițializat global în `jest.setup.js`, pe română — deci nu e nevoie
   * de niciun wrapper sau setup local. Textul românesc se asertează exact ca
   * înainte de migrare; pentru altă limbă, `i18n.changeLanguage` + re-randare.
   */
  describe('i18n', () => {
    afterEach(async () => {
      // Limba e stare globală: o restaurăm ca să nu se scurgă în alt test.
      await i18n.changeLanguage('ro');
    });

    it('randează în română implicit', () => {
      const { getByText } = renderLogin();

      expect(getByText('Bine ai revenit')).toBeTruthy();
      expect(getByText('Autentifică-te ca să continui.')).toBeTruthy();
      expect(getByText('Autentificare')).toBeTruthy();
    });

    it('randează în limba activă', async () => {
      await i18n.changeLanguage('uk');
      const { getByText } = renderLogin();

      expect(getByText('З поверненням')).toBeTruthy();
      expect(getByText('Увійдіть, щоб продовжити.')).toBeTruthy();
      expect(getByText('Увійти')).toBeTruthy();
    });

    it('afișează eroarea de autentificare în limba activă', async () => {
      mockLogin.mockRejectedValueOnce(new Error('401'));
      await i18n.changeLanguage('ru');

      const { getByTestId, getByText } = renderLogin();
      fireEvent.changeText(getByTestId('login-email'), 'nume@exemplu.com');
      fireEvent.changeText(getByTestId('login-password'), 'parola123');
      fireEvent.press(getByTestId('login-submit'));

      await waitFor(() => {
        expect(getByText('Неверная почта или пароль. Попробуйте ещё раз.')).toBeTruthy();
      });
    });
  });
});
