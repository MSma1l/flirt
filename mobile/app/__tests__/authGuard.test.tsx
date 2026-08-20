/**
 * Testele porții de navigare: unde ajunge userul și, mai ales, unde NU rămâne
 * blocat. Randăm doar `AuthGuard`, nu tot layout-ul (fonturi, push, Stack).
 *
 * `AuthGuard` e SINGURUL loc care navighează. Regulile în sine (ce rută cere ce
 * stare) se testează pur în `features/navigation/__tests__/appRoute.test.ts`;
 * aici verificăm capătul viu: store-uri reale, interogare reală, `router.replace`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react-native';
import React from 'react';

import { AuthGuard } from '../_layout';
import { useHumorGateStore } from '@/features/humor/humorGate';
import { HumorProfile } from '@/features/humor/types';
import { useServerGateStore } from '@/features/navigation/serverGate';

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
    useAuthStore: create(() => ({
      status: 'loading',
      user: null,
      refreshUser: jest.fn(),
    })),
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
    useServerGateStore.getState().clear();
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

  it('cold-start pe splash (fără segmente) → poarta îl duce ea, nu ecranul', async () => {
    // Regresie: `AuthGuard` ieșea devreme pe ruta index (`path.length === 0`),
    // ca să nu se calce cu redirectul din `index.tsx`. Ecranul acela știa doar
    // de `profile_completed`, deci userul fără test de umor ateriza în feed.
    mockFetchHumor.mockResolvedValue({ vector: {} });
    mockSegments = [];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/humor'));
    expect(mockReplace).not.toHaveBeenCalledWith('/(tabs)/ankete');
  });

  it('cold-start, quiz deja dat → din splash direct în feed', async () => {
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 1 } });
    mockSegments = [];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/ankete'));
  });

  it('cât timp poarta de umor n-are verdict → nimeni nu e mutat nicăieri', async () => {
    // Fără așteptarea asta, userul ar fi dus în feed și scos înapoi la quiz o
    // clipă mai târziu — exact pâlpâitul pe care poarta trebuie să-l evite.
    let resolveHumor: (p: HumorProfile) => void = () => {};
    mockFetchHumor.mockReturnValue(
      new Promise<HumorProfile>((resolve) => {
        resolveHumor = resolve;
      }),
    );
    mockSegments = [];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();

    resolveHumor({ vector: {} });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/humor'));
  });

  it('serverul a reclamat lipsa pozelor → editorul de profil, NU wizardul de anketă', () => {
    // `profile_completed` de pe server e ȘI-ul dintre anketă și poze, deci e
    // `false` și când doar pozele lipsesc. Wizardul ar reporni de la pasul 0 cu
    // un draft gol și ar rescrie la final un profil perfect bun.
    const INCOMPLETE: AuthShape = {
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: false },
    };
    setAuth(INCOMPLETE);
    useServerGateStore.getState().requirePhotos('u1');
    renderGuard();

    expect(mockReplace).toHaveBeenCalledWith('/profile/edit');
    expect(mockReplace).not.toHaveBeenCalledWith('/(onboarding)');
  });

  it('după ce adaugă pozele, precizarea nu-l mai ține în editor', async () => {
    // Editorul recitește `/auth/me` la fiecare schimbare de poze; când flagul se
    // aprinde, precizarea rămâne fără obiect. Nimeni n-o stinge — și nici nu
    // trebuie: ea lămurește doar un `profile_completed: false`.
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 1 } });
    mockSegments = ['profile', 'edit'];
    setAuth({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: false },
    });
    useServerGateStore.getState().requirePhotos('u1');
    renderGuard();
    expect(mockReplace).not.toHaveBeenCalled(); // e deja acolo

    setAuth(COMPLETE_PROFILE);
    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    // Nici înapoi în editor, nici smuls din el: din ecranul ăsta iese singur.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('userul citește un chat → poarta deschisă nu-l smulge de acolo', async () => {
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 1 } });
    mockSegments = ['chat', '[id]'];
    setAuth(COMPLETE_PROFILE);
    renderGuard();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
