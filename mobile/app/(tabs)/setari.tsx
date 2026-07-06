/** Setări: email-ul userului, selector de temă (Light/Dark/System), deconectare. */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

type Mode = 'light' | 'dark' | 'system';

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'light', label: 'Luminos' },
  { value: 'dark', label: 'Întunecat' },
  { value: 'system', label: 'Sistem' },
];

export default function SetariScreen() {
  const { colors, typography, spacing, radius, mode, setMode } = useTheme();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <ScreenContainer>
      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.xl }]}>
        Setări
      </Text>

      <View style={{ gap: spacing.xs, marginBottom: spacing.xl }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>Email</Text>
        <Text style={[typography.body, { color: colors.textPrimary }]}>
          {user?.email ?? '—'}
        </Text>
      </View>

      <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>Temă</Text>
        <View style={styles.modes}>
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <Pressable
                key={opt.value}
                testID={`theme-${opt.value}`}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMode(opt.value)}
                style={[
                  styles.modeBtn,
                  {
                    borderRadius: radius.pill,
                    paddingVertical: spacing.sm,
                    backgroundColor: active ? colors.accent : colors.surface,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    typography.caption,
                    { color: active ? colors.onAccent : colors.textPrimary },
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Button label="Deconectare" variant="outline" onPress={logout} testID="logout" />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  modes: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
  },
});
