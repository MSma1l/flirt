/**
 * Buton „înapoi" reutilizabil pentru ecranele pushed peste taburi.
 *
 * Header-ele native sunt ascunse global (`app/_layout.tsx`:
 * `headerShown: false`), deci fiecare ecran care nu e tab trebuie să-și
 * pună singur o cale vizibilă de întoarcere. Componenta asta o standardizează:
 * aceeași iconiță, aceeași culoare din temă, aceeași zonă de atins, peste tot.
 *
 * Nu adaugă safe-area proprie: e gândit să stea într-un header care e deja în
 * interiorul unui `SafeAreaView` (`ScreenContainer` sau `SafeAreaView edges`),
 * ca să nu se dubleze insetul de sus.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ViewStyle } from 'react-native';

import { useTheme } from '@theme/index';

interface Props {
  /** Suprascrie comportamentul implicit (`router.back()`) — ex. `close`, `replace`. */
  onPress?: () => void;
  /** Culoarea iconiței. Implicit accentul temei, la fel ca back-urile existente. */
  color?: string;
  /** Latura iconiței. 28 e confortabil și clar fără să domine header-ul. */
  size?: number;
  /** Iconiță alternativă — ex. `close` pentru ecranele prezentate ca modal. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Stil pe container — util pentru margini când butonul stă singur peste titlu. */
  style?: ViewStyle;
  accessibilityLabel?: string;
  testID?: string;
}

/** Zona minimă de atins recomandată de Apple HIG. */
const MIN_TOUCH = 44;

export function BackButton({
  onPress,
  color,
  size = 28,
  icon = 'chevron-back',
  style,
  accessibilityLabel = 'Înapoi',
  testID,
}: Props) {
  const router = useRouter();
  const { colors } = useTheme();

  // hitSlop extinde zona de atins fără să miște layout-ul: cât lipsește iconiței
  // ca să atingă 44px, împărțit pe fiecare latură.
  const slop = Math.max(0, Math.round((MIN_TOUCH - size) / 2));

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress ?? (() => router.back())}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      style={style}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.accent} />
    </Pressable>
  );
}
