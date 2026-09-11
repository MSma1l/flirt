/**
 * Comutator COMPACT de limbă: trei cipuri scurte — RO / RU / EN.
 *
 * De ce încă un selector, când există deja `features/settings/LanguagePicker`:
 * acela stă în Setări, unde e loc pentru endonimele întregi („Română",
 * „Русский", „English") și unde userul vine anume ca să schimbe ceva. Aici e
 * altă situație — ecranele de auth sunt primul contact, iar limba trebuie
 * schimbată dintr-o atingere, fără să fure locul butoanelor principale. De asta
 * eticheta e codul din două litere, nu numele limbii.
 *
 * Codul (`RO`) NU se traduce și nu stă în cataloage: e derivat din `Language`
 * cu `toUpperCase()`. O cheie i18n pentru „RO" ar fi aceeași valoare în toate
 * limbile — trei fișiere de întreținut pentru zero variație.
 *
 * Accesibilitate: cititorul de ecran ar silabisi „R-O", așa că `accessibilityLabel`
 * poartă numele întreg al limbii (`LANGUAGE_LABELS`), în limba ei.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { useLanguage } from '@/i18n/useLanguage';
import { useTheme } from '@theme/index';

export function LanguageSwitcher({ style }: { style?: ViewStyle }) {
  const { colors, typography, radius, spacing } = useTheme();
  const { current, available, labels, setLanguage } = useLanguage();

  return (
    <View style={[styles.wrap, style]} testID="language-switcher">
      {available.map((code) => {
        const active = current === code;
        return (
          <Pressable
            key={code}
            testID={`language-switch-${code}`}
            accessibilityRole="button"
            accessibilityLabel={labels[code]}
            accessibilityState={{ selected: active }}
            onPress={() => {
              // Nu re-selecta limba deja activă — evită un `changeLanguage` inutil.
              if (!active) void setLanguage(code);
            }}
            style={[
              styles.chip,
              {
                borderRadius: radius.pill,
                paddingVertical: spacing.xs,
                paddingHorizontal: spacing.md,
                backgroundColor: active ? colors.tagBg : 'transparent',
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                typography.badge,
                { color: active ? colors.accent : colors.textSecondary },
              ]}
            >
              {code.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Aliniat la dreapta: ecranele de auth au titlul la stânga, iar comutatorul
  // e o unealtă secundară — nu trebuie să concureze cu el.
  wrap: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  chip: { borderWidth: 1 },
});
