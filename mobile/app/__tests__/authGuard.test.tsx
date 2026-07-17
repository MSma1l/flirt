/**
 * Testele porții de navigare: unde ajunge userul și, mai ales, unde NU rămâne
 * blocat. Randăm doar `AuthGuard`, nu tot layout-ul (fonturi, push, Stack).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthGuard } from '../_layout';
import { useHumorGateStore } from '@/features/humor/humorGate';
import { HumorProfile } from '@/features/humor/types';

// expo-router: spionăm `replace` și controlăm ruta curentă prin `useSegments`.
const mockReplace = jest.fn();
let mockSegments: string[] = ['(tabs)'];
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useSegments: () => mockSegments,
  Stack: () => null,
}));

// Fonturile și puntea de notificări nu au ce căuta în testul de navigare.
jest.mock('@expo-google-fonts/manrope', () => ({
  useFonts: () => [true],
  Manrope_400Regular: 'Manrope_400Regular',
  Manrope_500Medium: 'Manrope_500Medium',
  Manrope_700Bold: 'Manrope_700Bold',
}));
jest.mock('@/features/push/PushBridge', () => ({ PushBridge: () => null }));

// Store de auth fals, dar zustand REAL (guard-ul citește prin selectori).
jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useAuthStore: create(() => ({ status: 'loading', user: null })),
  };
});
// Importul stă sub `jest.mock` intenționat: aducem store-ul FALS, nu pe cel real.
import { useAuthStore } from '@/store/authStore';

const mockFetchHumor = jest.fn<Promise<HumorProfile>, []>();
jest.mock('@/features/humor/humorApi', () => ({
  fetchHumor: () => mockFetchHumor(),
  fetchQuiz: jest.fn(),
  submitQuiz: jest.fn(),
}));

type AuthShape = {
  status: string;
  user: { id: string; email: string; profile_completed: boolean } | null;
};
const setAuth = (state: AuthShape) =>
  (useAuthStore as unknown as { setState: (s: AuthShape) => void }).setState(state);

const COMPLETE_PROFILE: AuthShape = {
  status: 'authenticated',
  user: { id: 'u1', email: 'ana@flirt.md', profile_completed: true },
};

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthGuard />
    </QueryClientProvider>,
  );
}

describe('AuthGuard + poarta testului de umor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useHumorGateStore.getState().reset();
    mockSegments = ['(tabs)'];
  });

  it('user cu anketă completă dar FĂRĂ date de umor → e dus la quiz, nu în feed', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/humor'));
  });

  it('user care a dat deja quiz-ul → NU e trimis la quiz', async () => {
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 1 } });
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('`GET /humor/me` cade (500) → userul NU rămâne blocat între ecrane', async () => {
    mockFetchHumor.mockRejectedValue(new Error('Request failed with status code 500'));
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    // Nici la quiz (n-are ce citi), nici scos din aplicație: rămâne unde e.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('deja pe ecranul de quiz → NU se redirecționează la el (fără buclă)', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    mockSegments = ['humor'];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('quiz terminat cât timp userul e pe ecran → poarta îl lasă în pace', async () => {
    // Ecranul de quiz pune rezultatul în cache-ul porții; verificăm că din acel
    // moment guard-ul nu-l mai trimite nicăieri: quiz → feed → guard → quiz e
    // exact bucla de evitat.
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 1 } });
    mockSegments = ['humor'];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    mockSegments = ['(tabs)'];
    setAuth({ ...COMPLETE_PROFILE });

    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
  });

  it('anketa neterminată → onboarding, nu quiz (întâi profilul, apoi umorul)', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    setAuth({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: false },
    });
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(onboarding)'));
    expect(mockReplace).not.toHaveBeenCalledWith('/humor');
  });

  it('neautentificat → welcome, poarta de umor nu se bagă', async () => {
    setAuth({ status: 'unauthenticated', user: null });
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/welcome'));
    expect(mockFetchHumor).not.toHaveBeenCalled();
  });

  it('quiz marcat indisponibil în sesiune → userul intră în feed din (onboarding)', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    useHumorGateStore.getState().markUnavailable('u1');
    mockSegments = ['(onboarding)'];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete'));
  });
});
