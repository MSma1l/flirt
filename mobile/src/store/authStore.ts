/** Store global de autentificare (Zustand). Fără hardcodare — totul prin api. */
import { create } from 'zustand';

import { unregisterDevice } from '@/features/push/pushService';
import { api } from '@/services/api';
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
  hydrate: () => Promise<void>;
  setProfileCompleted: (v: boolean) => void;
}

async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>('/auth/me');
  return data;
}

export const useAuthStore = create<AuthState>((set) => ({
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
      await tokenStore.clear();
      set({ status: 'unauthenticated', user: null });
    }
  },

  setProfileCompleted: (v) =>
    set((s) => (s.user ? { user: { ...s.user, profile_completed: v } } : s)),
}));
