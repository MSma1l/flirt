/** Ecran de întâmpinare: logo FLIRT + slogan + acțiuni cont nou / autentificare. */
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { useTheme } from '@theme/index';

export default function Welcome() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <Text style={[typography.display, { color: colors.accent, letterSpacing: 2 }]}>
          FLIRT
        </Text>
        <Text
          style={[
            typography.bodyStrong,
            { color: colors.textSecondary, marginTop: spacing.sm },
          ]}
        >
          No Regrets
        </Text>
      </View>

      <View style={{ gap: spacing.md }}>
        <Button label="Creează cont" onPress={() => router.push('/(auth)/register')} />
        <Button
          label="Am deja cont"
          variant="outline"
          onPress={() => router.push('/(auth)/login')}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
