import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import Welcome from '../welcome';
import { SocialAuthError } from '@/features/auth/socialAuth';
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
  useAuthStore: (
    selector: (s: { loginWithProvider: typeof mockLoginWithProvider }) => unknown,
  ) => selector({ loginWithProvider: mockLoginWithProvider }),
}));

// Butonul oficial Apple e o vizualizare NATIVĂ — în jest o înlocuim cu un
// Pressable care păstrează `onPress` și `testID`, singurele care contează aici.
jest.mock('expo-apple-authentication', () => {
  const RealReact = require('react');
  const { Pressable } = require('react-native');
  return {
    AppleAuthenticationButton: ({
      onPress,
      testID,
    }: {
      onPress: () => void;
      testID?: string;
    }) => RealReact.createElement(Pressable, { onPress, testID, accessibilityRole: 'button' }),
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0 },
  };
});

// Achiziția tokenului social e mockată; `SocialAuthError` / `isCanceled` rămân
// coerente cu ce importă ecranul (aceeași clasă → `instanceof` funcționează).
const mockGetGoogleIdToken = jest.fn<Promise<string>, []>();
const mockGetAppleIdToken = jest.fn<Promise<string>, []>();
const mockGetAvailableSocialProviders = jest.fn();
jest.mock('@/features/auth/socialAuth', () => {
  class MockSocialAuthError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    SocialAuthError: MockSocialAuthError,
    isCanceled: (e: unknown) =>
      e instanceof MockSocialAuthError && (e as MockSocialAuthError).code === 'canceled',
    getGoogleIdToken: () => mockGetGoogleIdToken(),
    getAppleIdToken: () => mockGetAppleIdToken(),
    getAvailableSocialProviders: () => mockGetAvailableSocialProviders(),
  };
});

function renderScreen() {
  return render(
    <ThemeProvider>
      <Welcome />
    </ThemeProvider>,
  );
}

/** Eroare în stilul axios (backend-ul a respins tokenul / rețea căzută). */
function axiosLikeError(status?: number) {
  return Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response: status ? { status } : undefined,
  });
}

describe('Welcome', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Implicit: ambele providere disponibile (iOS cu client ID Google).
    mockGetAvailableSocialProviders.mockResolvedValue({ google: true, apple: true });
    mockGetGoogleIdToken.mockResolvedValue('google-id-token');
    mockGetAppleIdToken.mockResolvedValue('apple-id-token');
  });

  it('randează brandul și acțiunile de bază', async () => {
    const { getByText, getByLabelText } = renderScreen();
    expect(getByLabelText('FLIRT')).toBeTruthy();
    expect(getByText('No Regrets')).toBeTruthy();
    expect(getByText('Creează cont')).toBeTruthy();
    expect(getByText('Am deja cont')).toBeTruthy();
    await waitFor(() => expect(mockGetAvailableSocialProviders).toHaveBeenCalled());
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

  // Contul se face pe email: intrarea către telefon a fost scoasă din UI, iar fluxul
  // OTP a rămas dormant în cod. Testul păzește decizia — dacă butonul reapare fără o
  // decizie explicită (și fără Twilio), userul ajunge într-un ecran care nu poate livra
  // codul.
  it('NU există intrare către login prin telefon', () => {
    const { queryByTestId, queryByText } = renderScreen();
    expect(queryByTestId('welcome-phone')).toBeNull();
    expect(queryByText('Continuă cu telefonul')).toBeNull();
  });

  it('butonul Google trimite id_token-ul real către backend', async () => {
    const { findByTestId } = renderScreen();
    fireEvent.press(await findByTestId('welcome-google'));

    await waitFor(() => {
      expect(mockLoginWithProvider).toHaveBeenCalledWith('google', 'google-id-token');
    });
  });

  it('butonul Apple trimite identityToken-ul real către backend', async () => {
    const { findByTestId } = renderScreen();
    fireEvent.press(await findByTestId('welcome-apple'));

    await waitFor(() => {
      expect(mockLoginWithProvider).toHaveBeenCalledWith('apple', 'apple-id-token');
    });
  });

  it('fără client ID Google butonul NU apare, iar ecranul rămâne funcțional', async () => {
    mockGetAvailableSocialProviders.mockResolvedValue({ google: false, apple: true });
    const { queryByTestId, findByTestId, getByText } = renderScreen();

    await findByTestId('welcome-apple'); // disponibilitatea s-a încărcat
    expect(queryByTestId('welcome-google')).toBeNull();
    // Restul ecranului merge mai departe: emailul rămâne calea garantată spre cont.
    fireEvent.press(getByText('Am deja cont'));
    expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
  });

  it('pe Android butonul Apple nu apare', async () => {
    mockGetAvailableSocialProviders.mockResolvedValue({ google: true, apple: false });
    const { queryByTestId, findByTestId } = renderScreen();

    await findByTestId('welcome-google');
    expect(queryByTestId('welcome-apple')).toBeNull();
  });

  it('fără niciun provider configurat nu apare niciun buton social', async () => {
    mockGetAvailableSocialProviders.mockResolvedValue({ google: false, apple: false });
    const { queryByTestId } = renderScreen();

    await waitFor(() => expect(mockGetAvailableSocialProviders).toHaveBeenCalled());
    expect(queryByTestId('welcome-google')).toBeNull();
    expect(queryByTestId('welcome-apple')).toBeNull();
  });

  it('userul anulează → NU se afișează nicio eroare', async () => {
    mockGetGoogleIdToken.mockRejectedValue(
      new SocialAuthError('canceled', 'anulat de user'),
    );
    const { findByTestId, queryByTestId } = renderScreen();

    fireEvent.press(await findByTestId('welcome-google'));

    await waitFor(() => expect(mockGetGoogleIdToken).toHaveBeenCalled());
    expect(mockLoginWithProvider).not.toHaveBeenCalled();
    expect(queryByTestId('welcome-social-error')).toBeNull();
  });

  it('token respins de backend (401) → mesaj de eroare', async () => {
    mockLoginWithProvider.mockRejectedValue(axiosLikeError(401));
    const { findByTestId, getByTestId } = renderScreen();

    fireEvent.press(await findByTestId('welcome-google'));

    await waitFor(() => {
      expect(getByTestId('welcome-social-error')).toHaveTextContent(
        'Contul nu a putut fi verificat. Încearcă din nou.',
      );
    });
  });

  it('rețea căzută → mesaj despre conexiune', async () => {
    mockLoginWithProvider.mockRejectedValue(axiosLikeError());
    const { findByTestId, getByTestId } = renderScreen();

    fireEvent.press(await findByTestId('welcome-google'));

    await waitFor(() => {
      expect(getByTestId('welcome-social-error')).toHaveTextContent(
        'Nu am putut contacta serverul. Verifică conexiunea la internet.',
      );
    });
  });

  it('provider indisponibil → mesaj dedicat', async () => {
    mockGetAppleIdToken.mockRejectedValue(
      new SocialAuthError('unavailable', 'indisponibil'),
    );
    const { findByTestId, getByTestId } = renderScreen();

    fireEvent.press(await findByTestId('welcome-apple'));

    await waitFor(() => {
      expect(getByTestId('welcome-social-error')).toHaveTextContent(
        'Autentificarea Apple nu e disponibilă pe acest dispozitiv.',
      );
    });
  });
});
