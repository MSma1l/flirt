/**
 * Achiziția NATIVĂ a `id_token`-ului pentru autentificarea socială.
 *
 * Apple  → `expo-apple-authentication` (dialogul nativ iOS).
 * Google → `expo-auth-session`, flux Authorization Code + PKCE în browserul de
 *          sistem (ASWebAuthenticationSession / Custom Tabs).
 *
 * Tokenul pleacă spre backend exact cum l-a emis providerul: `POST /auth/apple`
 * și `POST /auth/google` primesc `{ id_token }` și îl verifică criptografic prin
 * JWKS-ul real (semnătură RS256 + `aud` + `iss` + `exp`). Nu inspectăm și nu
 * „validăm" tokenul aici — orice verificare client-side ar fi teatru: singura
 * care contează e cea de pe server.
 *
 * Guideline 4.8 (Apple): dacă aplicația oferă login cu Google, „Sign in with
 * Apple" devine OBLIGATORIU pe iOS. Regula „ori amândouă, ori niciunul" e impusă
 * de `getAvailableSocialProviders()`, nu lăsată în seama ecranului.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { config } from '@/config';

import { formatAppleName, rememberAppleIdentity } from './appleIdentity';

/** Endpoint-urile OIDC Google (aceleași pe care le folosește providerul din expo-auth-session). */
const GOOGLE_DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/** Scope-urile minime din care Google emite un `id_token` cu `sub` + `email`. */
const GOOGLE_SCOPES = ['openid', 'profile', 'email'];

/** Codul erorii pe care `expo-apple-authentication` o aruncă la anularea de către user. */
const APPLE_CANCELED_CODE = 'ERR_REQUEST_CANCELED';

/** Cauza eșecului, ca ecranul să aleagă mesajul potrivit fără să parseze string-uri. */
export type SocialAuthErrorCode =
  /** Userul a închis dialogul / browserul — NU e o eroare de arătat. */
  | 'canceled'
  /** Providerul nu există pe acest dispozitiv (ex: Apple pe Android). */
  | 'unavailable'
  /** Lipsește client ID-ul din config → butonul nici nu trebuie afișat. */
  | 'not_configured'
  /** Fluxul a mers, dar providerul n-a întors niciun `id_token`. */
  | 'no_token'
  /** Rețea căzută, browser blocat, cod de autorizare respins etc. */
  | 'failed';

/** Eroare tipată a fluxului social (ecranele decid mesajul după `code`). */
export class SocialAuthError extends Error {
  readonly code: SocialAuthErrorCode;

  constructor(code: SocialAuthErrorCode, message: string) {
    super(message);
    this.name = 'SocialAuthError';
    this.code = code;
  }
}

/** `true` dacă userul a anulat — cazul în care ecranul nu afișează nicio eroare. */
export function isCanceled(error: unknown): boolean {
  return error instanceof SocialAuthError && error.code === 'canceled';
}

// --- Google ------------------------------------------------------------------

/**
 * Client ID-ul Google pentru platforma curentă (din `app.json` → `extra`).
 *
 * Google emite un client OAuth SEPARAT pentru iOS și pentru Android; folosirea
 * celui greșit întoarce `invalid_client`. Cât timp userul n-are încă conturile de
 * developer, valorile sunt șiruri goale — vezi `isGoogleAuthConfigured()`.
 */
function googleClientId(): string {
  const { clientIdIos, clientIdAndroid, clientIdWeb } = config.googleAuth;
  if (Platform.OS === 'ios') return clientIdIos.trim();
  if (Platform.OS === 'android') return clientIdAndroid.trim();
  return clientIdWeb.trim();
}

/** `true` doar dacă există un client ID pentru platforma curentă. */
export function isGoogleAuthConfigured(): boolean {
  return googleClientId().length > 0;
}

/**
 * Redirect URI-ul pe care Google îl acceptă pentru clienții nativi.
 *
 * Convenția e `<applicationId>:/oauthredirect` (exact cea folosită de providerul
 * Google din expo-auth-session). Schema = bundle identifier-ul pe iOS / numele de
 * pachet pe Android, adică `eu.flirt.app` — o schemă pe care Expo o înregistrează
 * deja la build, deci nu cere nicio intrare nouă în `app.json`.
 *
 * Îl citim din configul aplicației, nu-l scriem de mână: dacă bundle ID-ul se
 * schimbă vreodată, redirectul îl urmează automat.
 */
function googleRedirectUri(): string {
  const applicationId =
    Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.bundleIdentifier
      : Constants.expoConfig?.android?.package;

  // Fără applicationId (web / config incomplet) cădem pe schema aplicației.
  return AuthSession.makeRedirectUri(
    applicationId ? { native: `${applicationId}:/oauthredirect` } : {},
  );
}

/**
 * Întoarce un `id_token` Google real, prin Authorization Code + PKCE.
 *
 * PKCE, nu implicit flow: clienții nativi n-au client secret (ar fi extractibil
 * din binar), iar `code_verifier` leagă schimbul de cod de exact acest device.
 */
export async function getGoogleIdToken(): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) {
    throw new SocialAuthError(
      'not_configured',
      'Google client ID lipsește pentru platforma curentă.',
    );
  }

  const redirectUri = googleRedirectUri();
  // `nonce` ajunge ca revendicare în id_token și leagă tokenul de cererea noastră.
  // ONEST: backend-ul nu îl verifică (încă) — e apărare în adâncime, nu o garanție.
  const nonce = Crypto.randomUUID();

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: GOOGLE_SCOPES,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: { nonce },
  });

  let result: AuthSession.AuthSessionResult;
  try {
    result = await request.promptAsync(GOOGLE_DISCOVERY);
  } catch (error) {
    throw new SocialAuthError(
      'failed',
      `Nu am putut deschide fereastra Google: ${String(error)}`,
    );
  }

  // `dismiss` = userul a închis browserul; `cancel` = a apăsat „Anulează".
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new SocialAuthError('canceled', 'Autentificarea Google a fost anulată.');
  }
  if (result.type !== 'success') {
    throw new SocialAuthError('failed', 'Autentificarea Google nu a reușit.');
  }

  const code = result.params.code;
  if (!code) {
    throw new SocialAuthError('failed', 'Google nu a întors un cod de autorizare.');
  }

  let tokens: AuthSession.TokenResponse;
  try {
    tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId,
        code,
        redirectUri,
        // Dovada PKCE: fără ea Google respinge schimbul cu `invalid_grant`.
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
      },
      GOOGLE_DISCOVERY,
    );
  } catch (error) {
    // Aici cade și rețeaua picată: schimbul codului e un POST către Google.
    throw new SocialAuthError(
      'failed',
      `Schimbul codului Google a eșuat: ${String(error)}`,
    );
  }

  if (!tokens.idToken) {
    throw new SocialAuthError('no_token', 'Google nu a întors un id_token.');
  }
  return tokens.idToken;
}

// --- Apple -------------------------------------------------------------------

/**
 * `true` doar pe iOS, pe un sistem care chiar suportă Sign in with Apple.
 *
 * Modulul există și pe Android (import-ul nu crapă), dar `signInAsync` ar arunca —
 * de aceea butonul Apple nu trebuie NICIODATĂ afișat acolo.
 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** `true` dacă eroarea aruncată de modulul Apple înseamnă „userul a anulat". */
function isAppleCancelError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === APPLE_CANCELED_CODE
  );
}

/**
 * Întoarce un `identityToken` Apple real.
 *
 * Efect secundar DELIBERAT: numele și emailul primite de la Apple sunt salvate
 * local ÎNAINTE de a întoarce tokenul. Apple le trimite o singură dată, la prima
 * autentificare; dacă am aștepta răspunsul backendului și rețeaua ar cădea, le-am
 * pierde pentru totdeauna (vezi `appleIdentity.ts`).
 */
export async function getAppleIdToken(): Promise<string> {
  if (!(await isAppleAuthAvailable())) {
    throw new SocialAuthError(
      'unavailable',
      'Sign in with Apple nu e disponibil pe acest dispozitiv.',
    );
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      // Vezi nota de la Google: nonce trimis, deocamdată neverificat de backend.
      nonce: Crypto.randomUUID(),
    });
  } catch (error) {
    if (isAppleCancelError(error)) {
      throw new SocialAuthError('canceled', 'Autentificarea Apple a fost anulată.');
    }
    throw new SocialAuthError('failed', `Autentificarea Apple a eșuat: ${String(error)}`);
  }

  // Salvăm întâi datele one-shot, abia apoi validăm tokenul: chiar dacă tokenul
  // lipsește, numele prins acum nu mai vine niciodată a doua oară.
  await rememberAppleIdentity({
    name: formatAppleName(credential.fullName),
    email: credential.email ?? '',
  });

  if (!credential.identityToken) {
    throw new SocialAuthError('no_token', 'Apple nu a întors un identity token.');
  }
  return credential.identityToken;
}

// --- Disponibilitatea butoanelor ---------------------------------------------

/** Ce butoane sociale are voie ecranul să afișeze. */
export interface SocialProviders {
  google: boolean;
  apple: boolean;
}

/**
 * Decide ce providere sociale se afișează, aplicând Guideline 4.8.
 *
 * - Android: Apple nu există; Google apare dacă are client ID. 4.8 e o regulă
 *   Apple, nu se aplică magazinului Google.
 * - iOS: dacă am arăta Google fără „Sign in with Apple", aplicația ar fi respinsă.
 *   Deci pe iOS Google apare DOAR alături de Apple — altfel niciunul.
 *
 * Lipsa client ID-ului nu e o eroare: butonul pur și simplu nu apare, iar restul
 * ecranului (email/parolă, telefon) funcționează normal. Când userul completează
 * ID-urile în `app.json`, butoanele apar fără nicio schimbare de cod.
 */
export async function getAvailableSocialProviders(): Promise<SocialProviders> {
  const apple = await isAppleAuthAvailable();
  const google = isGoogleAuthConfigured();

  if (Platform.OS === 'ios' && google && !apple) {
    return { google: false, apple: false };
  }
  return { google, apple };
}
