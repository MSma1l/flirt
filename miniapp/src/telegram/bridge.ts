/**
 * Puntea către clientul Telegram.
 *
 * Regula fișierului: NIMIC din ce e aici nu are voie să arunce dacă aplicația e
 * deschisă într-un browser obișnuit (dezvoltare locală) sau pe un client
 * Telegram vechi, căruia îi lipsește o funcție recentă. Restul aplicației nu
 * verifică niciodată `window.Telegram` — cheamă funcțiile de aici și primește
 * valori implicite rezonabile.
 *
 * A doua regulă: `initDataUnsafe` NU e dovadă de identitate. Poate fi fabricat
 * de oricine deschide pagina în afara Telegram. Îl folosim exclusiv pentru a
 * arăta instant un nume și a alege limba cât timp cererea de autentificare e în
 * zbor; identitatea reală vine doar din `initData` BRUT, verificat pe server.
 */
import type {
  TelegramEvent,
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramUser,
  TelegramWebApp,
} from './types';

/** Margini zero — valoarea implicită când clientul nu raportează nimic. */
const ZERO_INSET: TelegramSafeAreaInset = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Obiectul global, sau `null` în afara Telegram.
 *
 * Citit la FIECARE apel, nu memorat la încărcarea modulului: SDK-ul e injectat
 * de `<script>` din `<head>`, dar în teste globalul e montat și demontat între
 * cazuri, iar o valoare memorată ar rămâne blocată pe prima stare văzută.
 */
export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const app = window.Telegram?.WebApp;
  // Un `initData` absent înseamnă că SDK-ul nu s-a încărcat complet; obiectul
  // există totuși pe unele clienți, deci verificăm o proprietate obligatorie.
  return app && typeof app.ready === 'function' ? app : null;
}

/** Rulăm în interiorul unui client Telegram? */
export function isInsideTelegram(): boolean {
  return getWebApp() !== null;
}

/**
 * Compară versiunea clientului cu una cerută („7.7", „8.0").
 *
 * Preferăm `isVersionAtLeast` al clientului; dacă lipsește (clienți foarte
 * vechi) comparăm noi, pe segmente numerice. În afara Telegram răspunsul e
 * `false`: nicio funcție recentă nu e disponibilă într-un browser simplu.
 */
export function isVersionAtLeast(version: string): boolean {
  const app = getWebApp();
  if (!app) return false;
  try {
    if (typeof app.isVersionAtLeast === 'function') return app.isVersionAtLeast(version);
  } catch {
    /* cădem pe comparația proprie */
  }
  return compareVersions(app.version ?? '0', version) >= 0;
}

/** Comparator semantic simplificat: „6.10" > „6.9". Exportat pentru teste. */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const na = Number.parseInt(pa[i] ?? '0', 10) || 0;
    const nb = Number.parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

/**
 * Execută `fn` doar dacă suntem în Telegram, înghițind orice eroare.
 * Un client care nu cunoaște o metodă nu are voie să oprească aplicația.
 */
function safely<T>(fn: (app: TelegramWebApp) => T, fallback: T): T {
  const app = getWebApp();
  if (!app) return fallback;
  try {
    return fn(app);
  } catch {
    return fallback;
  }
}

/** Anunță clientul că interfața e gata (ascunde spinnerul Telegram). */
export function ready(): void {
  safely((app) => app.ready(), undefined);
}

/** Extinde fereastra la înălțime maximă. */
export function expand(): void {
  safely((app) => app.expand(), undefined);
}

/** Închide Mini App-ul (no-op în browser). */
export function close(): void {
  safely((app) => app.close(), undefined);
}

/**
 * Datele de inițializare BRUTE, exact cum le-a dat clientul.
 * Șir gol = nu avem ce trimite la server (browser obișnuit sau SDK neîncărcat).
 */
export function getRawInitData(): string {
  return safely((app) => app.initData ?? '', '');
}

/**
 * Utilizatorul NEVERIFICAT din `initDataUnsafe`.
 * DOAR pentru afișare optimistă (un nume, un avatar) și pentru alegerea limbii.
 * Nu decide niciodată accesul pe baza lui.
 */
export function getUnsafeUser(): TelegramUser | null {
  return safely((app) => app.initDataUnsafe?.user ?? null, null);
}

/** Codul de limbă raportat de Telegram („ro", „ru-RU"), sau `null`. */
export function getLanguageCode(): string | null {
  return getUnsafeUser()?.language_code ?? null;
}

export function getColorScheme(): 'light' | 'dark' {
  return safely((app) => (app.colorScheme === 'dark' ? 'dark' : 'light'), 'light');
}

export function getThemeParams(): TelegramThemeParams {
  return safely((app) => app.themeParams ?? {}, {});
}

/**
 * Înălțimea stabilă a ferestrei (fără zona care dispare la scroll).
 * În browser cădem pe `window.innerHeight`, ca aplicația să aibă o înălțime
 * reală și în dezvoltare locală.
 */
export function getViewportStableHeight(): number {
  const app = getWebApp();
  if (app && typeof app.viewportStableHeight === 'number' && app.viewportStableHeight > 0) {
    return app.viewportStableHeight;
  }
  return typeof window !== 'undefined' ? window.innerHeight : 0;
}

/**
 * Marginile de siguranță ale dispozitivului (crestătură, bara de jos).
 * Disponibile de la Bot API 8.0; pe clienți mai vechi întoarcem zero, iar CSS-ul
 * cade pe `env(safe-area-inset-*)`.
 */
export function getSafeAreaInset(): TelegramSafeAreaInset {
  if (!isVersionAtLeast('8.0')) return ZERO_INSET;
  return safely((app) => app.safeAreaInset ?? ZERO_INSET, ZERO_INSET);
}

/** Marginile zonei de conținut (sub antetul Telegram). Bot API 8.0+. */
export function getContentSafeAreaInset(): TelegramSafeAreaInset {
  if (!isVersionAtLeast('8.0')) return ZERO_INSET;
  return safely((app) => app.contentSafeAreaInset ?? ZERO_INSET, ZERO_INSET);
}

/**
 * Abonare la un eveniment al clientului.
 * Întoarce mereu o funcție de dezabonare — și în browser, unde nu face nimic —
 * ca apelantul să o poată folosi direct în `useEffect` fără ramuri.
 */
export function onEvent(event: TelegramEvent, cb: () => void): () => void {
  const app = getWebApp();
  if (!app || typeof app.onEvent !== 'function') return () => undefined;
  try {
    app.onEvent(event, cb);
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      app.offEvent(event, cb);
    } catch {
      /* clientul a dispărut între timp */
    }
  };
}

/**
 * Butonul Înapoi nativ al Telegram.
 * Îl arată, leagă handlerul și întoarce curățarea. Cerut de la Bot API 6.1;
 * mai jos de atât, apelul e ignorat și ecranul își păstrează butonul propriu.
 */
export function showBackButton(onClick: () => void): () => void {
  if (!isVersionAtLeast('6.1')) return () => undefined;
  const app = getWebApp();
  if (!app?.BackButton) return () => undefined;
  try {
    app.BackButton.onClick(onClick);
    app.BackButton.show();
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      app.BackButton.offClick(onClick);
      app.BackButton.hide();
    } catch {
      /* nimic de făcut */
    }
  };
}

export interface MainButtonOptions {
  text: string;
  onClick: () => void;
  /** Butonul poate fi apăsat? Implicit `true`. */
  enabled?: boolean;
  /** Arată rotița de încărcare pe buton. Implicit `false`. */
  loading?: boolean;
}

/**
 * Butonul principal nativ (bara de jos a Telegram).
 * Întoarce curățarea; în browser e un no-op, deci ecranele trebuie să ofere
 * oricum un buton propriu în DOM pentru dezvoltare locală.
 */
export function showMainButton(options: MainButtonOptions): () => void {
  const app = getWebApp();
  if (!app?.MainButton) return () => undefined;
  const { text, onClick, enabled = true, loading = false } = options;
  try {
    app.MainButton.setText(text);
    app.MainButton.onClick(onClick);
    if (enabled) app.MainButton.enable();
    else app.MainButton.disable();
    if (loading) app.MainButton.showProgress(false);
    else app.MainButton.hideProgress();
    app.MainButton.show();
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      app.MainButton.offClick(onClick);
      app.MainButton.hide();
    } catch {
      /* nimic de făcut */
    }
  };
}

/** Vibrație scurtă la o acțiune reușită. Lipsește pe clienți vechi — se ignoră. */
export function haptic(type: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!isVersionAtLeast('6.1')) return;
  safely((app) => app.HapticFeedback?.impactOccurred(type), undefined);
}

/**
 * Oprește închiderea Mini App-ului la swipe vertical (Bot API 7.7+).
 * Esențială pentru deck-ul de swipe: fără ea, un gest în jos închide aplicația.
 */
export function disableVerticalSwipes(): void {
  if (!isVersionAtLeast('7.7')) return;
  safely((app) => app.disableVerticalSwipes?.(), undefined);
}
