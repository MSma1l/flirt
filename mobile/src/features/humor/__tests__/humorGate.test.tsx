import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import React from 'react';

import { hasHumorData, useHumorGate, useHumorGateStore } from '../humorGate';
import { HumorProfile } from '../types';

// Store de auth fals, dar ZUSTAND REAL: gate-ul citește prin selectori și
// trebuie să reacționeze la schimbări, exact ca în aplicație.
jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useAuthStore: create(() => ({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: true },
    })),
  };
});
// Importul stă sub `jest.mock` intenționat: aducem store-ul FALS, nu pe cel real.
import { useAuthStore } from '@/store/authStore';

const mockFetchHumor = jest.fn<Promise<HumorProfile>, []>();
jest.mock('../humorApi', () => ({
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

const AUTHENTICATED: AuthShape = {
  status: 'authenticated',
  user: { id: 'u1', email: 'ana@flirt.md', profile_completed: true },
};

function renderGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => useHumorGate(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

describe('hasHumorData', () => {
  it('vector gol (ce întoarce serverul pentru un user care n-a dat quiz-ul) → lipsă', () => {
    expect(hasHumorData({ vector: {} })).toBe(false);
  });

  it('vector cu ponderi → date prezente', () => {
    expect(hasHumorData({ vector: { sarcasm: 0.5, absurd: 0.5 } })).toBe(true);
  });

  it('vector uniform (userul a răspuns „nu prea" la tot) → tot date prezente', () => {
    // Backendul pune distribuție uniformă când nicio glumă nu i-a plăcut; e un
    // răspuns valid, nu absența quiz-ului — altfel l-am întreba la nesfârșit.
    expect(hasHumorData({ vector: { sarcasm: 0.14, dark: 0.14 } })).toBe(true);
  });

  it('răspuns lipsă/nedefinit → lipsă, fără excepție', () => {
    expect(hasHumorData(undefined)).toBe(false);
    expect(hasHumorData(null)).toBe(false);
  });
});

describe('useHumorGate', () => {
  beforeEach(() => {
    mockFetchHumor.mockReset();
    useHumorGateStore.getState().reset();
    setAuth(AUTHENTICATED);
  });

  it('user fără date de umor → e trimis la quiz', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    const { result } = renderGate();

    await waitFor(() => expect(result.current.needsQuiz).toBe(true));
  });

  it('user care a dat deja quiz-ul → NU e trimis la quiz', async () => {
    mockFetchHumor.mockResolvedValue({ vector: { sarcasm: 0.6, absurd: 0.4 } });
    const { result } = renderGate();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    expect(result.current.needsQuiz).toBe(false);
  });

  it('`GET /humor/me` cade (500) → userul NU rămâne blocat: poarta îl lasă să treacă', async () => {
    mockFetchHumor.mockRejectedValue(new Error('Request failed with status code 500'));
    const { result } = renderGate();

    await waitFor(() => expect(mockFetchHumor).toHaveBeenCalled());
    // Serverul tace → nu știm dacă lipsesc datele → nu închidem poarta.
    await waitFor(() => expect(result.current.needsQuiz).toBe(false));
  });

  it('anketa neterminată → nici măcar nu întreabă serverul (userul are treabă în onboarding)', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    setAuth({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: false },
    });
    const { result } = renderGate();

    expect(result.current.needsQuiz).toBe(false);
    await waitFor(() => expect(mockFetchHumor).not.toHaveBeenCalled());
  });

  it('user neautentificat → poarta e inactivă', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    setAuth({ status: 'unauthenticated', user: null });
    const { result } = renderGate();

    expect(result.current.needsQuiz).toBe(false);
    await waitFor(() => expect(mockFetchHumor).not.toHaveBeenCalled());
  });

  it('quiz indisponibil în sesiunea asta → poarta se deschide (fără buclă)', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    useHumorGateStore.getState().markUnavailable('u1');
    const { result } = renderGate();

    expect(result.current.needsQuiz).toBe(false);
    await waitFor(() => expect(mockFetchHumor).not.toHaveBeenCalled());
  });

  it('supapa e legată de user: alt cont pe același telefon e tot întrebat', async () => {
    mockFetchHumor.mockResolvedValue({ vector: {} });
    useHumorGateStore.getState().markUnavailable('u1');
    setAuth({
      status: 'authenticated',
      user: { id: 'u2', email: 'ion@flirt.md', profile_completed: true },
    });
    const { result } = renderGate();

    await waitFor(() => expect(result.current.needsQuiz).toBe(true));
  });
});
