/**
 * Selector de limbă pentru ecranul Setări.
 *
 * Cele 4 limbi apar cu numele lor ÎN LIMBA LOR (endonime: „Română",
 * „Русский", „Українська", „English") — un vorbitor de ucraineană își recunoaște
 * limba chiar dacă interfața e acum în alta. Etichetele vin din `useLanguage()`
 * (constanta `LANGUAGE_LABELS`), nu se traduc și nu se duplică aici.
 *
 * Tap → `setLanguage(code)`: schimbă i18next (UI-ul migrat se re-randează imediat)
 * ȘI persistă alegerea. Ecranul Setări e migrat, deci se vede pe loc în limba nouă.
 *
 * Web: fiecare opțiune e un `Pressable` (→ `<button>`) așezat DIRECT în acest
 * `View`, nu într-un card apăsabil — fără buton-în-buton (HTML invalid).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@theme/index';

export function LanguagePicker() {
  const { colors, typography, radius, spacing } = useTheme();
  const { current, available, labels, setLanguage } = useLanguage();

  return (
    <View style={styles.wrap}>
      {available.map((code) => {
        const active = current === code;
        return (
          <Pressable
            key={code}
            testID={`language-${code}`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              // Nu re-selecta limba deja activă — evită un `changeLanguage` inutil.
              if (!active) void setLanguage(code);
            }}
            style={[
              styles.chip,
              {
                borderRadius: radius.pill,
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.lg,
                backgroundColor: active ? colors.tagBg : colors.surface,
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.caption,
                { color: active ? colors.accent : colors.textSecondary },
              ]}
            >
              {labels[code]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5 },
});
