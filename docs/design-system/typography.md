# FLIRT — Tipografie (Typography)

Font unic în toată aplicația: **Manrope**. Ierarhia se construiește din **mărime × greutate × line-height**, nu din familii diferite de font.

Greutăți folosite:

| Weight | Nume | Fișier font | Folosire |
|---|---|---|---|
| `400` | Regular | `Manrope-Regular` | body, text secundar, captions |
| `500` | Medium | `Manrope-Medium` | subtitluri, label-uri, chips |
| `700` | Bold | `Manrope-Bold` | titluri, nume, butoane, badge % |

> În RN nu se folosește `fontWeight: '700'` peste un singur fișier. Fiecare greutate este un **fișier de font separat** înregistrat cu `fontFamily` propriu (vezi „Încărcarea fontului").

---

## Scala tipografică

Valori exprimate în `fontSize / lineHeight` (dp). Scală optimizată pentru mobil, dark-first.

| Token | Size / Line | Weight | Folosire tipică |
|---|---|---|---|
| `display` | `34 / 40` | 700 | splash „FLIRT", titluri mari de ecran |
| `h1` | `28 / 34` | 700 | titlu ecran (ex. „Mesaje") |
| `h2` | `22 / 28` | 700 | nume pe cardul de anketa, secțiuni |
| `h3` | `18 / 24` | 700 | subtitluri, titlu card |
| `bodyLarge` | `16 / 24` | 400 | mesaje chat, „despre mine" |
| `body` | `15 / 22` | 400 | text standard UI |
| `bodyMedium` | `15 / 22` | 500 | label-uri, item de listă emphasized |
| `caption` | `13 / 18` | 400 | timestamp, distanță, meta |
| `captionMedium` | `13 / 18` | 500 | chips de interes, tag-uri |
| `overline` | `11 / 14` | 700 | etichete mici, UPPERCASE, `letterSpacing` |
| `button` | `16 / 20` | 700 | text pe butoane / CTA |
| `badge` | `14 / 16` | 700 | procent în Compatibility badge |

Corespondența cu paleta:
- Titluri/`display` → `textPrimary` (`#FFFFFF` dark / `#141416` light).
- Body secundar/`caption` → `textSecondary`.
- `button` → `onAccent` (`#FFFFFF`) când e pe roz.
- Text roz (link/mențiune) → doar la `700` sau mărimi mari, conform regulii „roz pe alb doar bold".

---

## `theme/typography.ts`

Stiluri reutilizabile, gata de aplicat pe `<Text>`. Componentele nu redefinesc mărimi/greutăți — le importă de aici.

```ts
// src/theme/typography.ts
import { TextStyle } from 'react-native';

// fontFamily = numele înregistrat la încărcarea fontului (un fișier per weight)
export const fonts = {
  regular: 'Manrope-Regular', // 400
  medium: 'Manrope-Medium',   // 500
  bold: 'Manrope-Bold',       // 700
} as const;

type TypeToken = Pick<
  TextStyle,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'
>;

export const typography = {
  display: {
    fontFamily: fonts.bold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 0.2,
  },
  h1: {
    fontFamily: fonts.bold,
    fontSize: 28,
    lineHeight: 34,
  },
  h2: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 28,
  },
  h3: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 24,
  },
  bodyLarge: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  captionMedium: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  overline: {
    fontFamily: fonts.bold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
  },
  button: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 20,
  },
  badge: {
    fontFamily: fonts.bold,
    fontSize: 14,
    lineHeight: 16,
  },
} satisfies Record<string, TypeToken>;

export type TypographyToken = keyof typeof typography;
```

---

## Încărcarea fontului (Expo)

Cu `expo-font` — un fișier per greutate, fiecare cu numele său. Nu folosim `fontWeight` numeric, ci `fontFamily` explicit (comportament consistent pe iOS + Android).

```tsx
// App.tsx
import { useFonts } from 'expo-font';

export default function App() {
  const [loaded] = useFonts({
    'Manrope-Regular': require('./assets/fonts/Manrope-Regular.ttf'),
    'Manrope-Medium': require('./assets/fonts/Manrope-Medium.ttf'),
    'Manrope-Bold': require('./assets/fonts/Manrope-Bold.ttf'),
  });

  if (!loaded) return null; // splash screen „No Regrets" până se încarcă

  return (
    <ThemeProvider>
      <RootNavigator />
    </ThemeProvider>
  );
}
```

---

## Utilizare într-o componentă

Text-ul preia stilul din `theme.typography` și culoarea din `theme.colors` — nimic hardcodat.

```tsx
import { Text } from 'react-native';
import { useTheme } from '@/theme';

export function ProfileName({ name, age }: { name: string; age: number }) {
  const theme = useTheme();
  return (
    <Text style={[theme.typography.h2, { color: theme.colors.textPrimary }]}>
      {name}, {age}
    </Text>
  );
}
```

### Recomandat: componentă `Typography` (opțional)
Pentru a evita repetarea `[typography.x, { color }]`, un wrapper subțire:

```tsx
// src/components/Typography.tsx
import { Text, TextProps } from 'react-native';
import { useTheme } from '@/theme';
import type { TypographyToken } from '@/theme/typography';

type Props = TextProps & {
  variant?: TypographyToken;
  color?: 'textPrimary' | 'textSecondary' | 'textDisabled' | 'link' | 'onAccent';
};

export function Typography({
  variant = 'body',
  color = 'textPrimary',
  style,
  ...rest
}: Props) {
  const theme = useTheme();
  return (
    <Text
      style={[theme.typography[variant], { color: theme.colors[color] }, style]}
      {...rest}
    />
  );
}
```

Folosire:
```tsx
<Typography variant="h2">Ana, 24</Typography>
<Typography variant="caption" color="textSecondary">3 km de tine</Typography>
```
</content>
