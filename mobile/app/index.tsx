/**
 * Splash-ul aplicației — și „punctul de întoarcere" al navigării.
 *
 * NU mai decide nimic. Ecranul ăsta avea propriul redirect (auth → welcome,
 * profil incomplet → onboarding, altfel → feed), care știa doar de
 * `profile_completed`. `AuthGuard` știa în plus de testul de umor, dar ieșea
 * devreme tocmai pe ruta asta, ca să nu se calce cu ea. Rezultat: la cold-start
 * decidea cel neinformat, iar userul fără test de umor ajungea în feed, unde
 * serverul îi refuza fiecare swipe cu 403.
 *
 * Acum aici se AȘTEAPTĂ: login, register și quiz-ul trimit userul la `/`, iar
 * `AuthGuard` îl duce mai departe de îndată ce starea e cunoscută.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { useTheme } from '@theme/index';

export default function Index() {
  const { colors, typography, spacing } = useTheme();

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
