/**
 * Starea de autentificare a Mini App-ului (Zustand, ca pe mobil).
 *
 * Diferența față de `mobile/src/store/authStore.ts`: nu există login cu parolă.
 * La pornire încercăm ÎNTÂI sesiunea salvată în `sessionStorage` pentru același
 * cont Telegram (supraviețuiește unei reîncărcări a paginii) și trimitem
 * `initData` DOAR dacă ea lipsește sau nu mai poate fi reînnoită. Motivul:
 * backendul consumă fiecare `initData` o singură dată, iar după o reîncărcare
 * Telegram dă exact același șir — vezi `api/tokenStore.ts`.
 */
import { create } from 'zustand';

import { api, setReauthHandler, setUnauthorizedHandler, tokenStore } from '@/api/client';
import { getRawInitData, getUnsafeUser, isInsideTelegram } from '@/telegram/bridge';

import {
  authenticateWithTelegram,
  classifyAuthError,
  TelegramAuthError,
  type AuthErrorKind,
} from './telegramAuth';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'error';

export interface AuthUser {
  id: string;
  email: string;
  profile_completed: boolean;
  /** Aditiv (vezi `features/onboarding/useCurrentUser.ts`). */
  consent_required?: boolean;
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

/**
 * Motivul eșecului, oricare ar fi pasul la care s-a produs.
 *
 * `/auth/me` poate pica și el cu 403: `deps.get_current_user` verifică banul la
 * FIECARE cerere, nu doar la login, deci un cont blocat între emiterea tokenului
 * și prima cerere ajunge aici. Fără ramura asta ar fi fost „serverul nu
 * răspunde" — un ecran cu buton de reîncercare, adică exact bucla pe care o
 * reparăm. Restul eșecurilor de după un token valid rămân „server": nu sunt
 * despre identitate.
 */
function errorKind(error: unknown): AuthErrorKind {
  if (error instanceof TelegramAuthError) return error.kind;
  return classifyAuthError(error) === 'banned' ? 'banned' : 'server';
}

/**
 * Eșecuri care NU spun nimic despre identitate: tokenurile rămân valabile, iar
 * reîncercarea le refolosește. Dacă le-am șterge, reîncercarea ar retrimite
 * același `initData`, deja consumat — exact blocajul pe care îl evităm.
 */
const TRANZITORII: ReadonlySet<AuthErrorKind> = new Set<AuthErrorKind>(['network', 'server']);

/**
 * Motivul ultimei reautentificări eșuate din `initData` (vezi `setReauthHandler`
 * mai jos). Fără el, un `initData` deja folosit ar ajunge în interfață ca
 * „sesiune expirată", cu un buton de reîncercare garantat inutil.
 */
let lastReauthError: AuthErrorKind | null = null;

/**
 * Pornirea în curs. React StrictMode rulează efectul de două ori, iar o a doua
 * cerere cu același `initData` ar fi respinsă ca replay — deci toate apelurile
 * simultane împart ACEEAȘI promisiune.
 */
let inFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  async function run(): Promise<void> {
    const unsafe = getUnsafeUser();
    set({
      status: 'loading',
      user: null,
      error: null,
      optimisticName: unsafe?.first_name ?? null,
    });
    lastReauthError = null;
    tokenStore.bindOwner(unsafe?.id != null ? String(unsafe.id) : null);

    try {
      // Sesiunea salvată se folosește DOAR în Telegram, cu `initData` prezent
      // (după o reîncărcare el e tot acolo). În afara lui nu restaurăm nimic.
      if (!isInsideTelegram() || !getRawInitData()) {
        throw new TelegramAuthError('outside_telegram');
      }
      if (!tokenStore.restore()) {
        // Nicio sesiune utilizabilă pentru acest cont: abia acum consumăm
        // `initData`.
        const pair = await authenticateWithTelegram();
        tokenStore.setTokens(pair.access_token, pair.refresh_token);
      }
      // Cu o sesiune restaurată, un acces expirat dă 401, iar clientul HTTP
      // face singur `POST /auth/refresh` (cu rotație) și, dacă și acela e mort,
      // o SINGURĂ reautentificare din `initData`.
      const user = await fetchMe();
      set({ status: 'authenticated', user, error: null });
    } catch (error) {
      // Sesiunea s-a pierdut definitiv pe drum (refresh + `initData` refuzate):
      // handlerul de mai jos a setat deja motivul și a golit tokenurile.
      if (get().status === 'error') return;
      const kind = errorKind(error);
      if (!TRANZITORII.has(kind)) tokenStore.clear();
      set({ status: 'error', user: null, error: kind });
    }
  }

  return {
    status: 'idle',
    user: null,
    error: null,
    optimisticName: null,

    signIn: () => {
      if (!inFlight) {
        inFlight = run().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },

    signOut: () => {
      tokenStore.clear();
      set({ status: 'idle', user: null, error: null });
    },
  };
});

/**
 * Sesiune expirată în timpul folosirii: clientul HTTP ne anunță, noi scoatem
 * utilizatorul din starea „autentificat".
 */
setUnauthorizedHandler(() => {
  tokenStore.clear();
  const kind = lastReauthError ?? 'expired';
  lastReauthError = null;
  useAuthStore.setState({ status: 'error', user: null, error: kind });
});

/**
 * Reînnoire când refresh token-ul lipsește sau e respins: clientul HTTP cere o
 * reautentificare din `initData`. Reușește doar dacă șirul n-a fost încă
 * consumat; altfel păstrăm motivul (de obicei `reused`), ca ecranul să spună
 * „redeschide din chat", nu „reîncearcă".
 */
setReauthHandler(async () => {
  try {
    const pair = await authenticateWithTelegram();
    lastReauthError = null;
    return pair;
  } catch (error) {
    lastReauthError = error instanceof TelegramAuthError ? error.kind : null;
    return null;
  }
});
