/**
 * Token-uri de culoare — valori EXACTE din paleta oficială (flirt_paleta_culori.png).
 * Componentele folosesc nume semantice (`accent`, `surface`), NICIODATĂ hex direct.
 */
export const darkTheme = {
  bg: '#0D0D0F',
  surface: '#1A1A1E',
  surfaceHover: '#232329',
  border: '#2C2C33',
  textPrimary: '#FFFFFF',
  textSecondary: '#A6A6AF',
  textDisabled: '#5A5A63',
  link: '#FF6BA0',
  accent: '#FF2D78',
  accentHover: '#FF4D8D',
  accentPressed: '#E01B63',
  accentDisabled: '#6E2C46',
  tagBg: '#2B1420',
  // culori de semnal (NU sunt culori de brand)
  success: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  onAccent: '#FFFFFF',
} as const;

export const lightTheme = {
  bg: '#FFFFFF',
  surface: '#F7F7F9',
  surfaceHover: '#EFEFF3',
  border: '#E4E4EA',
  textPrimary: '#141416',
  textSecondary: '#6E6E78',
  textDisabled: '#B4B4BC',
  link: '#E01B63',
  accent: '#FF2D78',
  accentHover: '#E01B63',
  accentPressed: '#C41556',
  accentDisabled: '#F5A8C4',
  tagBg: '#FFE4EE',
  success: '#22C55E',
  warning: '#EAB308',
  danger: '#EF4444',
  onAccent: '#FFFFFF',
} as const;

// Contract de tip: light și dark trebuie să aibă EXACT aceleași chei.
// Mapped type → valorile devin `string` (nu literalii din `as const`),
// astfel încât light și dark să fie interschimbabile în ThemeProvider.
export type ThemeColors = { [K in keyof typeof darkTheme]: string };

export const CTA_GRADIENT = ['#FF2D78', '#E01B63'] as const;
export const ACCENT_GLOW = 'rgba(255,45,120,0.35)';
