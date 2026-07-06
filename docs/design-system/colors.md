# FLIRT — Culori (Color Tokens)

Toate culorile aplicației derivă din `.context/DESIGN_TOKENS.md` și din paleta vizuală `flirt_paleta_culori.png`. Aici sunt organizate ca **token-uri semantice** (numite după rol, nu după valoare), astfel încât aceeași componentă să funcționeze identic în dark și light.

> **Regula de aur:** nicio componentă nu scrie un hex direct. Culorile se consumă doar prin `theme.colors.*`.

---

## Principiu: token semantic, nu culoare brută

Nu spunem `#FF2D78`, spunem `accent`. Nu spunem `#1A1A1E`, spunem `surface`. Astfel:

- același nume de token există în ambele teme, cu valori diferite;
- un singur `useTheme()` schimbă toată aplicația;
- rozul rămâne accent (max ~10% din ecran) prin disciplina numelui: `accent`, `link`, `tag` — nu `background`.

---

## Dark mode (principal)

Modul implicit. Rozul de brand arde cel mai bine pe negrul cald.

### Suprafețe
| Token semantic | Hex | Rol |
|---|---|---|
| `bg` | `#0D0D0F` | fundal pagină întreagă |
| `surface` | `#1A1A1E` | carduri, modale, meniuri |
| `surfaceHover` | `#232329` | hover pe carduri / liste |
| `border` | `#2C2C33` | linii, contururi, divider |

### Text
| Token semantic | Hex | Rol |
|---|---|---|
| `textPrimary` | `#FFFFFF` | titluri, mesaje |
| `textSecondary` | `#A6A6AF` | descrieri, captions, timestamp |
| `textDisabled` | `#5A5A63` | text dezactivat / placeholder |
| `link` | `#FF6BA0` | link / mențiune |

### Accent (roz brand)
| Token semantic | Hex | Rol |
|---|---|---|
| `accent` | `#FF2D78` | buton default, CTA, badge |
| `accentHover` | `#FF4D8D` | hover (rozul se **deschide**) |
| `accentPressed` | `#E01B63` | pressed (mai intens) |
| `accentDisabled` | `#6E2C46` | buton dezactivat |
| `onAccent` | `#FFFFFF` | text/iconă peste roz |
| `tagBg` | `#2B1420` | fundal tag / badge roz subtil |

---

## Light mode

Modul alternativ. Aici rozul devine mai **adânc** la hover pentru contrast pe alb.

### Suprafețe
| Token semantic | Hex | Rol |
|---|---|---|
| `bg` | `#FFFFFF` | fundal pagină întreagă |
| `surface` | `#F7F7F9` | carduri, modale, meniuri |
| `surfaceHover` | `#EFEFF3` | hover pe carduri / liste |
| `border` | `#E4E4EA` | linii, contururi, divider |

### Text
| Token semantic | Hex | Rol |
|---|---|---|
| `textPrimary` | `#141416` | titluri, mesaje |
| `textSecondary` | `#6E6E78` | descrieri, captions, timestamp |
| `textDisabled` | `#B4B4BC` | text dezactivat / placeholder |
| `link` | `#E01B63` | link / mențiune |

### Accent (roz brand)
| Token semantic | Hex | Rol |
|---|---|---|
| `accent` | `#FF2D78` | buton default, CTA, badge |
| `accentHover` | `#E01B63` | hover (rozul se **închide**) |
| `accentPressed` | `#C41556` | pressed (mai intens, aceeași direcție) |
| `accentDisabled` | `#F5A8C4` | buton dezactivat |
| `onAccent` | `#FFFFFF` | text/iconă peste roz |
| `tagBg` | `#FFE4EE` | fundal tag / badge roz subtil |

---

## Token-uri funcționale comune (ambele teme)

Aceste culori exprimă **stare/semnal**, nu suprafață, și sunt identice pe dark și light.

### Compatibility Score (badge %)
| Token | Hex | Prag |
|---|---|---|
| `compatHigh` | `#22C55E` (verde) | scor **> 80%** |
| `compatMid` | `#EAB308` (galben) | scor **50–80%** |
| `compatLow` | `#5A5A63` (gri) | scor **< 50%** |

> Notă: verdele/galbenul nu apar în paleta de brand — sunt culori funcționale de semnalizare, aliniate cu regula din TZ (secțiunea 4.2: `verde >80%, galben 50–80%, gri <50%`). Grile refolosește `textDisabled` din dark pentru consistență.

### Gradient CTA
Folosit pe butonul principal de acțiune (ex. „Trimite mesaj", „Connect!").
```
linear-gradient(120deg, #FF2D78, #E01B63)
```
În RN se implementează cu `expo-linear-gradient`:
```tsx
<LinearGradient
  colors={[theme.colors.accent, theme.colors.accentPressed]}
  start={{ x: 0, y: 0 }}
  end={{ x: 1, y: 1 }}   // ~120deg
/>
```

### Umbra de accent (glow roz)
```ts
export const accentShadow = {
  shadowColor: '#FF2D78',
  shadowOpacity: 0.35,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8, // Android
};
```

---

## `theme/colors.ts`

Fișier dedicat, sursa unică a culorilor. Nicio altă parte a codului nu conține hex-uri.

```ts
// src/theme/colors.ts

export const palette = {
  // Brand accent (identic în ambele teme)
  accent: '#FF2D78',
  onAccent: '#FFFFFF',
  white: '#FFFFFF',

  // Semnale funcționale (independente de temă)
  compatHigh: '#22C55E',
  compatMid: '#EAB308',
  compatLow: '#5A5A63',
} as const;

export const darkTheme = {
  // Suprafețe
  bg: '#0D0D0F',
  surface: '#1A1A1E',
  surfaceHover: '#232329',
  border: '#2C2C33',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#A6A6AF',
  textDisabled: '#5A5A63',
  link: '#FF6BA0',

  // Accent
  accent: '#FF2D78',
  accentHover: '#FF4D8D',
  accentPressed: '#E01B63',
  accentDisabled: '#6E2C46',
  onAccent: '#FFFFFF',
  tagBg: '#2B1420',

  // Semnale funcționale
  compatHigh: palette.compatHigh,
  compatMid: palette.compatMid,
  compatLow: palette.compatLow,
} as const;

export const lightTheme = {
  // Suprafețe
  bg: '#FFFFFF',
  surface: '#F7F7F9',
  surfaceHover: '#EFEFF3',
  border: '#E4E4EA',

  // Text
  textPrimary: '#141416',
  textSecondary: '#6E6E78',
  textDisabled: '#B4B4BC',
  link: '#E01B63',

  // Accent
  accent: '#FF2D78',
  accentHover: '#E01B63',
  accentPressed: '#C41556',
  accentDisabled: '#F5A8C4',
  onAccent: '#FFFFFF',
  tagBg: '#FFE4EE',

  // Semnale funcționale
  compatHigh: palette.compatHigh,
  compatMid: palette.compatMid,
  compatLow: palette.compatLow,
} as const;

// Contract de tip: ambele teme trebuie să aibă exact aceleași chei.
export type ThemeColors = typeof darkTheme;

export const themes = {
  dark: darkTheme,
  light: lightTheme,
} as const;

export type ColorScheme = keyof typeof themes; // 'dark' | 'light'
```

> `ThemeColors = typeof darkTheme` forțează, la compile-time, ca `lightTheme` să conțină exact aceleași token-uri. Dacă adaugi o culoare doar într-o temă, TypeScript dă eroare.

---

## Radius (token-uri de formă)

```ts
// src/theme/radius.ts
export const radius = {
  pill: 999,   // butoane, chips
  card: 18,    // carduri, modale
  badge: 999,  // Compatibility % (cerc)
  input: 12,   // câmpuri de text
} as const;
```

---

## `ThemeProvider` — switch light / dark / system

Cerință din TZ (secțiunea 6.3): temă **light / dark / system**. Providerul rezolvă `'system'` la schema reală a device-ului și expune obiectul complet de temă.

```tsx
// src/theme/ThemeProvider.tsx
import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type ColorScheme, type ThemeColors } from './colors';
import { typography } from './typography';
import { radius } from './radius';

export type ThemePreference = 'light' | 'dark' | 'system';

export type Theme = {
  colors: ThemeColors;
  typography: typeof typography;
  radius: typeof radius;
  scheme: ColorScheme; // schema efectiv aplicată
};

type ThemeContextValue = {
  theme: Theme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Persistă preferința (ex. AsyncStorage) — omis aici pentru claritate.
  const [preference, setPreference] = useState<ThemePreference>('system');
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null

  const theme = useMemo<Theme>(() => {
    const scheme: ColorScheme =
      preference === 'system'
        ? (systemScheme === 'light' ? 'light' : 'dark') // dark-first fallback
        : preference;

    return {
      colors: themes[scheme],
      typography,
      radius,
      scheme,
    };
  }, [preference, systemScheme]);

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook principal — consumat de componente și de fișierele *.styles.ts
export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx.theme;
}

// Hook pentru ecranul de Setări (schimbă preferința)
export function useThemePreference() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemePreference must be used within <ThemeProvider>');
  return { preference: ctx.preference, setPreference: ctx.setPreference };
}
```

### Utilizare în root
```tsx
// App.tsx
import { ThemeProvider } from '@/theme';

export default function App() {
  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}
```

### Utilizare în ecranul de Setări
```tsx
const { preference, setPreference } = useThemePreference();
// segmented control: 'light' | 'dark' | 'system'
```
</content>
