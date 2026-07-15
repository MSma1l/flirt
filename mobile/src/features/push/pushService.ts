/**
 * Push REAL (Expo Push Service) — token de dispozitiv, permisiuni, canal Android,
 * (de)înregistrare la backend (TZ 6.3).
 *
 * Principiul care ghidează tot fișierul: mai bine NICIUN token decât un token
 * fals. Un token inventat („expo-dev-token-ios") se înregistrează cuminte la
 * backend, iar backend-ul crede că are unde trimite notificări — dar ele nu
 * ajung nicăieri, iar eșecul e invizibil. De aceea fiecare cauză de eșec
 * (simulator, permisiune refuzată, projectId EAS absent, Expo indisponibil) e
 * întoarsă EXPLICIT apelantului, ca `PushOutcome`, nu înghițită într-un catch.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/services/api';
import { darkTheme } from '@theme/colors';

/**
 * Canalul Android. De la Android 8 (API 26) o notificare FĂRĂ canal nu se
 * afișează deloc — e livrată și aruncată în tăcere. `default` e exact id-ul pe
 * care îl folosește Expo când mesajul nu specifică `channelId` (cazul nostru:
 * backend-ul trimite doar `{to, title, body}`), deci canalul trebuie să existe
 * sub acest nume, nu sub altul.
 */
const ANDROID_CHANNEL_ID = 'default';

/** Motivele pentru care push-ul NU poate fi activat pe dispozitivul curent. */
export type PushBlockedReason =
  /** Simulator/emulator: nu există APNs/FCM, deci nu există token. */
  | 'simulator'
  /** Userul a refuzat (sau nu a acordat încă) permisiunea de notificări. */
  | 'permission-denied'
  /** Lipsește projectId-ul EAS — fără el Expo nu poate emite un token. */
  | 'missing-project-id'
  /** Expo nu a putut emite tokenul (offline, credențiale push lipsă). */
  | 'token-unavailable'
  /** Tokenul e valid, dar backend-ul nu l-a putut salva (rețea, 5xx). */
  | 'register-failed';

export type PushOutcome =
  | { status: 'registered'; token: string }
  | { status: 'blocked'; reason: PushBlockedReason; message: string };

function blocked(reason: PushBlockedReason, message: string): PushOutcome {
  // Log doar în dev: în producție motivul e întors apelantului, nu urlat în consolă.
  if (__DEV__) console.warn(`[push] inactiv (${reason}): ${message}`);
  return { status: 'blocked', reason, message };
}

/**
 * Push-ul e strict NATIV. Pe web (react-native-web) nu există APNs/FCM și
 * `getExpoPushTokenAsync` ar arunca, iar simulatorul n-are nici el token. Le
 * tratăm la fel: fără dispozitiv real de push nu atingem nici Expo, nici rețeaua.
 * Astfel ecranele web care importă serviciul (login, tab Mesaje) nu crapă.
 */
function pushUnsupportedHere(): boolean {
  return Platform.OS === 'web' || !Device.isDevice;
}

/**
 * Tokenul Expo al dispozitivului, memorat după prima obținere.
 *
 * `getExpoPushTokenAsync` face o cerere de rețea la serverele Expo; tokenul e
 * stabil pentru instalare, deci îl reținem ca să nu-l cerem la fiecare montare
 * a ecranelor. La logout îl golim — vezi `unregisterDevice`.
 */
let cachedToken: string | null = null;

/**
 * projectId-ul EAS, singura sursă de adevăr pentru emiterea tokenului pe SDK 54.
 *
 * ATENȚIE: proiectul NU are încă un cont/proiect EAS configurat, deci aici
 * întoarcem `null` în mod normal. Nu inventăm o valoare implicită — un projectId
 * greșit ar produce token-uri care aparțin ALTUI proiect.
 */
function resolveProjectId(): string | null {
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  const fromEasConfig = Constants.easConfig?.projectId;
  const projectId = fromExtra ?? fromEasConfig;
  return typeof projectId === 'string' && projectId.length > 0 ? projectId : null;
}

/**
 * Creează canalul Android. Idempotent (re-apelarea doar actualizează canalul),
 * deci îl putem chema la fiecare pornire fără efecte secundare.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Mesaje și potriviri',
    // MAX: notificarea de mesaj nou trebuie să apară ca heads-up, altfel se pierde.
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    // Culoarea de accent a brandului (identică în tema light și dark), nu un hex hardcodat.
    lightColor: darkTheme.accent,
  });
}

/** Permisiunea e activă? Pe iOS, „provisional" livrează silențios — tot e valid. */
async function hasPermission(): Promise<boolean> {
  const perm = await Notifications.getPermissionsAsync();
  return (
    perm.granted || perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

/**
 * Obține tokenul REAL de la Expo. Aruncă (cu mesaj explicit) dacă lipsește
 * projectId-ul — apelanții îl transformă într-un `PushOutcome` onest.
 */
async function getPushToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error(
      'projectId EAS lipsește: rulează `eas init` și pune `extra.eas.projectId` în app.json. ' +
        'Fără el, Expo nu poate emite un token de push pentru acest proiect.',
    );
  }

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  cachedToken = data;
  return data;
}

/** Trimite tokenul la backend (upsert pe (user_id, token) — vezi push.register_device). */
async function sendTokenToBackend(token: string): Promise<void> {
  await api.post('/push/register', { token, platform: Platform.OS });
}

/**
 * Nucleul comun: presupune permisiunea deja acordată și duce fluxul până la capăt.
 * Fiecare pas eșuat își are propriul motiv — nimic nu se pierde într-un catch mut.
 */
async function registerWithPermission(): Promise<PushOutcome> {
  await ensureAndroidChannel();

  let token: string;
  try {
    token = await getPushToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Distingem „nu e configurat proiectul" de „Expo n-a răspuns": prima e o
    // greșeală de configurare (se repară o dată), a doua e tranzitorie.
    const reason: PushBlockedReason = resolveProjectId() ? 'token-unavailable' : 'missing-project-id';
    return blocked(reason, message);
  }

  try {
    await sendTokenToBackend(token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return blocked('register-failed', `backend-ul nu a acceptat tokenul: ${message}`);
  }

  return { status: 'registered', token };
}

/**
 * Sincronizare TĂCUTĂ, la fiecare intrare în aplicație (user autentificat).
 *
 * NU cere permisiunea — doar profită de una deja acordată. Așa acoperim cazurile
 * reale: tokenul Expo se poate schimba (reinstalare, restore de backup), iar
 * userul poate activa notificările din setările sistemului, fără să mai treacă
 * prin dialogul aplicației. Cererea propriu-zisă se face în `usePushPermissionPrompt`,
 * într-un moment în care userul înțelege DE CE i-o cerem.
 */
export async function syncPushRegistration(): Promise<PushOutcome> {
  if (pushUnsupportedHere()) {
    return blocked(
      'simulator',
      'push-ul nu funcționează pe simulator/emulator sau în browser — e nevoie de un dispozitiv fizic.',
    );
  }

  if (!(await hasPermission())) {
    return blocked('permission-denied', 'permisiunea de notificări nu este acordată.');
  }

  return registerWithPermission();
}

/**
 * Cere permisiunea și, dacă e acordată, înregistrează dispozitivul.
 * Se apelează DOAR dintr-un context în care userul se așteaptă la asta.
 */
export async function requestPushPermissionAndRegister(): Promise<PushOutcome> {
  if (pushUnsupportedHere()) {
    return blocked(
      'simulator',
      'push-ul nu funcționează pe simulator/emulator sau în browser — e nevoie de un dispozitiv fizic.',
    );
  }

  // Canalul TREBUIE să existe înainte de dialogul de permisiune pe Android:
  // altfel notificarea acordată ajunge într-un canal inexistent și nu se vede.
  await ensureAndroidChannel();

  const current = await Notifications.getPermissionsAsync();
  const granted =
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  if (!granted) {
    // `canAskAgain: false` = userul a refuzat definitiv; un nou request nu ar
    // afișa nimic (iOS arată dialogul o SINGURĂ dată). Nu-l irosim degeaba.
    if (!current.canAskAgain) {
      return blocked(
        'permission-denied',
        'notificările sunt dezactivate din setările sistemului — doar userul le poate reactiva de acolo.',
      );
    }

    const asked = await Notifications.requestPermissionsAsync();
    const nowGranted =
      asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

    if (!nowGranted) {
      // Refuz = nimic nu pleacă spre backend. Nu înregistrăm „preventiv" un token.
      return blocked('permission-denied', 'userul a refuzat notificările.');
    }
  }

  return registerWithPermission();
}

/**
 * Dezînregistrare la LOGOUT — obligatorie, nu opțională.
 *
 * Tokenul aparține DISPOZITIVULUI, nu contului. Backend-ul face upsert pe
 * (user_id, token), deci dacă nu ștergem rândul vechi, următorul user care se
 * loghează pe același telefon primește notificările celui dinainte („mesaj nou
 * de la Ana") — o scurgere reală de date, nu o inconveniență.
 *
 * Se apelează ÎNAINTE de ștergerea tokenurilor de auth: cererea are nevoie de
 * Bearer-ul userului care pleacă. Nu aruncă niciodată — un logout nu poate fi
 * blocat de o eroare de rețea.
 */
export async function unregisterDevice(): Promise<void> {
  // Web: nu s-a înregistrat niciodată un token (push-ul e nativ), deci n-avem ce
  // dezînregistra și nu atingem `Notifications` (ar arunca în browser).
  if (Platform.OS === 'web') {
    cachedToken = null;
    return;
  }

  const token = cachedToken;
  // Golim cache-ul indiferent de rezultat: următorul user va cere tokenul din
  // nou și îl va înregistra pe contul LUI.
  cachedToken = null;

  if (!token) return;

  try {
    // Contrapartida REST a `POST /push/register`. Axios trimite corpul unui
    // DELETE doar prin `data`.
    await api.delete('/push/register', { data: { token, platform: Platform.OS } });
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[push] dezînregistrarea a eșuat — dispozitivul poate primi în continuare ' +
          `notificările contului anterior: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  try {
    // Curățare locală: notificările deja livrate ale userului anterior nu au ce
    // căuta în bara de notificări a următorului, iar badge-ul trebuie resetat.
    await Notifications.dismissAllNotificationsAsync();
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Curățarea cosmetică nu are voie să blocheze logout-ul.
  }
}

/** Doar pentru teste: golește tokenul memorat între scenarii. */
export function __resetPushCacheForTests(): void {
  cachedToken = null;
}
