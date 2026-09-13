/**
 * Hook-ul de capabilități: o singură cerere, o singură autoritate (serverul), și
 * comportamentul când ruta NU răspunde.
 *
 * Partea cu adevărat importantă e ultima: dacă `GET /capabilities` cade sau
 * lipsește (backend mai vechi → 404), harta rămâne goală și TOTUL e ascuns.
 * Alegerea e deliberată — o funcție bună ascunsă o zi se repară cu un deploy, o
 * insignă de încredere falsă arătată o zi se plătește în încredere.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';
import { createTestQueryClient } from '@/test/harness';

import { CAPABILITY } from '../capabilitiesApi';
import { useCapabilities, useCapability } from '../useCapabilities';

function wrapper() {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Timp de așteptare peste cele două încercări ale query-ului (400 ms între ele). */
const WAIT = { timeout: 3000 };

describe('useCapability', () => {
  it('funcția e vizibilă când serverul o declară disponibilă', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { face_verification: true } } as never);

    const { result } = renderHook(() => useCapability(CAPABILITY.faceVerification), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(true);
  });

  it('funcția e ascunsă când serverul o declară indisponibilă', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { face_verification: false } } as never);

    const { result } = renderHook(() => useCapability(CAPABILITY.faceVerification), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.enabled).toBe(false);
  });

  it('cât timp încă nu știm, funcția NU e considerată disponibilă', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined) as never);

    const { result } = renderHook(() => useCapability(CAPABILITY.faceVerification), {
      wrapper: wrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.enabled).toBe(false);
  });

  it('ruta care nu răspunde ascunde funcția, nu o arată', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Network Error'));

    const { result } = renderHook(() => useCapability(CAPABILITY.faceVerification), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), WAIT);
    expect(result.current.enabled).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useCapabilities', () => {
  it('întreabă serverul O SINGURĂ dată, oricâte ecrane ar folosi hook-ul', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { push: true } } as never);
    const Wrapper = wrapper();

    const first = renderHook(() => useCapabilities(), { wrapper: Wrapper });
    const second = renderHook(() => useCapabilities(), { wrapper: Wrapper });

    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));

    expect(get).toHaveBeenCalledTimes(1);
  });

  /**
   * Stratul e GENERAL: următoarea funcție ascunsă (push, plăți) nu cere o a doua
   * implementare, doar un nume în plus în răspunsul serverului.
   */
  it('răspunde pentru orice funcție, nu doar pentru verificare', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { face_verification: false, push: true, payments: false },
    } as never);

    const { result } = renderHook(() => useCapabilities(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isEnabled(CAPABILITY.push)).toBe(true);
    expect(result.current.isEnabled(CAPABILITY.payments)).toBe(false);
    expect(result.current.isEnabled(CAPABILITY.faceVerification)).toBe(false);
  });
});
