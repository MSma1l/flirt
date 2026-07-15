/**
 * Identitatea one-shot de la Apple: se persistă corect pe NATIV (SecureStore) și
 * degradează curat pe WEB (localStorage), fără să arunce — pe web Apple Sign-In
 * nici nu există, dar ecranul de login nu are voie să crape la simplul import.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import {
  clearSavedAppleIdentity,
  formatAppleName,
  getSavedAppleIdentity,
  rememberAppleIdentity,
} from '../appleIdentity';

const KEY = 'flirt.apple_identity';
const originalOS = Platform.OS;

function setPlatform(os: 'web' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

const getItem = SecureStore.getItemAsync as jest.Mock;
const setItem = SecureStore.setItemAsync as jest.Mock;
const deleteItem = SecureStore.deleteItemAsync as jest.Mock;

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  jest.clearAllMocks();
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('formatAppleName', () => {
  it('compune numele din părți, ignorând golurile', () => {
    expect(formatAppleName({ givenName: 'Ion', familyName: 'Popescu' })).toBe('Ion Popescu');
    expect(formatAppleName({ givenName: 'Ion', familyName: null })).toBe('Ion');
    expect(formatAppleName(null)).toBe('');
  });
});

describe('appleIdentity — NATIV (SecureStore)', () => {
  beforeEach(() => setPlatform('ios'));

  it('salvează în SecureStore și citește înapoi, fără a atinge localStorage', async () => {
    await rememberAppleIdentity({ name: 'Ion Popescu', email: 'ion@privaterelay.appleid.com' });

    expect(setItem).toHaveBeenCalledWith(
      KEY,
      JSON.stringify({ name: 'Ion Popescu', email: 'ion@privaterelay.appleid.com' }),
    );

    const saved = await getSavedAppleIdentity();
    expect(saved).toEqual({ name: 'Ion Popescu', email: 'ion@privaterelay.appleid.com' });
  });

  it('un câmp gol (login 2..n) nu suprascrie ce știam deja', async () => {
    await rememberAppleIdentity({ name: 'Ion Popescu', email: 'ion@x.md' });
    setItem.mockClear();

    // Apple trimite null la loginurile ulterioare → nimic de suprascris.
    await rememberAppleIdentity({ name: '', email: '' });
    expect(setItem).not.toHaveBeenCalled();

    const saved = await getSavedAppleIdentity();
    expect(saved).toEqual({ name: 'Ion Popescu', email: 'ion@x.md' });
  });

  it('clear șterge cheia din SecureStore', async () => {
    await rememberAppleIdentity({ name: 'Ion', email: '' });
    await clearSavedAppleIdentity();
    expect(deleteItem).toHaveBeenCalledWith(KEY);
    expect(await getSavedAppleIdentity()).toBeNull();
  });
});

describe('appleIdentity — WEB (localStorage, NU aruncă)', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    setPlatform('web');
    store = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
  });

  it('folosește localStorage și NU atinge SecureStore (care ar arunca pe web)', async () => {
    await rememberAppleIdentity({ name: 'Ana', email: 'ana@x.md' });

    expect(setItem).not.toHaveBeenCalled();
    expect(store[KEY]).toBe(JSON.stringify({ name: 'Ana', email: 'ana@x.md' }));

    const saved = await getSavedAppleIdentity();
    expect(getItem).not.toHaveBeenCalled();
    expect(saved).toEqual({ name: 'Ana', email: 'ana@x.md' });

    await clearSavedAppleIdentity();
    expect(deleteItem).not.toHaveBeenCalled();
    expect(store[KEY]).toBeUndefined();
  });

  it('fără localStorage disponibil, citirea întoarce null în loc să arunce', async () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    await expect(getSavedAppleIdentity()).resolves.toBeNull();
  });
});
