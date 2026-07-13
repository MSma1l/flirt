import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import Register from '../register';
import { config } from '@/config';
import { ThemeProvider } from '@theme/index';

// Linkurile legale se deschid în browser — spionăm, nu deschidem nimic.
const mockOpenURL = jest
  .spyOn(Linking, 'openURL')
  .mockImplementation(() => Promise.resolve(true));

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
    mockOpenURL.mockClear();
  });

  it('NU apelează register când emailul este invalid', () => {
    const { getByTestId } = renderRegister();

    fireEvent.press(getByTestId('register-terms'));
    fireEvent.changeText(getByTestId('register-email'), 'invalid');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'parola123');
    fireEvent.press(getByTestId('register-submit'));

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('NU apelează register când parolele nu se potrivesc', () => {
    const { getByTestId } = renderRegister();

    fireEvent.press(getByTestId('register-terms'));
    fireEvent.changeText(getByTestId('register-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'alta-parola');
    fireEvent.press(getByTestId('register-submit'));

    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('afișează eroare de coincidență a parolelor și nu trimite', () => {
    const { getByTestId, getByText } = renderRegister();

    fireEvent.press(getByTestId('register-terms'));
    fireEvent.changeText(getByTestId('register-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'alta-parola');
    fireEvent.press(getByTestId('register-submit'));

    expect(getByText('Parolele nu coincid.')).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('apelează register din store cu date valide (email trimuit)', async () => {
    const { getByTestId } = renderRegister();

    fireEvent.press(getByTestId('register-terms'));
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

  /* --- Acordul cu Termenii (App Store Guideline 1.2) --- */

  it('butonul de înregistrare este dezactivat cât timp termenii nu sunt acceptați', () => {
    const { getByTestId } = renderRegister();

    const submit = getByTestId('register-submit');
    expect(submit.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(getByTestId('register-terms'));
    expect(getByTestId('register-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('NU apelează register cu date valide dacă termenii nu sunt bifați', async () => {
    const { getByTestId } = renderRegister();

    fireEvent.changeText(getByTestId('register-email'), 'nume@exemplu.com');
    fireEvent.changeText(getByTestId('register-password'), 'parola123');
    fireEvent.changeText(getByTestId('register-confirm'), 'parola123');
    fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => expect(mockRegister).not.toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('bifa poate fi și scoasă, iar butonul redevine dezactivat', () => {
    const { getByTestId } = renderRegister();

    fireEvent.press(getByTestId('register-terms'));
    fireEvent.press(getByTestId('register-terms'));

    expect(getByTestId('register-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('afișează mențiunea de toleranță zero și linkurile legale', () => {
    const { getByTestId, getByText } = renderRegister();

    expect(
      getByText(/toleranță zero față de conținutul abuziv/i),
    ).toBeTruthy();

    fireEvent.press(getByTestId('register-terms-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.termsUrl);

    fireEvent.press(getByTestId('register-privacy-link'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.privacyUrl);
  });
});
