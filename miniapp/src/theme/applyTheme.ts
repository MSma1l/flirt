/**
 * Construirea temei: paleta FLIRT ca BAZĂ, parametrii Telegram ca ajustare.
 *
 * De ce în ordinea asta. Dacă am lua tema Telegram integral, aplicația și-ar
 * pierde identitatea (roz-ul de brand ar deveni albastrul clientului) și ar
 * arăta altfel la fiecare temă instalată de utilizator. Dacă am ignora-o
 * complet, Mini App-ul ar avea un fundal alb într-un client pe temă închisă —
 * o ruptură vizibilă exact în zona unde pagina noastră atinge chenarul
 * Telegram. Deci: culorile de „cameră" (fundal, suprafață, text, linii)
 * urmează clientul când acesta le trimite, iar ACCENTUL rămâne al nostru.
 */
import type { TelegramSafeAreaInset, TelegramThemeParams } from '@/telegram/types';

import { darkTheme, lightTheme, toCssVarName, type ThemeColors } from './tokens';

/**
 * Ce parametru Telegram suprascrie ce token al nostru.
 * `accent` lipsește INTENȚIONAT din listă: e culoarea de brand.
 */
const TELEGRAM_OVERRIDES: Array<[keyof TelegramThemeParams, keyof ThemeColors]> = [
  ['bg_color', 'bg'],
  ['secondary_bg_color', 'surface'],
  ['section_bg_color', 'surfaceHover'],
  ['section_separator_color', 'border'],
  ['text_color', 'textPrimary'],
  ['hint_color', 'textSecondary'],
  ['link_color', 'link'],
  ['destructive_text_color', 'danger'],
];

/** Culoare validă? Telegram poate trimite `undefined` sau un șir gol. */
function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/**
 * Paleta finală: baza produsului + ce a trimis clientul.
 *
 * `ThemeColors` moștenește `readonly` de la `as const`-ul din paleta mobilă, așa
 * că lucrăm pe o copie mutabilă și o dăm înapoi ca `ThemeColors`.
 */
type MutablePalette = { -readonly [K in keyof ThemeColors]: string };

export function buildPalette(
  scheme: 'light' | 'dark',
  params: TelegramThemeParams,
): ThemeColors {
  const base: MutablePalette = { ...(scheme === 'dark' ? darkTheme : lightTheme) };

  for (const [tgKey, ourKey] of TELEGRAM_OVERRIDES) {
    const value = params[tgKey];
    if (isColor(value)) base[ourKey] = value.trim();
  }

  return base;
}

export interface ThemeInput {
  scheme: 'light' | 'dark';
  params: TelegramThemeParams;
  /** Marginile raportate de Telegram (dispozitiv + zona de conținut). */
  safeArea?: TelegramSafeAreaInset;
  contentSafeArea?: TelegramSafeAreaInset;
  /** Înălțimea stabilă a ferestrei, în px. */
  stableHeight?: number;
}

/**
 * Toate variabilele CSS ale temei, ca obiect.
 * Funcție pură — testabilă fără DOM.
 */
export function buildThemeVars(input: ThemeInput): Record<string, string> {
  const palette = buildPalette(input.scheme, input.params);
  const vars: Record<string, string> = {};

  for (const [key, value] of Object.entries(palette)) {
    vars[toCssVarName(key)] = value;
  }

  // Marginile de siguranță: suma dintre marginea dispozitivului (crestătură) și
  // marginea zonei de conținut (antetul Telegram). `env(safe-area-inset-*)` NU
  // acoperă antetul clientului, de aceea nu ne bazăm pe el când avem date reale.
  const safe = input.safeArea ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const content = input.contentSafeArea ?? { top: 0, bottom: 0, left: 0, right: 0 };
  vars['--safe-top'] = `${safe.top + content.top}px`;
  vars['--safe-bottom'] = `${safe.bottom + content.bottom}px`;
  vars['--safe-left'] = `${safe.left + content.left}px`;
  vars['--safe-right'] = `${safe.right + content.right}px`;

  if (typeof input.stableHeight === 'number' && input.stableHeight > 0) {
    vars['--viewport-stable-height'] = `${input.stableHeight}px`;
  }

  vars['--color-scheme'] = input.scheme;

  return vars;
}

/** Scrie variabilele pe `<html>` și marchează schema pentru `color-scheme`. */
export function applyTheme(input: ThemeInput, root?: HTMLElement): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : null);
  if (!target) return;

  for (const [name, value] of Object.entries(buildThemeVars(input))) {
    target.style.setProperty(name, value);
  }
  target.dataset.colorScheme = input.scheme;
  target.style.colorScheme = input.scheme;
}
