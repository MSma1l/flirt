import { Platform } from 'react-native';

import { clearSavedAppleIdentity, getSavedAppleIdentity } from '../appleIdentity';
import {
  getAppleIdToken,
  getAvailableSocialProviders,
  getGoogleIdToken,
  isAppleAuthAvailable,
  isCanceled,
  isGoogleAuthConfigured,
  SocialAuthError,
} from '../socialAuth';

// Client ID-urile se citesc la FIECARE apel, deci un getter ne lasă să simulăm
// „userul n-a completat încă ID-urile" fără să reîncărcăm modulul.
const mockGoogleAuth = { clientIdIos: '', clientIdAndroid: '', clientIdWeb: '' };
jest.mock('@/config', () => ({
  config: {
    get googleAuth() {
      return mockGoogleAuth;
    },
  },
}));

const mockIsAvailableAsync = jest.fn<Promise<boolean>, []>();
const mockSignInAsync = jest.fn();
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: () => mockIsAvailableAsync(),
  signInAsync: (options: unknown) => mockSignInAsync(options),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const mockPromptAsync = jest.fn();
const mockExchangeCodeAsync = jest.fn();
jest.mock('expo-auth-session', () => ({
  ResponseType: { Code: 'code' },
  makeRedirectUri: () => 'eu.flirt.app:/oauthredirect',
  exchangeCodeAsync: (config: unknown, discovery: unknown) =>
    mockExchangeCodeAsync(config, discovery),
  AuthRequest: class {
    codeVerifier = 'verifier-123';
    constructor(request: unknown) {
      this.request = request;
    }
    request: unknown;
    promptAsync(discovery: unknown) {
      return mockPromptAsync(discovery);
    }
  },
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'nonce-fixat' }));

/** Rescrie `Platform.OS` (getter în RN) pentru un singur test. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

/** Eroarea de anulare aruncată de modulul nativ Apple. */
function appleCancelError() {
  return Object.assign(new Error('The user canceled the authorization attempt.'), {
    code: 'ERR_REQUEST_CANCELED',
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockGoogleAuth.clientIdIos = '';
  mockGoogleAuth.clientIdAndroid = '';
  mockGoogleAuth.clientIdWeb = '';
  setPlatform('ios');
  await clearSavedAppleIdentity();
});

describe('Google', () => {
  it('întoarce id_token-ul real după schimbul PKCE al codului', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id.apps.googleusercontent.com';
    mockPromptAsync.mockResolvedValue({ type: 'success', params: { code: 'cod-abc' } });
    mockExchangeCodeAsync.mockResolvedValue({ idToken: 'google-id-token-real' });

    await expect(getGoogleIdToken()).resolves.toBe('google-id-token-real');

    // Dovada PKCE trebuie să însoțească schimbul, altfel Google respinge codul.
    const [exchangeConfig] = mockExchangeCodeAsync.mock.calls[0];
    expect(exchangeConfig).toMatchObject({
      clientId: 'ios-client-id.apps.googleusercontent.com',
      code: 'cod-abc',
      redirectUri: 'eu.flirt.app:/oauthredirect',
      extraParams: { code_verifier: 'verifier-123' },
    });
  });

  it('folosește client ID-ul de Android pe Android', async () => {
    setPlatform('android');
    mockGoogleAuth.clientIdAndroid = 'android-client-id.apps.googleusercontent.com';
    mockPromptAsync.mockResolvedValue({ type: 'success', params: { code: 'cod' } });
    mockExchangeCodeAsync.mockResolvedValue({ idToken: 'token' });

    await getGoogleIdToken();

    const [exchangeConfig] = mockExchangeCodeAsync.mock.calls[0];
    expect(exchangeConfig).toMatchObject({
      clientId: 'android-client-id.apps.googleusercontent.com',
    });
  });

  it('fără client ID: `not_configured`, fără să deschidă browserul', async () => {
    await expect(getGoogleIdToken()).rejects.toMatchObject({ code: 'not_configured' });
    expect(mockPromptAsync).not.toHaveBeenCalled();
    expect(isGoogleAuthConfigured()).toBe(false);
  });

  it('userul anulează → `canceled`, recunoscut de isCanceled()', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockPromptAsync.mockResolvedValue({ type: 'cancel' });

    const error = await getGoogleIdToken().catch((e: unknown) => e);
    expect(isCanceled(error)).toBe(true);
    expect(mockExchangeCodeAsync).not.toHaveBeenCalled();
  });

  it('userul închide browserul (`dismiss`) → tot `canceled`', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockPromptAsync.mockResolvedValue({ type: 'dismiss' });

    const error = await getGoogleIdToken().catch((e: unknown) => e);
    expect(isCanceled(error)).toBe(true);
  });

  it('rețea căzută la schimbul codului → `failed`', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockPromptAsync.mockResolvedValue({ type: 'success', params: { code: 'cod' } });
    mockExchangeCodeAsync.mockRejectedValue(new Error('Network request failed'));

    await expect(getGoogleIdToken()).rejects.toMatchObject({ code: 'failed' });
  });

  it('schimb reușit dar fără id_token → `no_token`', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockPromptAsync.mockResolvedValue({ type: 'success', params: { code: 'cod' } });
    mockExchangeCodeAsync.mockResolvedValue({ idToken: undefined });

    await expect(getGoogleIdToken()).rejects.toMatchObject({ code: 'no_token' });
  });
});

describe('Apple', () => {
  it('întoarce identityToken-ul real', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSignInAsync.mockResolvedValue({
      identityToken: 'apple-identity-token-real',
      fullName: { givenName: 'Ion', familyName: 'Popescu' },
      email: 'ion@privaterelay.appleid.com',
    });

    await expect(getAppleIdToken()).resolves.toBe('apple-identity-token-real');
    expect(mockSignInAsync).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: [0, 1] }),
    );
  });

  it('salvează numele și emailul primite O SINGURĂ dată de la Apple', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSignInAsync.mockResolvedValue({
      identityToken: 'token-1',
      fullName: { givenName: 'Ion', familyName: 'Popescu' },
      email: 'ion@example.com',
    });

    await getAppleIdToken();

    await expect(getSavedAppleIdentity()).resolves.toEqual({
      name: 'Ion Popescu',
      email: 'ion@example.com',
    });
  });

  it('la loginul următor Apple trimite null — datele salvate NU se pierd', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSignInAsync.mockResolvedValue({
      identityToken: 'token-1',
      fullName: { givenName: 'Ion', familyName: 'Popescu' },
      email: 'ion@example.com',
    });
    await getAppleIdToken();

    // Al doilea login: Apple nu mai trimite nici numele, nici emailul.
    mockSignInAsync.mockResolvedValue({
      identityToken: 'token-2',
      fullName: null,
      email: null,
    });
    await expect(getAppleIdToken()).resolves.toBe('token-2');

    await expect(getSavedAppleIdentity()).resolves.toEqual({
      name: 'Ion Popescu',
      email: 'ion@example.com',
    });
  });

  it('userul anulează dialogul Apple → `canceled`', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSignInAsync.mockRejectedValue(appleCancelError());

    const error = await getAppleIdToken().catch((e: unknown) => e);
    expect(isCanceled(error)).toBe(true);
  });

  it('pe Android nu e disponibil → `unavailable`, fără apel nativ', async () => {
    setPlatform('android');

    await expect(isAppleAuthAvailable()).resolves.toBe(false);
    await expect(getAppleIdToken()).rejects.toMatchObject({ code: 'unavailable' });
    expect(mockSignInAsync).not.toHaveBeenCalled();
  });

  it('credențial fără identityToken → `no_token`, dar numele tot se salvează', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);
    mockSignInAsync.mockResolvedValue({
      identityToken: null,
      fullName: { givenName: 'Ana', familyName: null },
      email: null,
    });

    await expect(getAppleIdToken()).rejects.toMatchObject({ code: 'no_token' });
    // Apple nu-l mai trimite niciodată — îl salvăm chiar dacă tokenul lipsește.
    await expect(getSavedAppleIdentity()).resolves.toEqual({ name: 'Ana', email: '' });
  });
});

describe('getAvailableSocialProviders (Guideline 4.8)', () => {
  it('iOS cu ambele disponibile: le arată pe amândouă', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockIsAvailableAsync.mockResolvedValue(true);

    await expect(getAvailableSocialProviders()).resolves.toEqual({
      google: true,
      apple: true,
    });
  });

  it('iOS fără client ID Google: rămâne doar Apple', async () => {
    mockIsAvailableAsync.mockResolvedValue(true);

    await expect(getAvailableSocialProviders()).resolves.toEqual({
      google: false,
      apple: true,
    });
  });

  it('iOS cu Google dar fără Apple: ASCUNDE și Google (ori amândouă, ori niciunul)', async () => {
    mockGoogleAuth.clientIdIos = 'ios-client-id';
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(getAvailableSocialProviders()).resolves.toEqual({
      google: false,
      apple: false,
    });
  });

  it('Android: Google singur e permis, Apple nu apare', async () => {
    setPlatform('android');
    mockGoogleAuth.clientIdAndroid = 'android-client-id';

    await expect(getAvailableSocialProviders()).resolves.toEqual({
      google: true,
      apple: false,
    });
  });

  it('fără niciun client ID configurat: niciun buton, fără excepție', async () => {
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(getAvailableSocialProviders()).resolves.toEqual({
      google: false,
      apple: false,
    });
  });
});

describe('SocialAuthError', () => {
  it('isCanceled() e fals pentru orice altă eroare', () => {
    expect(isCanceled(new SocialAuthError('failed', 'x'))).toBe(false);
    expect(isCanceled(new Error('boom'))).toBe(false);
    expect(isCanceled(null)).toBe(false);
  });
});
