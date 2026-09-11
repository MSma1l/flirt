/**
 * Tipuri pentru partea din `window.Telegram.WebApp` pe care o FOLOSIM efectiv.
 *
 * Nu e o transcriere completă a documentației Telegram: tot ce nu e folosit aici
 * lipsește intenționat, ca tipurile să nu promită funcții pe care puntea nu le
 * acoperă. Câmpurile apărute în versiuni noi de client sunt marcate opționale —
 * pe un client vechi pur și simplu nu există, iar puntea trebuie să reziste.
 *
 * Sursa: https://core.telegram.org/bots/webapps
 */

/** Paleta trimisă de clientul Telegram. Toate câmpurile pot lipsi. */
export interface TelegramThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  header_bg_color?: string;
  section_bg_color?: string;
  section_separator_color?: string;
  destructive_text_color?: string;
  subtitle_text_color?: string;
  accent_text_color?: string;
}

/** Marginile de siguranță raportate de client (Bot API 8.0+). */
export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Utilizatorul din `initDataUnsafe` — NU e dovadă de identitate (vezi bridge.ts). */
export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramInitDataUnsafe {
  user?: TelegramUser;
  auth_date?: number;
  hash?: string;
  start_param?: string;
  query_id?: string;
}

export interface TelegramBackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

export interface TelegramMainButtonParams {
  text?: string;
  color?: string;
  text_color?: string;
  is_active?: boolean;
  is_visible?: boolean;
}

export interface TelegramMainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  isProgressVisible: boolean;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  setText: (text: string) => void;
  setParams: (params: TelegramMainButtonParams) => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
}

export interface TelegramHapticFeedback {
  impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
  notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  selectionChanged: () => void;
}

/** Evenimentele la care ne abonăm. Lista e restrânsă la ce folosim. */
export type TelegramEvent =
  | 'themeChanged'
  | 'viewportChanged'
  | 'safeAreaChanged'
  | 'contentSafeAreaChanged';

export interface TelegramWebApp {
  /** Datele de inițializare BRUTE — singura formă acceptată ca dovadă de identitate. */
  initData: string;
  /** Aceleași date, deja despachetate de client. NEVERIFICATE — doar pentru UI optimist. */
  initDataUnsafe: TelegramInitDataUnsafe;
  /** Versiunea Bot API a clientului, ex. "6.9", "8.0". */
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: TelegramSafeAreaInset;
  contentSafeAreaInset?: TelegramSafeAreaInset;
  BackButton: TelegramBackButton;
  MainButton: TelegramMainButton;
  HapticFeedback?: TelegramHapticFeedback;
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  onEvent: (event: TelegramEvent, cb: () => void) => void;
  offEvent: (event: TelegramEvent, cb: () => void) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}
