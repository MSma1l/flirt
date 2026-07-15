/** Stocarea tokenurilor: access în memorie (volatil), refresh persistat.
 *
 * Pe NATIV: refresh în SecureStore (Keychain/Keystore) — criptat de sistem.
 * Pe WEB: SecureStore nu există și aruncă la primul apel, ceea ce ar bloca
 * aplicația la boot (verificarea sesiunii rulează la pornire). Pe web cădem pe
 * `localStorage`, singura opțiune de persistare din browser. Web-ul e folosit
 * doar pentru testare/preview — pe producția mobilă rămâne SecureStore.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_KEY = 'flirt.refresh_token';

const isWeb = Platform.OS === 'web';

/** Persistență a refresh-token-ului, uniformizată pe web și nativ. */
const refreshStore = {
  async get(): Promise<string | null> {
    if (isWeb) {
      try {
        return globalThis.localStorage?.getItem(REFRESH_KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async set(value: string): Promise<void> {
    if (isWeb) {
      globalThis.localStorage?.setItem(REFRESH_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(REFRESH_KEY, value);
  },
  async remove(): Promise<void> {
    if (isWeb) {
      globalThis.localStorage?.removeItem(REFRESH_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

let accessToken: string | null = null;

export const tokenStore = {
  getAccess: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },
  getRefresh: () => refreshStore.get(),
  async setTokens(access: string, refresh: string) {
    accessToken = access;
    await refreshStore.set(refresh);
  },
  async clear() {
    accessToken = null;
    await refreshStore.remove();
  },
};
