# FLIRT — Design System

> **Slogan:** *No Regrets*
> Aplicație de dating construită în **React Native (Expo)**.

Acest folder conține documentația completă a design system-ului FLIRT: token-uri de culoare, scală tipografică și specificația componentelor reutilizabile. Sursa de adevăr vizuală este `flirt_paleta_culori.png` + prototipul, iar valorile brute trăiesc în `.context/DESIGN_TOKENS.md`.

## Cuprins

| Document | Ce conține |
|---|---|
| [`colors.md`](./colors.md) | Token-uri semantice de culoare (dark + light), `theme/colors.ts`, `ThemeProvider` |
| [`typography.md`](./typography.md) | Scala tipografică Manrope, `theme/typography.ts` |
| [`components.md`](./components.md) | Button, Card, Badge, Avatar, Chip, Input — props + stiluri + stări |

---

## Filozofia de design

### 1. Dark mode = modul principal
FLIRT este gândit **dark-first**. Fundalul negru cald (`#0D0D0F`) este mediul implicit în care rozul de brand „arde" cel mai bine. Light mode există ca mod alternativ complet suportat, dar deciziile de contrast și ierarhie se iau întâi pe dark.

### 2. Rozul = accent, maximum ~10% din ecran
`#FF2D78` este culoarea de brand și se folosește **doar** ca accent: butoane, CTA, link-uri, badge-uri, tag-uri. Nu se folosește niciodată ca fundal mare. Regula practică: dacă rozul acoperă mai mult de ~10% dintr-un ecran, ceva e greșit.

- Text **alb pe roz** = OK pentru butoane.
- Text **roz pe negru** = OK.
- Text **roz pe alb** = doar bold sau la mărimi mari (contrast insuficient altfel).

### 3. Font unic: Manrope
Un singur font pe toată aplicația, cu trei greutăți: `400` (Regular), `500` (Medium), `700` (Bold). Ierarhia se construiește din mărime + greutate, nu din familii diferite de font.

### 4. Stiluri separate de cod
**Principiu obligatoriu:** logica de componentă și valorile de stil trăiesc separat. Nu scriem culori hardcodate sau `StyleSheet` inline peste tot; totul derivă din folderul `theme/`.

```
src/
  theme/
    colors.ts        # darkTheme + lightTheme (token-uri semantice)
    typography.ts    # scala tipografică Manrope
    spacing.ts       # (opțional) spacing / radius scale
    index.ts         # export centralizat + tip Theme
    ThemeProvider.tsx
  components/
    Button/
      Button.tsx      # doar logica + JSX
      Button.styles.ts # StyleSheet extern, consumă theme
```

Reguli:
- **Zero hex hardcodat** în componente. Orice culoare vine din `theme.colors.*`.
- `StyleSheet` extern (fișier `*.styles.ts`) sau `styled-components`, niciodată stiluri inline cu valori literale.
- Componentele citesc tema prin hook-ul `useTheme()`, astfel switch-ul light/dark/system funcționează automat.

---

## Cum se folosesc token-urile în React Native

RN nu are variabile CSS. Token-urile sunt obiecte TypeScript, distribuite prin Context și consumate cu un hook.

```tsx
import { useTheme } from '@/theme';
import { createStyles } from './Button.styles';

export function Button({ label }: { label: string }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <Pressable style={styles.root}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}
```

```ts
// Button.styles.ts — stil separat de cod, consumă tema
import { StyleSheet } from 'react-native';
import type { Theme } from '@/theme';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    root: {
      backgroundColor: theme.colors.accent,   // #FF2D78 pe dark
      borderRadius: theme.radius.pill,         // 999
      paddingVertical: 14,
      paddingHorizontal: 24,
    },
    label: {
      ...theme.typography.button,              // Manrope 700
      color: theme.colors.onAccent,            // #FFFFFF
    },
  });
```

### Reguli de mișcare
- Tranziții hover/press: **150–200ms ease-out** pe culoare + o umbră roz subtilă.
- Umbra de accent: `0 4px 14px rgba(255,45,120,.35)` (în RN → `shadowColor: '#FF2D78'`, `shadowOpacity: 0.35`, `shadowRadius: 14`, `shadowOffset: { width: 0, height: 4 }` + `elevation` pe Android).

### Radius (token-uri de formă)
| Token | Valoare | Folosire |
|---|---|---|
| `radius.pill` | `999` | butoane, chips |
| `radius.card` | `18` | carduri, modale |
| `radius.badge` | `999` | badge-uri circulare (Compatibility %) |
</content>
</invoke>
