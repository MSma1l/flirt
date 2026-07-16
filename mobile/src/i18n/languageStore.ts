/**
 * Persistarea limbii alese de utilizator.
 *
 * Folosim EXACT mecanismul din `@/services/tokenStore` (SecureStore pe nativ,
 * `localStorage` pe web), pentru că e singura persistență a proiectului și nu
 * are rost să introducem o dependință nouă (AsyncStorage) pentru o cheie.
 * Limba nu e un secret, dar SecureStore e la fel de potrivit ca stocare
 * cheie-valoare, iar uniformitatea contează mai mult aici decât micro-optimizarea.
 *
 * Toate operațiile înghit erorile: limba e o preferință, nu o funcție critică —
 * dacă stocarea nu merge, aplicația trebuie să pornească oricum, pe `ro`.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { isSupportedLanguage, type Language } from './config';

const LANGUAGE_KEY = 'flirt.language';

const isWeb = Platform.OS === 'web';

export const languageStore = {
  /** Limba salvată anterior, sau `null` dacă userul nu a ales încă / stocarea a eșuat. */
  async get(): Promise<Language | null> {
    try {
      const raw = isWeb
        ? (globalThis.localStorage?.getItem(LANGUAGE_KEY) ?? null)
        : await SecureStore.getItemAsync(LANGUAGE_KEY);

      return isSupportedLanguage(raw) ? raw : null;
    } catch {
      return null;
    }
  },

  /** Salvează alegerea explicită a utilizatorului. */
  async set(language: Language): Promise<void> {
    try {
      if (isWeb) {
        globalThis.localStorage?.setItem(LANGUAGE_KEY, language);
        return;
      }
      await SecureStore.setItemAsync(LANGUAGE_KEY, language);
    } catch {
      /* preferința rămâne doar pe sesiunea curentă */
    }
  },

  /** Șterge preferința (revenire la limba dispozitivului la următoarea pornire). */
  async clear(): Promise<void> {
    try {
      if (isWeb) {
        globalThis.localStorage?.removeItem(LANGUAGE_KEY);
        return;
      }
      await SecureStore.deleteItemAsync(LANGUAGE_KEY);
    } catch {
      /* nimic de făcut */
    }
  },
};
