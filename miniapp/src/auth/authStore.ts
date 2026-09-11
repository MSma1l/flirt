/**
 * Starea de autentificare a Mini App-ului (Zustand, ca pe mobil).
 *
 * Diferența față de `mobile/src/store/authStore.ts`: nu există login cu parolă,
 * nici hidratare dintr-un refresh token persistat. Singura cale de intrare e
 * `initData` de la Telegram, iar ea se reia la fiecare pornire.
 */
import { create } from 'zustand';

import { api, setReauthHandler, setUnauthorizedHandler, tokenStore } from '@/api/client';
import { getUnsafeUser } from '@/telegram/bridge';

import {
  authenticateWithTelegram,
  TelegramAuthError,
  type AuthErrorKind,
} from './telegramAuth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';

export interface AuthUser {
  id: string;
  email: string;
  profile_completed: boolean;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  error: AuthErrorKind | null;
  /**
   * Numele NEVERIFICAT din `initDataUnsafe`, afișat cât timp cererea e în zbor.
   * Nu e dovadă de identitate — doar ca ecranul de pornire să nu fie gol.
   */
  optimisticName: string | null;
  signIn: () => Promise<void>;
  signOut: () => void;
}

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  error: null,
  optimisticName: null,

  signIn: async () => {
    const unsafe = getUnsafeUser();
    set({
      status: 'loading',
      error: null,
      optimisticName: unsafe?.first_name ?? null,
    });

    try {
      const pair = await authenticateWithTelegram();
      tokenStore.setTokens(pair.access_token, pair.refresh_token);
      const user = await fetchMe();
      set({ status: 'authenticated', user, error: null });
    } catch (error) {
      tokenStore.clear();
      const kind =
        error instanceof TelegramAuthError
          ? error.kind
          : // `/auth/me` a picat după un token valid: e o problemă de server,
            // nu de identitate.
            'server';
      set({ status: 'error', user: null, error: kind });
    }
  },

  signOut: () => {
    tokenStore.clear();
    set({ status: 'idle', user: null, error: null });
  },
}));

/**
 * Sesiune expirată în timpul folosirii: clientul HTTP ne anunță, noi scoatem
 * utilizatorul din starea „autentificat".
 */
setUnauthorizedHandler(() => {
  tokenStore.clear();
  useAuthStore.setState({ status: 'error', user: null, error: 'expired' });
});

/**
 * Reînnoire fără refresh token: clientul HTTP cere o reautentificare din
 * `initData`. Merge fiindcă datele Telegram sunt disponibile în permanență, nu
 * doar la pornire — de aceea nici nu persistăm nimic în browser.
 */
setReauthHandler(async () => {
  try {
    return await authenticateWithTelegram();
  } catch {
    return null;
  }
});
