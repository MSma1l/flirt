/** Ecran splash + logică de redirect în funcție de starea de autentificare. */
import { Redirect } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAuthStore } from '@/store/authStore';
import { ScreenContainer } from '@/components/ui';
import { useTheme } from '@theme/index';

export default function Index() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const { colors, typography, spacing } = useTheme();

  if (status === 'unauthenticated') {
    return <Redirect href="/(auth)/welcome" />;
  }

  if (status === 'authenticated') {
    if (user && !user.profile_completed) {
      return <Redirect href="/(onboarding)" />;
    }
    return <Redirect href="/(tabs)/ankete" />;
  }

  // status === 'loading' → splash
  return (
    <ScreenContainer center>
      <View style={styles.brand}>
        <Image
          testID="brand-logo"
          accessibilityLabel="FLIRT"
          source={require('../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text
          style={[
            typography.bodyStrong,
            { color: colors.textSecondary, marginTop: spacing.sm },
          ]}
        >
          No Regrets
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center' },
  // Raport 1183:735 ≈ 1.61 → lățime 240, înălțime 150.
  logo: { width: 240, height: 150 },
});
