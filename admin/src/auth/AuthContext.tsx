/**
 * Sesiunea de admin: login, restaurare la refresh de pagină, logout.
 *
 * Fluxul de login are DOI pași, pentru că backend-ul nu expune rolul în
 * `/auth/me`:
 *   1. `POST /auth/login` → perechea de token-uri (401 la credențiale greșite).
 *   2. `fetchAdminMe()` → 403 dacă acel cont NU are `role: "admin"`.
 * La 403 ștergem imediat token-urile (un cont non-admin nu are ce căuta cu o
 * sesiune deschisă în panou) și afișăm un mesaj explicit.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import * as api from '../api/admin';
import { ApiError, AUTH_EXPIRED_EVENT } from '../api/client';
import type { AdminMe } from '../api/types';
import {
  clearTokens,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from './tokenStore';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  admin: AdminMe | null;
  /** Aruncă `ApiError` (401 credențiale, 403 fără rol de admin). */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [admin, setAdmin] = useState<AdminMe | null>(null);

  // Restaurare sesiune la (re)încărcarea paginii: access token-ul e doar în
  // memorie, deci după un F5 avem doar refresh-ul → îl rotim ca să obținem
  // un access nou, apoi verificăm rolul.
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (!getRefreshToken()) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        // Orice cerere autentificată declanșează rotația de refresh la 401.
        const me = await api.fetchAdminMe();
        if (cancelled) return;
        setAdmin(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearTokens();
        setAdmin(null);
        setStatus('anonymous');
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sesiune expirată semnalată de stratul HTTP (refresh eșuat).
  useEffect(() => {
    const onExpired = (): void => {
      setAdmin(null);
      setStatus('anonymous');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<void> => {
    const pair = await api.login(email, password);
    setAccessToken(pair.access_token);
    setRefreshToken(pair.refresh_token);
    try {
      const me = await api.fetchAdminMe();
      setAdmin(me);
      setStatus('authenticated');
    } catch (error) {
      // Cont valid, dar fără drepturi de admin (403) — nu păstrăm sesiunea.
      clearTokens();
      setAdmin(null);
      setStatus('anonymous');
      throw error instanceof ApiError
        ? error
        : new ApiError(0, 'Autentificare eșuată. Încearcă din nou.');
    }
  }, []);

  const signOut = useCallback((): void => {
    const refresh = getRefreshToken();
    if (refresh) void api.logout(refresh).catch(() => undefined);
    clearTokens();
    setAdmin(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, admin, signIn, signOut }),
    [status, admin, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth trebuie folosit în interiorul <AuthProvider>');
  return context;
}
