/**
 * Numele și emailul primite de la „Sign in with Apple".
 *
 * Apple le trimite O SINGURĂ DATĂ — la PRIMA autentificare a userului în app.
 * La orice login ulterior `fullName` și `email` vin `null`, iar Apple nu oferă
 * niciun API prin care să le mai ceri. Dacă nu le salvăm în acel moment, sunt
 * pierdute definitiv (userul ar trebui să-și revoce manual accesul din setările
 * iOS ca să le primim din nou). De aceea le persistăm imediat, înainte de a
 * trimite tokenul spre backend — dacă loginul cade pe rețea, datele rămân.
 *
 * Backend-ul NU primește aceste câmpuri: `POST /auth/apple` acceptă strict
 * `id_token`, iar identitatea userului o derivă din claim-ul `sub`. Numele ne
 * folosește doar local, ca să precompletăm câmpul „nume" din anketă.
 *
 * Stocare: SecureStore (Keychain/Keystore) — sunt date personale, nu le ținem
 * în clar în AsyncStorage.
 *
 * Pe WEB: SecureStore nu există și aruncă la primul apel (ex. `getItemAsync`),
 * ceea ce ar rupe ecranul de login încă de la montare. Dar „Sign in with Apple"
 * nici nu funcționează în browser, deci datele one-shot de la Apple nu apar
 * oricum pe web. Cădem pe `localStorage` (ca `tokenStore`), strict ca fallback
 * inofensiv, ca apelurile să nu arunce — pe producția mobilă rămâne SecureStore.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const APPLE_IDENTITY_KEY = 'flirt.apple_identity';

/**
 * Storage uniformizat web/nativ pentru identitatea Apple. Pe nativ e SecureStore
 * (criptat de sistem); pe web e `localStorage` — singura persistență din browser,
 * folosită doar ca fallback ca apelurile să nu arunce (Apple Sign-In lipsește pe web).
 *
 * `Platform.OS` se citește la fiecare apel (nu cache la nivel de modul): în
 * producție nu se schimbă, iar așa comportamentul web e verificabil în teste.
 */
const identityStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') {
      try {
        return globalThis.localStorage?.getItem(APPLE_IDENTITY_KEY) ?? null;
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(APPLE_IDENTITY_KEY);
  },
  async set(value: string): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(APPLE_IDENTITY_KEY, value);
      return;
    }
    await SecureStore.setItemAsync(APPLE_IDENTITY_KEY, value);
  },
  async remove(): Promise<void> {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(APPLE_IDENTITY_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(APPLE_IDENTITY_KEY);
  },
};

/** Datele one-shot de la Apple, atât cât a acceptat userul să ne dea. */
export interface AppleIdentity {
  /** Numele complet („Ion Popescu"), gol dacă userul a refuzat scope-ul. */
  name: string;
  /** Emailul (real sau cel mascat `@privaterelay.appleid.com`), gol dacă lipsește. */
  email: string;
}

/** Compune numele afișabil din părțile trimise de Apple (oricare poate lipsi). */
export function formatAppleName(
  fullName: { givenName?: string | null; familyName?: string | null } | null,
): string {
  if (!fullName) return '';
  return [fullName.givenName, fullName.familyName]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' ')
    .trim();
}

/** Citește identitatea Apple salvată local. `null` dacă n-am primit-o niciodată. */
export async function getSavedAppleIdentity(): Promise<AppleIdentity | null> {
  try {
    const raw = await identityStore.get();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppleIdentity>;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      email: typeof parsed.email === 'string' ? parsed.email : '',
    };
  } catch {
    // Storage indisponibil sau JSON corupt: lipsa numelui nu e un motiv să
    // blocăm loginul — userul îl completează manual în anketă.
    return null;
  }
}

/**
 * Salvează numele/emailul primite de la Apple, FĂRĂ să șteargă ce știam deja.
 *
 * La loginurile 2..n Apple trimite `null` pe ambele câmpuri; dacă am scrie orbește,
 * am suprascrie cu gol exact datele pe care le-am prins la primul login. De aceea
 * un câmp gol nu suprascrie niciodată unul salvat anterior.
 */
export async function rememberAppleIdentity(input: AppleIdentity): Promise<void> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name && !email) return; // login ulterior: Apple nu mai trimite nimic

  try {
    const saved = await getSavedAppleIdentity();
    const next: AppleIdentity = {
      name: name || saved?.name || '',
      email: email || saved?.email || '',
    };
    await identityStore.set(JSON.stringify(next));
  } catch {
    // Vezi mai sus: eșecul de scriere nu trebuie să rupă autentificarea.
  }
}

/** Șterge identitatea salvată (la logout / ștergerea contului). */
export async function clearSavedAppleIdentity(): Promise<void> {
  try {
    await identityStore.remove();
  } catch {
    /* nimic de făcut: cheia oricum nu mai e citită după logout */
  }
}
