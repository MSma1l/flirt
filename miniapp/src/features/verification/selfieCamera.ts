/**
 * Camera pentru selfie-ul de verificare, în WebView-ul Telegram.
 *
 * PROBLEMA REALĂ, nu una teoretică: `getUserMedia` NU e garantat aici.
 * Telegram Desktop rulează pe un WebView propriu, iOS pe WKWebView, Android pe
 * un Chrome încapsulat, Telegram Web într-un `<iframe>` cu `allow="camera"` care
 * poate lipsi. Rezultatul: aceeași aplicație cere camera și primește, după
 * client, fie fluxul video, fie `undefined` pe `navigator.mediaDevices`, fie o
 * excepție. Nu există un „dacă e iOS atunci…" corect — de asta modulul ăsta nu
 * se uită NICIODATĂ la `userAgent`: ÎNCEARCĂ și clasifică ce a pățit.
 *
 * Contractul cu ecranul e simplu: `openSelfieStream()` nu aruncă niciodată, ci
 * întoarce ori fluxul, ori un motiv din `CameraFailure`. Ecranul decide, pe baza
 * motivului, dacă mai poate cere o dată (nu poate, la `denied`) și trece pe
 * calea a doua — `<input type="file" capture="user">`, care merge și când prima
 * cale e complet blocată.
 *
 * Totul e injectabil (`CameraNavigator`, fabrica de `<canvas>`): jsdom nu are
 * nici `mediaDevices`, nici context 2D, deci fără injecție singura logică ce
 * merită testată — clasificarea erorilor și captura NEoglindită — ar fi
 * netestabilă.
 */

/** De ce nu avem flux video. Fiecare caz duce la alt text și la altă decizie. */
export type CameraFailure =
  /** `navigator.mediaDevices.getUserMedia` nu există (WebView vechi, context ne-securizat). */
  | 'unsupported'
  /** Utilizatorul (sau politica paginii) a refuzat. NU mai cerem a doua oară. */
  | 'denied'
  /** Nu există nicio cameră potrivită pe dispozitiv. */
  | 'noCamera'
  /** Camera există, dar nu pornește (ocupată de altă aplicație, eroare de driver). */
  | 'failed';

/** Rezultatul cererii de flux video: ori fluxul, ori motivul. Niciodată o excepție. */
export type CameraAccess =
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: CameraFailure };

/**
 * Felia din `navigator` de care depindem. Totul e opțional fiindcă exact asta e
 * situația reală într-un WebView: `mediaDevices` poate lipsi cu totul, iar
 * `permissions` lipsește pe Safari/iOS.
 */
export interface CameraNavigator {
  mediaDevices?: {
    getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  };
  permissions?: {
    query?: (descriptor: { name: string }) => Promise<{ state: string }>;
  };
}

/** `navigator`-ul real, sau un obiect gol (jsdom fără global, SSR). */
function currentNavigator(): CameraNavigator {
  return (typeof navigator === 'undefined' ? {} : navigator) as unknown as CameraNavigator;
}

/**
 * Există măcar API-ul? Prima poartă a detecției — și singura care poate fi
 * verificată fără să deranjăm utilizatorul cu o cerere de permisiune.
 */
export function isCameraSupported(nav: CameraNavigator = currentNavigator()): boolean {
  return typeof nav.mediaDevices?.getUserMedia === 'function';
}

/** Numele de `DOMException` care înseamnă „utilizatorul/pagina a refuzat". */
const DENIED_NAMES = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'SecurityError',
]);

/** Numele care înseamnă „nu există cameră potrivită". */
const ABSENT_NAMES = new Set([
  'NotFoundError',
  'DevicesNotFoundError',
  'OverconstrainedError',
  'ConstraintNotSatisfiedError',
]);

/**
 * Excepția lui `getUserMedia` → motiv.
 *
 * Numele sunt cele din specificația Media Capture; prefixele vechi
 * (`PermissionDeniedError`, `DevicesNotFoundError`) apar încă în WebView-uri
 * Android mai vechi, deci rămân în liste.
 */
export function classifyCameraError(error: unknown): CameraFailure {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  if (DENIED_NAMES.has(name)) return 'denied';
  if (ABSENT_NAMES.has(name)) return 'noCamera';
  return 'failed';
}

/** Starea permisiunii, când browserul o poate spune FĂRĂ să întrebe utilizatorul. */
export type CameraPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/**
 * Întreabă Permissions API dacă știe deja răspunsul.
 *
 * DE CE: dacă utilizatorul a refuzat o dată, `getUserMedia` ar deschide (pe unele
 * clienți) încă un dialog, iar pe altele ar respinge instant — în ambele cazuri
 * l-am pune într-o buclă de cereri fără sens. Când aflăm `denied` de aici, nici
 * nu mai chemăm `getUserMedia`: trecem direct pe calea a doua.
 *
 * `unknown` e răspunsul CORECT când API-ul lipsește (Safari/iOS) sau nu cunoaște
 * numele `camera` — atunci singura cale de a afla rămâne să încercăm.
 */
export async function probeCameraPermission(
  nav: CameraNavigator = currentNavigator(),
): Promise<CameraPermission> {
  const permissions = nav.permissions;
  const query = permissions?.query;
  if (typeof query !== 'function') return 'unknown';
  try {
    const status = await query.call(permissions, { name: 'camera' });
    const state = status?.state;
    return state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown';
  } catch {
    // Firefox aruncă `TypeError` pentru numele `camera`. Nu e o eroare de-a
    // noastră și nu spune nimic despre permisiune.
    return 'unknown';
  }
}

/**
 * Constrângerile selfie-ului: camera FRONTALĂ, fără microfon.
 *
 * `facingMode` e „ideal", nu „exact": pe un laptop cu o singură cameră un
 * `exact` ar arunca `OverconstrainedError` și ar trimite inutil un utilizator
 * de desktop pe calea a doua.
 */
export const SELFIE_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
  audio: false,
};

/**
 * Cere fluxul video al camerei frontale. NU aruncă: orice eșec devine motiv.
 */
export async function openSelfieStream(
  nav: CameraNavigator = currentNavigator(),
): Promise<CameraAccess> {
  const devices = nav.mediaDevices;
  const getUserMedia = devices?.getUserMedia;
  if (typeof getUserMedia !== 'function') return { ok: false, reason: 'unsupported' };

  try {
    const stream = await getUserMedia.call(devices, SELFIE_CONSTRAINTS);
    // Un WebView care „răspunde" cu `undefined` în loc să arunce nu e o
    // ipoteză: tratat ca eșec, nu ca succes cu flux nul.
    if (!stream) return { ok: false, reason: 'failed' };
    return { ok: true, stream };
  } catch (error) {
    return { ok: false, reason: classifyCameraError(error) };
  }
}

/**
 * Oprește TOATE pistele fluxului.
 *
 * Obligatoriu la ieșirea din ecran: o pistă rămasă pornită ține indicatorul
 * verde/portocaliu al dispozitivului aprins, iar utilizatorul crede — pe bună
 * dreptate — că e filmat. Nu aruncă niciodată: se cheamă și din curățarea
 * `useEffect`, unde o excepție ar rupe demontarea.
 */
export function stopStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  try {
    for (const track of stream.getTracks?.() ?? []) track.stop?.();
  } catch {
    // Un flux deja închis aruncă pe unele implementări. Nu avem ce repara.
  }
}

/**
 * Așteaptă ca fluxul să CHIAR pornească.
 *
 * A treia poartă a detecției, cea uitată de obicei: `getUserMedia` poate
 * rezolva cu un `MediaStream` care nu produce niciun cadru (cameră ocupată de
 * altă aplicație, pistă oprită de sistem imediat după pornire). Ecranul ar
 * rămâne atunci cu un dreptunghi negru și un buton care nu face nimic.
 *
 * Întoarce `false` la eroare sau la expirarea timpului — apelantul trece pe
 * calea a doua în loc să aștepte la nesfârșit.
 */
export function waitForVideo(video: HTMLVideoElement, timeoutMs = 6000): Promise<boolean> {
  if (video.readyState >= 2 && video.videoWidth > 0) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onFailure);
      resolve(value);
    };

    const onReady = () => finish(true);
    const onFailure = () => finish(false);

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => finish(false), timeoutMs);
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('canplay', onReady);
    video.addEventListener('error', onFailure);
  });
}

/** Ce poate fi injectat în captură (jsdom nu are context 2D). */
export interface CaptureOptions {
  /** Fabrica de `<canvas>`. Implicit, unul real din document. */
  createCanvas?: () => HTMLCanvasElement;
  /** Formatul intermediar. JPEG — e și unul dintre tipurile acceptate de backend. */
  type?: string;
  /** Calitatea primei encodări; micșorarea sub limită o face `prepareSelfie`. */
  quality?: number;
}

/**
 * Ia un cadru din fluxul video și îl întoarce ca `Blob`.
 *
 * OGLINDIREA, punctul în care se greșește cel mai ușor. Previzualizarea E
 * oglindită — așa se așteaptă omul să se vadă, ca într-o oglindă — dar
 * oglindirea aia stă EXCLUSIV în CSS (`.verify-camera__video`, `scaleX(-1)`).
 * Aici nu se aplică nicio transformare pe context: `drawImage` desenează
 * cadrul ORIGINAL. Dacă am oglindi și la captură, comparația facială de pe
 * server ar primi o imagine răsturnată față de pozele de profil — fețele
 * umane nu sunt simetrice, iar scorul ar scădea fără ca nimeni să înțeleagă de ce.
 *
 * Întoarce `null` când cadrul nu e disponibil sau encoderul lipsește; apelantul
 * arată `camera.captureFailed`, nu crapă.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  options: CaptureOptions = {},
): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const canvas = (options.createCanvas ?? (() => document.createElement('canvas')))();
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // NICIO transformare aici — vezi comentariul de mai sus. Intenționat.
  ctx.drawImage(video, 0, 0, width, height);

  if (typeof canvas.toBlob !== 'function') return null;
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), options.type ?? 'image/jpeg', options.quality ?? 0.92);
  });
}
