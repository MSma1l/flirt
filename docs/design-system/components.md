# FLIRT — Componente (Component Specs)

Componente reutilizabile derivate din prototip și din `flirt_paleta_culori.png`. Fiecare componentă respectă principiul **stil separat de cod**: JSX + logica în `*.tsx`, `StyleSheet` extern în `*.styles.ts`, valori doar din `theme`.

Culorile de mai jos sunt exacte, din `.context/DESIGN_TOKENS.md`. Notația `dark / light` arată valoarea în fiecare temă când diferă; token-ul semantic e același.

Radius folosit: `pill = 999`, `card = 18`, `input = 12`.

---

## 1. Button

Buton pill (radius `999`), font `Manrope 700` (`typography.button`), text alb pe roz.

### Variante
| Variantă | Descriere |
|---|---|
| `primary` | plin, roz solid (default) |
| `gradient` | CTA principal, gradient `120deg #FF2D78 → #E01B63` + glow roz |
| `outline` | fundal transparent, border roz `#FF2D78`, text roz |
| `ghost` | fără fundal/border, doar text roz (acțiuni terțiare) |

### Props
```ts
type ButtonProps = {
  label: string;
  variant?: 'primary' | 'gradient' | 'outline' | 'ghost';
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;    // opțional, la stânga label-ului
  fullWidth?: boolean;
};
```

### Stări și culori (variant `primary`)
| Stare | Background | Text | Notă |
|---|---|---|---|
| default | `accent` — `#FF2D78` | `onAccent` `#FFFFFF` | — |
| hover* | `accentHover` — `#FF4D8D` dark / `#E01B63` light | `#FFFFFF` | glow roz `rgba(255,45,120,.35)` |
| pressed | `accentPressed` — `#E01B63` dark / `#C41556` light | `#FFFFFF` | scale `0.98` |
| disabled | `accentDisabled` — `#6E2C46` dark / `#F5A8C4` light | `#FFFFFF` @ 60% opacity | fără glow, `onPress` blocat |

\* „hover" pe mobil = feedback la atingere susținută / focus; în RN se mapează pe `Pressable` state.

### Stări variant `outline`
| Stare | Background | Border | Text |
|---|---|---|---|
| default | `transparent` | `accent` `#FF2D78` | `accent` `#FF2D78` |
| pressed | `tagBg` — `#2B1420` dark / `#FFE4EE` light | `accentPressed` | `accentPressed` |
| disabled | `transparent` | `accentDisabled` | `accentDisabled` |

### Layout
- `borderRadius: radius.pill` (999)
- `paddingVertical: 14`, `paddingHorizontal: 24`
- `minHeight: 52`
- gap icon/label: `8`
- tranziție culoare: 150–200ms ease-out

### Cod (stil separat)
```tsx
// components/Button/Button.tsx
import { Pressable, Text, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';
import { createStyles } from './Button.styles';

export function Button({
  label, variant = 'primary', onPress, disabled, loading, icon, fullWidth,
}: ButtonProps) {
  const theme = useTheme();
  const s = createStyles(theme);

  const content = (pressed: boolean) => (
    <View style={s.content}>
      {loading ? <ActivityIndicator color={theme.colors.onAccent} />
        : (<>{icon}<Text style={s.label(variant, disabled)}>{label}</Text></>)}
    </View>
  );

  if (variant === 'gradient') {
    return (
      <Pressable onPress={onPress} disabled={disabled || loading}
        style={[s.base(fullWidth), disabled && s.disabledShadow]}>
        {({ pressed }) => (
          <LinearGradient
            colors={[theme.colors.accent, theme.colors.accentPressed]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={[s.gradientFill, pressed && s.pressed]}>
            {content(pressed)}
          </LinearGradient>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [s.root(variant, disabled, pressed, fullWidth)]}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}
```

```ts
// components/Button/Button.styles.ts
import { StyleSheet } from 'react-native';
import type { Theme } from '@/theme';

export const createStyles = (theme: Theme) => {
  const { colors, radius, typography } = theme;

  const bg = (variant: string, disabled?: boolean, pressed?: boolean) => {
    if (variant === 'outline' || variant === 'ghost') {
      return pressed && variant === 'outline' ? colors.tagBg : 'transparent';
    }
    if (disabled) return colors.accentDisabled;
    if (pressed) return colors.accentPressed;
    return colors.accent;
  };

  return {
    base: (fullWidth?: boolean) => ({
      borderRadius: radius.pill,
      overflow: 'hidden' as const,
      alignSelf: fullWidth ? ('stretch' as const) : ('flex-start' as const),
    }),
    root: (variant: string, disabled = false, pressed = false, fullWidth = false) => ({
      minHeight: 52,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: radius.pill,
      backgroundColor: bg(variant, disabled, pressed),
      borderWidth: variant === 'outline' ? 1.5 : 0,
      borderColor: disabled ? colors.accentDisabled : colors.accent,
      transform: [{ scale: pressed ? 0.98 : 1 }],
      alignSelf: fullWidth ? ('stretch' as const) : ('flex-start' as const),
      // glow roz (doar variantele pline, non-disabled)
      ...(variant === 'primary' && !disabled ? {
        shadowColor: colors.accent, shadowOpacity: 0.35,
        shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 8,
      } : {}),
    }),
    gradientFill: {
      minHeight: 52, paddingVertical: 14, paddingHorizontal: 24,
      alignItems: 'center' as const, justifyContent: 'center' as const,
    },
    disabledShadow: { opacity: 0.6 },
    pressed: { transform: [{ scale: 0.98 }] },
    content: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, justifyContent: 'center' as const },
    label: (variant: string, disabled?: boolean) => ({
      ...typography.button,
      color: variant === 'outline' || variant === 'ghost' ? colors.accent : colors.onAccent,
      opacity: disabled ? 0.6 : 1,
    }),
  };
};
```

---

## 2. Card

Container pentru anchete, dialoguri, modale. Radius `18`.

### Props
```ts
type CardProps = {
  children: React.ReactNode;
  onPress?: () => void;       // dacă e apăsabil, aplică starea hover
  padded?: boolean;           // padding intern 16 (default true)
  elevated?: boolean;         // umbră subtilă
};
```

### Stiluri
| Proprietate | Valoare |
|---|---|
| background | `surface` — `#1A1A1E` dark / `#F7F7F9` light |
| background (hover/press) | `surfaceHover` — `#232329` dark / `#EFEFF3` light |
| border | `1px` `border` — `#2C2C33` dark / `#E4E4EA` light |
| borderRadius | `radius.card` (18) |
| padding | `16` (dacă `padded`) |

```ts
// components/Card/Card.styles.ts
import { StyleSheet } from 'react-native';
import type { Theme } from '@/theme';

export const createStyles = ({ colors, radius }: Theme) =>
  StyleSheet.create({
    root: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    pressed: { backgroundColor: colors.surfaceHover },
    elevated: {
      shadowColor: '#000', shadowOpacity: 0.25,
      shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4,
    },
  });
```

---

## 3. Badge

Două tipuri distincte: **Compatibility % badge** (circular, colorat după scor) și **Tag badge** (roz subtil, pentru interese/etichete).

### 3a. CompatibilityBadge
Badge circular din colțul cardului de anketa (TZ 4.2). Culoarea semnalizează scorul.

```ts
type CompatibilityBadgeProps = {
  score: number; // 0–100
};
```

| Scor | Token culoare | Hex |
|---|---|---|
| `> 80` | `compatHigh` (verde) | `#22C55E` |
| `50–80` | `compatMid` (galben) | `#EAB308` |
| `< 50` | `compatLow` (gri) | `#5A5A63` |

- text: `typography.badge` (Manrope 700, 14), culoare `#FFFFFF`
- formă: cerc, `borderRadius: radius.badge` (999), `paddingH: 10`, `paddingV: 6`, `minWidth: 44`
- opțional glow discret în culoarea scorului la scoruri mari

```tsx
// components/Badge/CompatibilityBadge.tsx
import { View, Text } from 'react-native';
import { useTheme } from '@/theme';

export function CompatibilityBadge({ score }: { score: number }) {
  const { colors, typography, radius } = useTheme();
  const color =
    score > 80 ? colors.compatHigh
    : score >= 50 ? colors.compatMid
    : colors.compatLow;

  return (
    <View style={{
      backgroundColor: color, borderRadius: radius.badge,
      paddingHorizontal: 10, paddingVertical: 6, minWidth: 44,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={[typography.badge, { color: colors.onAccent }]}>{score}%</Text>
    </View>
  );
}
```

### 3b. TagBadge (etichetă roz subtilă)
Pentru status de anketa, „Verificat ✓", categorii — fundal roz foarte discret.

| Proprietate | Valoare |
|---|---|
| background | `tagBg` — `#2B1420` dark / `#FFE4EE` light |
| text | `link` — `#FF6BA0` dark / `#E01B63` light |
| typography | `captionMedium` (Manrope 500, 13) |
| borderRadius | `radius.pill` (999) |
| padding | `V: 4`, `H: 10` |

```tsx
export function TagBadge({ label }: { label: string }) {
  const { colors, typography, radius } = useTheme();
  return (
    <View style={{
      backgroundColor: colors.tagBg, borderRadius: radius.pill,
      paddingVertical: 4, paddingHorizontal: 10, alignSelf: 'flex-start',
    }}>
      <Text style={[typography.captionMedium, { color: colors.link }]}>{label}</Text>
    </View>
  );
}
```

---

## 4. Avatar

Poza rotundă a utilizatorului (listă chat, shapka conversație). Suportă badge de verificare și indicator online.

### Props
```ts
type AvatarProps = {
  uri?: string;
  size?: 'sm' | 'md' | 'lg' | number; // sm=40, md=56, lg=96
  online?: boolean;      // punct verde jos-dreapta
  verified?: boolean;    // bifă „✓ Verificat" (TZ 2.2)
  fallbackInitials?: string;
};
```

### Stiluri
| Proprietate | Valoare |
|---|---|
| formă | cerc, `borderRadius: size / 2` |
| border | `2px` `surface` (separă de fundal) |
| fallback bg | `surfaceHover` |
| fallback text | `textSecondary`, `typography.h3` |
| online dot | `compatHigh` `#22C55E`, `ring` în culoarea `bg` |
| verified badge | roz `accent` `#FF2D78`, bifă `onAccent` |

Dimensiuni: `sm: 40`, `md: 56`, `lg: 96`.

```ts
const sizeMap = { sm: 40, md: 56, lg: 96 } as const;
```

---

## 5. Chip (interes)

Selectabil, pentru lista de interese din anketa (TZ 2.5). Radius pill, cu iconă opțională.

### Props
```ts
type ChipProps = {
  label: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
};
```

### Stări
| Stare | Background | Border | Text |
|---|---|---|---|
| default | `surface` — `#1A1A1E` / `#F7F7F9` | `border` `#2C2C33` / `#E4E4EA` | `textSecondary` |
| selected | `tagBg` — `#2B1420` / `#FFE4EE` | `accent` `#FF2D78` | `accent` `#FF2D78` |
| pressed | `surfaceHover` | `border` | `textPrimary` |
| disabled | `surface` | `border` | `textDisabled` |

### Layout
- `borderRadius: radius.pill` (999)
- `paddingV: 8`, `paddingH: 14`, gap icon/label `6`
- `typography.captionMedium` (Manrope 500, 13)
- `borderWidth: 1` (default) / `1.5` (selected)

```ts
// components/Chip/Chip.styles.ts
export const createStyles = ({ colors, radius, typography }: Theme) => ({
  root: (selected: boolean, disabled: boolean) => ({
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: selected ? colors.tagBg : colors.surface,
    borderWidth: selected ? 1.5 : 1,
    borderColor: selected ? colors.accent : colors.border,
    opacity: disabled ? 0.5 : 1,
  }),
  label: (selected: boolean, disabled: boolean) => ({
    ...typography.captionMedium,
    color: disabled ? colors.textDisabled
      : selected ? colors.accent : colors.textSecondary,
  }),
});
```

---

## 6. Input

Câmp de text pentru login, editare anketa, chat. Radius `12`.

### Props
```ts
type InputProps = {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  disabled?: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};
```

### Stări și culori
| Stare | Background | Border | Text | Placeholder |
|---|---|---|---|---|
| default | `surface` — `#1A1A1E` / `#F7F7F9` | `border` `#2C2C33` / `#E4E4EA` | `textPrimary` | `textDisabled` |
| focused | `surface` | `accent` `#FF2D78` (1.5px) + glow roz | `textPrimary` | `textDisabled` |
| error | `surface` | `#EF4444` | `textPrimary` | `textDisabled` |
| disabled | `bg` | `border` | `textDisabled` | `textDisabled` |

### Layout
- `borderRadius: radius.input` (12)
- `paddingV: 14`, `paddingH: 16`, `minHeight: 52`
- text: `typography.body` (Manrope 400, 15)
- `label`: `typography.captionMedium` deasupra, culoare `textSecondary`
- `error`: `typography.caption`, culoare `#EF4444`, sub câmp

```ts
// components/Input/Input.styles.ts
export const createStyles = ({ colors, radius, typography }: Theme) => ({
  field: (focused: boolean, error?: string, disabled?: boolean) => ({
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    minHeight: 52, paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: radius.input,
    backgroundColor: disabled ? colors.bg : colors.surface,
    borderWidth: focused || error ? 1.5 : 1,
    borderColor: error ? '#EF4444' : focused ? colors.accent : colors.border,
    ...(focused && !error ? {
      shadowColor: colors.accent, shadowOpacity: 0.35,
      shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
    } : {}),
  }),
  input: {
    flex: 1, ...typography.body, color: colors.textPrimary, padding: 0,
  },
  label: { ...typography.captionMedium, color: colors.textSecondary, marginBottom: 6 },
  error: { ...typography.caption, color: '#EF4444', marginTop: 6 },
});
```

---

## Rezumat token → componentă

| Token | Unde apare |
|---|---|
| `accent #FF2D78` | Button primary/gradient, Chip selected border, Input focus, Avatar verified |
| `accentHover / accentPressed` | Button hover/pressed |
| `accentDisabled` | Button disabled |
| `surface / surfaceHover` | Card, Chip, Input, Avatar fallback |
| `border` | Card, Chip, Input, Avatar ring |
| `tagBg` | TagBadge, Chip selected, Button outline pressed |
| `link` | TagBadge text |
| `compatHigh/Mid/Low` | CompatibilityBadge, Avatar online dot |
| `onAccent #FFFFFF` | text pe Button, CompatibilityBadge |

Toate valorile sunt exact cele din `.context/DESIGN_TOKENS.md`. `#EF4444` (roșu eroare) și `#22C55E`/`#EAB308` (verde/galben compat) sunt culori funcționale de semnal, nu culori de brand, conform regulilor din TZ 4.2.
</content>
