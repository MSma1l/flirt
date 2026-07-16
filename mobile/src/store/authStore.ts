/** Store global de autentificare (Zustand). Fără hardcodare — totul prin api. */
import { create } from 'zustand';

import { unregisterDevice } from '@/features/push/pushService';
import { api, setUnauthorizedHandler } from '@/services/api';
import { tokenStore } from '@/services/tokenStore';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthUser {
  id: string;
  email: string;
  profile_completed: boolean;
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithProvider: (provider: 'google' | 'apple', idToken: string) => Promise<void>;
  requestPhoneOtp: (phone: string) => Promise<void>;
  verifyPhoneOtp: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  forceLogout: () => Promise<void>;
  hydrate: () => Promise<void>;
  setProfileCompleted: (v: boolean) => void;
}

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  register: async (email, password) => {
    const { data } = await api.post<TokenPair>('/auth/register', { email, password });
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  login: async (email, password) => {
    const { data } = await api.post<TokenPair>('/auth/login', { email, password });
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  loginWithProvider: async (provider, idToken) => {
    const { data } = await api.post<TokenPair>(`/auth/${provider}`, { id_token: idToken });
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  requestPhoneOtp: async (phone) => {
    await api.post('/auth/phone/request', { phone });
  },

  verifyPhoneOtp: async (phone, code) => {
    const { data } = await api.post<TokenPair>('/auth/phone/verify', { phone, code });
    await tokenStore.setTokens(data.access_token, data.refresh_token);
    const user = await fetchMe();
    set({ status: 'authenticated', user });
  },

  logout: async () => {
    // ÎNAINTE de a șterge tokenurile: cererea de dezînregistrare are nevoie de
    // Bearer-ul userului care pleacă. Altfel dispozitivul rămâne legat de contul
    // lui, iar următorul user de pe acest telefon i-ar primi notificările.
    await unregisterDevice();

    const refresh = await tokenStore.getRefresh();
    try {
      if (refresh) await api.post('/auth/logout', { refresh_token: refresh });
    } catch {
      /* revocarea locală rămâne validă chiar dacă serverul nu răspunde */
    }
    await get().forceLogout();
  },

  /**
   * Ieșire forțată, fără drum de întoarcere la server: golește tokenurile și
   * trece store-ul pe `unauthenticated`, ca AuthGuard să ducă userul la login.
   * Folosit când sesiunea a expirat (refresh eșuat) — acolo nu mai avem cu ce
   * chema /auth/logout, deci nu încercăm.
   */
  forceLogout: async () => {
    await tokenStore.clear();
    set({ status: 'unauthenticated', user: null });
  },

  hydrate: async () => {
    const refresh = await tokenStore.getRefresh();
    if (!refresh) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    try {
      const { data } = await api.post<TokenPair>('/auth/refresh', {
        refresh_token: refresh,
      });
      await tokenStore.setTokens(data.access_token, data.refresh_token);
      const user = await fetchMe();
      set({ status: 'authenticated', user });
    } catch {
      await get().forceLogout();
    }
  },

  setProfileCompleted: (v) =>
    set((s) => (s.user ? { user: { ...s.user, profile_completed: v } } : s)),
}));

// Sesiune expirată în timpul folosirii aplicației: clientul HTTP ne anunță, noi
// scoatem userul la ecranul de login. Fără asta, store-ul rămâne „authenticated"
// cu tokenuri moarte, iar userul e blocat pe erori, fără cale de ieșire.
// `?.` doar pentru testele care mock-uiesc parțial modulul `api`: în aplicația
// reală exportul e garantat de tipuri, aici doar nu vrem să pice la import.
setUnauthorizedHandler?.(() => useAuthStore.getState().forceLogout());
