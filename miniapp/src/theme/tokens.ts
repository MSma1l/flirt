/**
 * Tokenii de design ai Mini App-ului.
 *
 * CULORILE sunt REUTILIZATE: `darkTheme` / `lightTheme` se importă direct din
 * `mobile/theme/colors.ts` (fișier pur, fără nimic din React Native), deci
 * paleta rămâne o singură sursă de adevăr cu aplicația nativă.
 *
 * TIPOGRAFIA e REscrisă: `mobile/theme/typography.ts` importă `TextStyle` din
 * `react-native`, deci nu poate fi importat într-un bundle web. Valorile de mai
 * jos sunt aceleași numere, transcrise. Dacă scara se schimbă pe mobil, trebuie
 * schimbată și aici — e singura duplicare de tokeni din proiect.
 */
import { darkTheme, lightTheme, type ThemeColors } from '@theme/colors';

export { darkTheme, lightTheme };
export type { ThemeColors };

/** `surfaceHover` → `surface-hover`, ca să devină nume de variabilă CSS. */
export function toCssVarName(key: string): string {
  return `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Aceleași chei ca `ThemeColors`, dar cu valori `var(--color-…)`.
 *
 * Așa putem refolosi funcții pure din aplicația mobilă care primesc un obiect
 * de culori — de exemplu `compatColor(score, colors)` din
 * `mobile/src/features/feed/compat.ts` — fără să le modificăm: ele întorc un
 * șir, iar șirul e o variabilă CSS validă în DOM.
 */
export const cssVarColors: ThemeColors = Object.fromEntries(
  Object.keys(darkTheme).map((key) => [key, `var(${toCssVarName(key)})`]),
) as ThemeColors;

/** Scara tipografică (Manrope), transcrisă din `mobile/theme/typography.ts`. */
export const typography = {
  display: { size: 32, lineHeight: 38, weight: 700 },
  h1: { size: 24, lineHeight: 30, weight: 700 },
  h2: { size: 20, lineHeight: 26, weight: 700 },
  bodyStrong: { size: 16, lineHeight: 22, weight: 500 },
  body: { size: 16, lineHeight: 22, weight: 400 },
  caption: { size: 13, lineHeight: 18, weight: 400 },
  badge: { size: 12, lineHeight: 14, weight: 700 },
} as const;

export const radius = { sm: 8, md: 12, card: 18, pill: 999 } as const;
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const CTA_GRADIENT = ['#FF2D78', '#E01B63'] as const;
export const ACCENT_GLOW = 'rgba(255,45,120,0.35)';
