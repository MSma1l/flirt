/**
 * Refuzurile serverului la `POST /feed/swipe`: le recunoaștem, le ducem în
 * starea aplicației și spunem ce lipsește. Unde e trimis userul e treaba lui
 * `resolveAppRoute` — aici se testează doar traducerea 403 → fapt.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { AxiosError, AxiosHeaders } from 'axios';
import React from 'react';

import { humorMeQueryKey } from '@/features/humor/humorGate';

import {
  ANKETA_REQUIRED_DETAIL,
  classifySwipeRefusal,
  HUMOR_REQUIRED_DETAIL,
  PHOTOS_REQUIRED_DETAIL,
  useReportSwipeRefusal,
  useServerGateStore,
} from '../serverGate';

// Store de auth fals, dar zustand REAL: hook-ul citește prin selectori.
const mockRefreshUser = jest.fn();
jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    useAuthStore: create(() => ({
      status: 'authenticated',
      user: { id: 'u1', email: 'ana@flirt.md', profile_completed: true },
      refreshUser: (...args: unknown[]) => mockRefreshUser(...args),
    })),
  };
});

/** Un 403 de la server, exact cum ajunge la client prin axios. */
function forbidden(detail: string): AxiosError {
  const error = new AxiosError('Request failed with status code 403');
  error.response = {
    status: 403,
    statusText: 'Forbidden',
    data: { detail },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('classifySwipeRefusal', () => {
  it('mesajul de umor → poarta testului de umor', () => {
    expect(classifySwipeRefusal(forbidden(HUMOR_REQUIRED_DETAIL))).toBe('humor');
  });

  it('mesajul de anketă incompletă → poarta anketei', () => {
    expect(classifySwipeRefusal(forbidden(ANKETA_REQUIRED_DETAIL))).toBe('anketa');
  });

  it('mesajul de poze → poarta pozelor, deosebit de cel al anketei', () => {
    // Serverul le-a separat tocmai ca să putem trimite userul în ecrane diferite.
    expect(classifySwipeRefusal(forbidden(PHOTOS_REQUIRED_DETAIL))).toBe('photos');
    expect(PHOTOS_REQUIRED_DETAIL).not.toBe(ANKETA_REQUIRED_DETAIL);
  });

  it('alt 403 (self-swipe, gate 18+) → nicio poartă, rămâne eroare obișnuită', () => {
    expect(classifySwipeRefusal(forbidden('Nu poți face swipe pe propriul profil.'))).toBe(
      null,
    );
  });

  it('rețea moartă / 500 → nicio poartă: acolo reîncercarea chiar are sens', () => {
    expect(classifySwipeRefusal(new Error('Network Error'))).toBeNull();
    const serverError = new AxiosError('boom');
    serverError.response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: { detail: HUMOR_REQUIRED_DETAIL },
      headers: new AxiosHeaders(),
      config: { headers: new AxiosHeaders() },
    };
    expect(classifySwipeRefusal(serverError)).toBeNull();
  });

  it('răspuns fără `detail` util → nu ghicim', () => {
    expect(classifySwipeRefusal(forbidden(''))).toBeNull();
  });
});

describe('useReportSwipeRefusal', () => {
  let client: QueryClient;

  function renderReporter() {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(() => useReportSwipeRefusal(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
  }

  beforeEach(() => {
    mockRefreshUser.mockReset();
    useServerGateStore.getState().clear();
  });

  it('refuz pe umor → scrie „vector gol" în cache-ul porții, care decide mai departe', async () => {
    // 403-ul E răspunsul serverului la întrebarea porții, doar pus altfel. Fără
    // asta, un cache vechi care spune „are umor" ar aduce userul înapoi în feed.
    client = new QueryClient();
    const { result } = renderReporter();
    client.setQueryData(humorMeQueryKey('u1'), { vector: { sarcasm: 1 } });

    await waitFor(async () => {
      expect(await result.current(forbidden(HUMOR_REQUIRED_DETAIL))).toBe('humor');
    });
    expect(client.getQueryData(humorMeQueryKey('u1'))).toEqual({ vector: {} });
    expect(mockRefreshUser).not.toHaveBeenCalled();
  });

  it('anketa lipsă → recitim userul de pe server, fără vreun flag în plus', async () => {
    mockRefreshUser.mockResolvedValue({
      id: 'u1',
      email: 'ana@flirt.md',
      profile_completed: false,
    });
    const { result } = renderReporter();

    expect(await result.current(forbidden(ANKETA_REQUIRED_DETAIL))).toBe('anketa');
    // Serverul tocmai a spus că profilul nu e complet: starea locală e învechită.
    expect(mockRefreshUser).toHaveBeenCalled();
    // Anketa are deja poarta ei (`profile_completed`), n-avem ce preciza.
    expect(useServerGateStore.getState().needsPhotosForUserId).toBeNull();
  });

  it('poze lipsă → precizarea, ca `profile_completed: false` să nu ducă în wizard', async () => {
    // `profile_completed` e ȘI-ul dintre anketă și poze: `false` singur nu spune
    // care lipsește, iar wizardul de anketă ar rescrie un profil bun.
    mockRefreshUser.mockResolvedValue({
      id: 'u1',
      email: 'ana@flirt.md',
      profile_completed: false,
    });
    const { result } = renderReporter();

    expect(await result.current(forbidden(PHOTOS_REQUIRED_DETAIL))).toBe('photos');
    expect(useServerGateStore.getState().needsPhotosForUserId).toBe('u1');
    expect(mockRefreshUser).toHaveBeenCalled();
  });

  it('`GET /auth/me` nu răspunde → precizarea rămâne pusă, fără să crăpăm', async () => {
    mockRefreshUser.mockResolvedValue(null);
    const { result } = renderReporter();

    expect(await result.current(forbidden(PHOTOS_REQUIRED_DETAIL))).toBe('photos');
    expect(useServerGateStore.getState().needsPhotosForUserId).toBe('u1');
  });

  it('eroare obișnuită → nu raportează nimic (ecranul arată mesajul de rețea)', async () => {
    const { result } = renderReporter();

    expect(await result.current(new Error('Network Error'))).toBeNull();
    expect(mockRefreshUser).not.toHaveBeenCalled();
    expect(useServerGateStore.getState().needsPhotosForUserId).toBeNull();
  });
});
