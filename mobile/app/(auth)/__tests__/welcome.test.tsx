import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Welcome from '../welcome';
import { ThemeProvider } from '@theme/index';

// Mock router (evită navigarea reală expo-router în teste).
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

// Mock store: `useAuthStore(selector)` extrage câmpul cerut dintr-un state fals.
const mockLoginWithProvider = jest.fn<Promise<void>, [string, string]>(() =>
  Promise.resolve(),
);
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { loginWithProvider: typeof mockLoginWithProvider }) => unknown) =>
    selector({ loginWithProvider: mockLoginWithProvider }),
}));

// Mock achiziția de id_token social (stub).
jest.mock('@/features/auth/socialAuth', () => ({
  getGoogleIdToken: () => Promise.resolve('stub:google@example.com'),
  getAppleIdToken: () => Promise.resolve('stub:apple@example.com'),
}));

function renderScreen() {
  return render(
    <ThemeProvider>
      <Welcome />
    </ThemeProvider>,
  );
}

describe('Welcome', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockLoginWithProvider.mockClear();
  });

  it('randează brandul și acțiunile', () => {
    const { getByText } = renderScreen();
    expect(getByText('FLIRT')).toBeTruthy();
    expect(getByText('No Regrets')).toBeTruthy();
    expect(getByText('Creează cont')).toBeTruthy();
    expect(getByText('Am deja cont')).toBeTruthy();
    expect(getByText('Continuă cu Google')).toBeTruthy();
    expect(getByText('Continuă cu Apple')).toBeTruthy();
    expect(getByText('Continuă cu telefonul')).toBeTruthy();
  });

  it('„Creează cont" navighează la register', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Creează cont'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/register');
  });

  it('„Am deja cont" navighează la login', () => {
    const { getByText } = renderScreen();
    fireEvent.press(getByText('Am deja cont'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
  });

  it('„Continuă cu telefonul" navighează la phone', () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('welcome-phone'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/phone');
  });

  it('butonul Google apelează loginWithProvider cu token-ul stub', async () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('welcome-google'));
    await waitFor(() => {
      expect(mockLoginWithProvider).toHaveBeenCalledWith('google', 'stub:google@example.com');
    });
  });

  it('butonul Apple apelează loginWithProvider cu token-ul stub', async () => {
    const { getByTestId } = renderScreen();
    fireEvent.press(getByTestId('welcome-apple'));
    await waitFor(() => {
      expect(mockLoginWithProvider).toHaveBeenCalledWith('apple', 'stub:apple@example.com');
    });
  });
});
