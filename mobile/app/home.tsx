/** Placeholder pentru feed — țintă de redirect după onboarding. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

export default function Home() {
  const logout = useAuthStore((s) => s.logout);
  const { colors, typography, spacing } = useTheme();

  return (
    <ScreenContainer>
      <View style={styles.content}>
        <Text style={[typography.h1, { color: colors.textPrimary, textAlign: 'center' }]}>
          Bun venit în FLIRT 👋
        </Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
          ]}
        >
          Feed-ul vine în curând.
        </Text>
      </View>

      <Button label="Deconectare" variant="outline" onPress={() => logout()} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
