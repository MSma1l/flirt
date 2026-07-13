import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert, Linking } from 'react-native';

import SetariScreen from '../setari';
import { config } from '@/config';
import { ThemeProvider } from '@theme/index';
import type { Settings } from '@/features/settings/settingsApi';

// Linkurile legale se deschid în browser — spionăm, nu deschidem nimic.
const mockOpenURL = jest
  .spyOn(Linking, 'openURL')
  .mockImplementation(() => Promise.resolve(true));

// Mock router (evită navigarea reală expo-router în teste).
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

// Mock store de auth: ecranul citește `user` și `logout`.
const mockLogout = jest.fn(() => Promise.resolve());
const authState = { user: { id: 'u1', email: 'nume@exemplu.com' }, logout: mockLogout };
jest.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

// Mock la settingsApi: fetch controlat + spionăm update / delete.
const baseSettings: Settings = {
  theme: 'light',
  searchRadiusKm: 25,
  notifications: {
    match: true,
    messages: true,
    aiHints: false,
    events: true,
    promos: false,
  },
  profileHidden: false,
  region: 'MD',
};
const mockFetchSettings = jest.fn(() => Promise.resolve(baseSettings));
const mockUpdateSettings = jest.fn((_patch: unknown) => Promise.resolve(baseSettings));
const mockRequestDeletion = jest.fn(() =>
  Promise.resolve({ requestedAt: '2026-07-07', purgeAfter: '2026-07-21' }),
);
const mockCancelDeletion = jest.fn(() => Promise.resolve());

jest.mock('@/features/settings/settingsApi', () => ({
  fetchSettings: () => mockFetchSettings(),
  updateSettings: (patch: unknown) => mockUpdateSettings(patch),
  requestAccountDeletion: () => mockRequestDeletion(),
  cancelAccountDeletion: () => mockCancelDeletion(),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <SetariScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('SetariScreen', () => {
  beforeEach(() => {
    mockFetchSettings.mockClear();
    mockUpdateSettings.mockClear();
    mockRequestDeletion.mockClear();
    mockCancelDeletion.mockClear();
    mockLogout.mockClear();
  });

  it('schimbarea temei apelează updateSettings({theme})', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('theme-dark'));
    fireEvent.press(getByTestId('theme-dark'));

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  it('toggle notificare apelează updateSettings cu patch parțial', async () => {
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('notif-match'));
    fireEvent(getByTestId('notif-match'), 'valueChange', false);

    await waitFor(() => {
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        notifications: { match: false },
      });
    });
  });

  it('butonul „Șterge contul" declanșează confirmarea (Alert)', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('delete-account'));
    fireEvent.press(getByTestId('delete-account'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('Ștergere cont');
    // Cererea de ștergere se trimite doar după confirmare, nu la deschiderea dialogului.
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  /* --- Legal & suport (App Store Guideline 1.2 / 5.1.1) --- */

  it('expune Termenii, Politica de confidențialitate și Suportul', async () => {
    const { getByTestId, getByText } = renderScreen();

    await waitFor(() => getByTestId('link-terms'));
    expect(getByText('Termeni și condiții')).toBeTruthy();
    expect(getByText('Politica de confidențialitate')).toBeTruthy();
    expect(getByText('Suport')).toBeTruthy();
  });

  it('linkurile legale deschid URL-urile din config (nu hardcodate în ecran)', async () => {
    mockOpenURL.mockClear();
    const { getByTestId } = renderScreen();

    await waitFor(() => getByTestId('link-terms'));

    fireEvent.press(getByTestId('link-terms'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.termsUrl);

    fireEvent.press(getByTestId('link-privacy'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.privacyUrl);

    fireEvent.press(getByTestId('link-support'));
    expect(mockOpenURL).toHaveBeenCalledWith(config.legal.supportUrl);
  });
});
