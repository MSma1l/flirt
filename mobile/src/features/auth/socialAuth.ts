/**
 * Achiziția id_token pentru autentificarea socială (Google / Apple).
 *
 * În dev / mod `stub` întoarcem un token de forma `stub:{email}` pe care
 * backend-ul îl acceptă în modul stub. Funcțiile sunt pure și testabile.
 *
 * PROD: înlocuiește corpul acestor funcții cu expo-auth-session (Google) și
 * expo-apple-authentication (Apple) ca să obții un id_token real de la SDK,
 * fără a schimba semnătura publică (Promise<string>).
 */

/** Token stub acceptat de backend în modul `stub` pentru contul Google demonstrativ. */
const STUB_GOOGLE_ID_TOKEN = 'stub:google@example.com';
/** Token stub acceptat de backend în modul `stub` pentru contul Apple demonstrativ. */
const STUB_APPLE_ID_TOKEN = 'stub:apple@example.com';

/** Întoarce un id_token Google. În dev/stub: `stub:google@example.com`.
 * PROD: înlocuiește cu expo-auth-session ca să obții id_token real. */
export async function getGoogleIdToken(): Promise<string> {
  return STUB_GOOGLE_ID_TOKEN;
}

/** Întoarce un id_token Apple. În dev/stub: `stub:apple@example.com`.
 * PROD: înlocuiește cu expo-apple-authentication ca să obții id_token real. */
export async function getAppleIdToken(): Promise<string> {
  return STUB_APPLE_ID_TOKEN;
}
