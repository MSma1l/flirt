/** Stocarea tokenurilor: access în memorie (volatil), refresh în SecureStore (Keychain/Keystore). */
import * as SecureStore from 'expo-secure-store';

const REFRESH_KEY = 'flirt.refresh_token';

let accessToken: string | null = null;

export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },
  getRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  async setTokens(access: string, refresh: string) {
    accessToken = access;
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clear() {
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};
