# FLIRT — Styling ("stiluri separate de cod")

> Vezi și: [`README.md`](./README.md) · [`navigation.md`](./navigation.md) · [`screens.md`](./screens.md)
> Sursa tokenilor: [`.context/DESIGN_TOKENS.md`](../../.context/DESIGN_TOKENS.md)

Principiul fundamental: **stilurile sunt separate de cod**. O componentă descrie *structura* și *comportamentul*; **nu** conține valori vizuale hardcodate. Culorile, tipografia, spacing-ul, radius-urile și umbrele vin dintr-o **singură sursă de adevăr**: folderul `theme/`.

---

## 1. De ce separăm stilurile de cod

- **Un singur loc de schimbare.** Ajustezi un token în `theme/colors.ts` și se propagă în toată aplicația.
- **Light/dark corect.** Nicio componentă nu "știe" ce temă e activă; primește culorile din context.
- **Consistență.** Imposibil să apară două nuanțe ușor diferite de roz — există un singur `accent`.
- **Testabil și lizibil.** Componenta rămâne curată; stilul stă în fișier separat.
- **Localizare/scalare.** Tipografia (Manrope) și spacing-ul scalate central respectă accesibilitatea.

---

## 2. Structura `theme/`

```
src/theme/
├── colors.ts          # tokens dark + light (din DESIGN_TOKENS.md)
├── typography.ts      # Manrope: familii, mărimi, greutăți, line-height
├── spacing.ts         # scală spacing + radius (pill 999, card 18)
├── shadows.ts         # umbre, inclusiv glow roz accent
├── gradients.ts       # gradient CTA roz
├── theme.ts           # asamblează lightTheme / darkTheme
├── ThemeProvider.tsx  # context + hook useTheme()
└── index.ts           # export public: useTheme, tokens de tip
```

### 2.1 `colors.ts` — tokenii din DESIGN_TOKENS.md
Culorile NU se scriu ca hex prin componente. Ele trăiesc aici, o singură dată, pe temă:

```ts
// src/theme/colors.ts  (ilustrativ)
export const darkColors = {
  bg:            '#0D0D0F',
  surface:       '#1A1A1E',
  surfaceHover:  '#232329',
  border:        '#2C2C33',
  textPrimary:   '#FFFFFF',
  textSecondary: '#A6A6AF',
  textDisabled:  '#5A5A63',
  link:          '#FF6BA0',
  accent:        '#FF2D78',
  accentHover:   '#FF4D8D',
  accentPressed: '#E01B63',
  accentDisabled:'#6E2C46',
  tagBg:         '#2B1420',
} as const;

export const lightColors = {
  bg:            '#FFFFFF',
  surface:       '#F7F7F9',
  surfaceHover:  '#EFEFF3',
  border:        '#E4E4EA',
  textPrimary:   '#141416',
  textSecondary: '#6E6E78',
  textDisabled:  '#B4B4BC',
  link:          '#E01B63',
  accent:        '#FF2D78',
  accentHover:   '#E01B63',
  accentPressed: '#C41556',
  accentDisabled:'#F5A8C4',
  tagBg:         '#FFE4EE',
} as const;

export type ColorTokens = typeof darkColors; // ambele teme au aceleași chei
```

> Cele două teme au **exact aceleași chei** — de aceea o componentă poate cere `colors.accent` fără să știe ce temă e activă.

### 2.2 `typography.ts` — Manrope
```ts
// src/theme/typography.ts  (ilustrativ)
export const fonts = {
  regular:  'Manrope_400Regular',
  medium:   'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold:     'Manrope_700Bold',
} as const;

export const typography = {
  h1:      { fontFamily: fonts.bold,     fontSize: 28, lineHeight: 34 },
  h2:      { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28 },
  body:    { fontFamily: fonts.regular,  fontSize: 16, lineHeight: 22 },
  caption: { fontFamily: fonts.regular,  fontSize: 13, lineHeight: 18 },
  button:  { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
} as const;
```

### 2.3 `spacing.ts` — spacing + radius
```ts
// src/theme/spacing.ts  (ilustrativ)
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius  = { sm: 8, card: 18, badge: 14, pill: 999 } as const; // TZ tokens
```

### 2.4 `shadows.ts` + `gradients.ts`
```ts
// src/theme/shadows.ts
export const shadows = {
  // glow roz din DESIGN_TOKENS: 0 4px 14px rgba(255,45,120,.35)
  accentGlow: {
    shadowColor: '#FF2D78', shadowOpacity: 0.35,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
} as const;

// src/theme/gradients.ts  (folosit cu expo-linear-gradient)
export const gradients = {
  cta: { colors: ['#FF2D78', '#E01B63'], start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }, // 120deg
} as const;
```

### 2.5 `theme.ts` + `ThemeProvider.tsx`
```ts
// src/theme/theme.ts
export const darkTheme  = { colors: darkColors,  typography, spacing, radius, shadows, gradients };
export const lightTheme = { colors: lightColors, typography, spacing, radius, shadows, gradients };
export type AppTheme = typeof darkTheme;
```

```tsx
// src/theme/ThemeProvider.tsx  (ilustrativ)
const ThemeContext = createContext<AppTheme>(darkTheme);

export function ThemeProvider({ children }: PropsWithChildren) {
  const mode = useThemeStore(s => s.mode);       // 'light' | 'dark' | 'system'
  const system = useColorScheme();               // din react-native
  const resolved = mode === 'system' ? system : mode;
  const theme = resolved === 'light' ? lightTheme : darkTheme;
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
```

---

## 3. Pattern-ul StyleSheet — stil separat de cod

Regula: **fiecare componentă cu stiluri are un fișier `*.styles.ts` alături**, iar stilurile sunt o **factory** care primește tema (nu importă culori direct).

```
components/Button/
├── Button.tsx
├── Button.styles.ts
└── index.ts
```

```ts
// components/Button/Button.styles.ts
import { StyleSheet } from 'react-native';
import type { AppTheme } from '@theme';

export const makeStyles = (t: AppTheme) =>
  StyleSheet.create({
    root: {
      backgroundColor: t.colors.accent,
      borderRadius: t.radius.pill,          // 999 — pill
      paddingVertical: t.spacing.md,
      paddingHorizontal: t.spacing.xl,
      ...t.shadows.accentGlow,
    },
    label: { ...t.typography.button, color: t.colors.textPrimary },
    disabled: { backgroundColor: t.colors.accentDisabled },
  });
```

```tsx
// components/Button/Button.tsx
import { Pressable, Text } from 'react-native';
import { useTheme } from '@theme';
import { makeStyles } from './Button.styles';

export function Button({ label, disabled, onPress }: ButtonProps) {
  const theme = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]); // re-calc doar la schimbarea temei
  return (
    <Pressable style={[s.root, disabled && s.disabled]} onPress={onPress} disabled={disabled}>
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}
```

Componenta descrie *ce* și *cum se comportă*; `*.styles.ts` descrie *cum arată*, iar valorile vin din temă. Zero hex-uri în `.tsx`.

---

## 4. Ce este INTERZIS (anti-pattern-uri)

```tsx
// ❌ GREȘIT — culoare hardcodată în componentă
<View style={{ backgroundColor: '#FF2D78' }} />

// ❌ GREȘIT — mărime/spacing "magic number" în JSX
<Text style={{ fontSize: 16, color: '#FFFFFF', margin: 12 }} />

// ❌ GREȘIT — stil inline complex amestecat cu logica
```

```tsx
// ✅ CORECT — totul din temă
const t = useTheme();
<View style={{ backgroundColor: t.colors.accent }} />
// sau, mai bine, dintr-un *.styles.ts:
<View style={s.card} />
```

Reguli de aur:
1. **Niciun hex** în afară de `theme/colors.ts` (verificabil cu ESLint — vezi §7).
2. **Niciun număr magic** de spacing/radius/fontSize în JSX; folosește `spacing`/`radius`/`typography`.
3. Componentele din `components/` **nu importă din `features/`** și nu conțin logică de business.
4. Textul folosește wrapper-ul `<Text>` din `components/Text` care aplică tipografia din temă (nu `Text`-ul brut din react-native cu stiluri ad-hoc).

---

## 5. Light / dark / system

- Sursa modului: `themeStore` (`light | dark | system`), setat din **Preferences** (TZ 6.3 "тема: светлая/тёмная/системная").
- `ThemeProvider` rezolvă `system` prin `useColorScheme()` din react-native și alege `lightTheme`/`darkTheme`.
- Componentele **nu ramifică** pe temă (`if (isDark) ...`); cer mereu `colors.X`, iar tema livrează valoarea corectă. Astfel adăugarea unei teme noi nu atinge componentele.
- `StatusBar`, tab bar, fundalul rădăcină și hărțile își iau culorile tot din temă.

Dark mode e tema principală (conform DESIGN_TOKENS.md), dar ambele sunt complet definite și la paritate de chei.

---

## 6. Reguli de accent și brand (din DESIGN_TOKENS.md)

- **Accentul roz = max ~10% din ecran.** Se folosește pentru CTA-uri, badge-uri importante, elemente active — nu pentru suprafețe mari.
- **Text alb pe roz** = OK pentru butoane. **Text roz pe alb** = doar bold / mărimi mari (`link`/`accent`).
- **Radius:** butoane `pill` (999), carduri `18`, badge-uri mari `badge`.
- **Gradient CTA:** `gradients.cta` (`#FF2D78 → #E01B63`, ~120°) prin `expo-linear-gradient`.
- **Tranziții hover/press:** 150–200ms ease-out (culoare + glow roz) — pentru press-state pe web/large screens; pe mobil folosim `Pressable` cu `accentHover`/`accentPressed`.
- **CompatBadge (TZ 4.2):** culoarea se derivă din scor printr-un helper, nu hardcodat în JSX:
  ```ts
  // utils/compatibility.ts
  export const compatColor = (score: number, c: ColorTokens) =>
    score > 80 ? '#3FB57A' : score >= 50 ? '#E6B23A' : c.textDisabled; // verde/galben/gri
  ```
  (Verdele/galbenul pot fi promovate ca tokeni `success`/`warning` în `colors.ts` pentru a rămâne 100% în temă.)

---

## 7. Impunere automată (lint)

Pentru a garanta "zero hex în componente", CI rulează reguli ESLint:

- `react-native/no-color-literals` — interzice culori literale în stiluri.
- `react-native/no-inline-styles` — descurajează stilurile inline.
- Regulă custom / restricție de import: hex-urile sunt permise **doar** în `src/theme/**`.

Astfel principiul "stiluri separate de cod" nu depinde de disciplină manuală, ci e verificat la fiecare PR.

---

## 8. Rezumat
- O singură sursă de adevăr: `theme/` (colors, typography, spacing, shadows, gradients).
- Fiecare componentă cu stil are `*.styles.ts` de tip `makeStyles(theme)`.
- Componentele nu conțin hex-uri, numere magice sau ramuri pe temă.
- Light/dark/system rezolvate central prin `ThemeProvider` + `useTheme()`.
- Regulile ESLint impun separarea automat.
