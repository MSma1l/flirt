import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import VerifyFaceScreen from '../verify-face';
import { ThemeProvider } from '@theme/index';
import type { FaceVerification } from '@/features/verification/faceApi';

// Mock router + Stack.Screen (evită expo-router real).
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

// Mock la faceApi: verificarea controlată.
const mockVerifyFace = jest.fn<Promise<FaceVerification>, []>();
jest.mock('@/features/verification/faceApi', () => ({
  verifyFace: () => mockVerifyFace(),
}));

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

describe('VerifyFaceScreen', () => {
  beforeEach(() => {
    mockVerifyFace.mockReset();
    mockBack.mockReset();
  });

  it('afișează cadrul de captură și butonul de verificare', () => {
    const { getByTestId, getByText } = renderScreen();
    expect(getByTestId('camera-placeholder')).toBeTruthy();
    expect(getByText('Fă un selfie și verifică')).toBeTruthy();
  });

  it('NU afișează texte tehnice / de dezvoltare (App Store Guideline 2.1)', () => {
    const { queryByText } = renderScreen();
    expect(queryByText(/expo/i)).toBeNull();
    expect(queryByText(/se activează/i)).toBeNull();
    expect(queryByText(/curând/i)).toBeNull();
  });

  it('apelează verifyFace și afișează succesul', async () => {
    mockVerifyFace.mockResolvedValue({ verified: true, similarity: 0.9 });
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => {
      expect(mockVerifyFace).toHaveBeenCalledTimes(1);
      expect(getByTestId('verify-success')).toBeTruthy();
    });
  });

  it('afișează eroarea când verificarea nu reușește', async () => {
    mockVerifyFace.mockResolvedValue({ verified: false, similarity: 0.2 });
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => {
      expect(getByTestId('verify-error')).toBeTruthy();
    });
  });

  it('afișează eroarea când cererea aruncă', async () => {
    mockVerifyFace.mockRejectedValue(new Error('network'));
    const { getByTestId } = renderScreen();

    fireEvent.press(getByTestId('verify-button'));

    await waitFor(() => {
      expect(getByTestId('verify-error')).toBeTruthy();
    });
  });

  it('butonul de închidere apelează router.back', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Închide'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
