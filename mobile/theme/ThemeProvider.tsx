/** Provider de temă light/dark/system + hook `useTheme`. */
import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme, ThemeColors } from './colors';
import { radius, spacing, typography } from './typography';

type Mode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: ThemeColors;
  mode: Mode;
  isDark: boolean;
  setMode: (m: Mode) => void;
  typography: typeof typography;
  radius: typeof radius;
  spacing: typeof spacing;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setMode] = useState<Mode>('system');

  const isDark = mode === 'system' ? system !== 'light' : mode === 'dark';

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: isDark ? darkTheme : lightTheme,
      mode,
      isDark,
      setMode,
      typography,
      radius,
      spacing,
    }),
    [isDark, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme trebuie folosit în interiorul <ThemeProvider>');
  return ctx;
}
