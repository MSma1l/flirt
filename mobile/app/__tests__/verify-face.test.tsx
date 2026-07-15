import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

import { CAPTURE_FAILED_MESSAGE, FACE_MESSAGES } from '@/features/verification';
import { ThemeProvider } from '@theme/index';

import VerifyFaceScreen from '../verify-face';

// Mock router + Stack.Screen (evită expo-router real).
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

/**
 * Cameră nativă falsă: `CameraView` expune `takePictureAsync` prin ref (ca cea
 * reală), iar permisiunea e controlată de test. Captura pe hardware cere device
 * fizic, deci aici verificăm ce se POATE verifica: că ecranul cere poza, o trimite
 * și reacționează corect la fiecare verdict.
 */
const mockTakePicture = jest.fn();
const mockRequestPermission = jest.fn();
let mockPermission: {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
} | null = { granted: true, canAskAgain: true, status: 'granted' };

jest.mock('expo-camera', () => {
  const ReactLib = require('react');
  const { View } = require('react-native');
  return {
    CameraView: ReactLib.forwardRef((props: object, ref: unknown) => {
      ReactLib.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePicture }));
      return ReactLib.createElement(View, props);
    }),
    useCameraPermissions: () => [mockPermission, mockRequestPermission],
  };
});

// API-ul e mock-uit la nivel de transport: `verifyFace` REAL rulează deasupra,
// deci testul vede exact payload-ul care ar pleca spre backend.
jest.mock('@/services/api', () => ({ api: { post: jest.fn() } }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

/** Eroare recunoscută de `axios.isAxiosError` (fără răspuns = rețea căzută). */
function axiosError(status?: number): Error {
  return Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data: {} },
  });
}

const picture = { uri: 'file:///cache/selfie.jpg', width: 1080, height: 1440 };

/**
 * `FormData` din Node stringifică partea RN `{uri,name,type}`; spionăm `append`
 * ca să vedem fișierul REAL pe care ecranul îl trimite.
 */
let appendSpy: jest.SpyInstance;

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <VerifyFaceScreen />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = { granted: true, canAskAgain: true, status: 'granted' };
  mockTakePicture.mockResolvedValue(picture);
  appendSpy = jest.spyOn(FormData.prototype, 'append');
});

afterEach(() => appendSpy.mockRestore());

describe('VerifyFaceScreen — permisiune acordată', () => {
  it('afișează camera și butonul de verificare', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('camera-view')).toBeTruthy();
    expect(getByTestId('verify-button')).toBeTruthy();
  });

  it('NU afișează texte tehnice / de dezvoltare (App Store Guideline 2.1)', () => {
    const { queryByText } = renderScreen();
    expect(queryByText(/expo/i)).toBeNull();
    expect(queryByText(/se activează/i)).toBeNull();
    expect(queryByText(/curând/i)).toBeNull();
  });

  it('capturează selfie-ul, îl încarcă multipart și acordă badge-ul la succes', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: true, similarity: 98.2 },
    });
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => expect(getByTestId('verify-success')).toBeTruthy());

    expect(mockTakePicture).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/profiles/verify-face');
    expect(body).toBeInstanceOf(FormData);
    expect(cfg.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
    // Imaginea chiar pleacă: câmpul `file` conține fișierul capturat, nu un marcaj JSON.
    const [field, value] = appendSpy.mock.calls[0];
    expect(field).toBe('file');
    expect(value).toMatchObject({ uri: expect.any(String), type: 'image/jpeg' });
  });

  it('backend respinge (fața nu se potrivește) → mesaj clar, badge NEacordat', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: false, similarity: 0 },
    });
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => expect(getByTestId('verify-error')).toBeTruthy());
    expect(getByText(FACE_MESSAGES.no_match)).toBeTruthy();
    expect(queryByTestId('verify-success')).toBeNull();
  });

  it('cădere de rețea → mesaj de conexiune, badge NEacordat', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError(undefined));
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => expect(getByTestId('verify-error')).toBeTruthy());
    expect(getByText(FACE_MESSAGES.network)).toBeTruthy();
    expect(queryByTestId('verify-success')).toBeNull();
  });

  it('serviciul de verificare pică (5xx) → nu învinovățim utilizatorul', async () => {
    (api.post as jest.Mock).mockRejectedValue(axiosError(503));
    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => expect(getByText(FACE_MESSAGES.unavailable)).toBeTruthy());
  });

  it('captura eșuează → mesaj clar și NIMIC nu se încarcă', async () => {
    mockTakePicture.mockRejectedValue(new Error('camera busy'));
    const { getByTestId, getByText } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => expect(getByText(CAPTURE_FAILED_MESSAGE)).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('după un eșec se poate relua verificarea', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: false, similarity: 0 },
    });
    const { getByTestId, queryByTestId } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));
    await waitFor(() => expect(getByTestId('retry-button')).toBeTruthy());

    fireEvent.press(getByTestId('retry-button'));

    await waitFor(() => expect(queryByTestId('verify-error')).toBeNull());
    expect(getByTestId('verify-button')).toBeTruthy();
  });
});

describe('VerifyFaceScreen — permisiune refuzată', () => {
  it('refuz simplu → mesaj clar, cameră ascunsă, nimic încărcat', () => {
    mockPermission = { granted: false, canAskAgain: true, status: 'denied' };
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    expect(queryByTestId('camera-view')).toBeNull();
    expect(queryByTestId('verify-button')).toBeNull();
    expect(getByText(/avem nevoie de cameră/i)).toBeTruthy();
    // Ecranul NU e mort: există o acțiune care cere din nou permisiunea.
    fireEvent.press(getByTestId('grant-permission-button'));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('refuz definitiv → cale către Setări (nu doar un mesaj)', () => {
    mockPermission = { granted: false, canAskAgain: false, status: 'denied' };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const { getByTestId, queryByTestId, getByText } = renderScreen();

    expect(queryByTestId('camera-view')).toBeNull();
    expect(getByText(/deschide setările și activează camera/i)).toBeTruthy();

    fireEvent.press(getByTestId('open-settings-button'));

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('VerifyFaceScreen — navigare', () => {
  it('butonul de închidere apelează router.back', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Închide'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
