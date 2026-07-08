/** Ecran de întâmpinare: logo FLIRT + slogan + acțiuni cont nou / autentificare / social / telefon. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { getAppleIdToken, getGoogleIdToken } from '@/features/auth/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

export default function Welcome() {
  const router = useRouter();
  const loginWithProvider = useAuthStore((s) => s.loginWithProvider);
  const { colors, typography, spacing } = useTheme();

  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSocial = async (provider: 'google' | 'apple') => {
    setError(null);
    setLoadingProvider(provider);
    try {
      const idToken =
        provider === 'google' ? await getGoogleIdToken() : await getAppleIdToken();
      await loginWithProvider(provider, idToken);
      // La succes, guard-ul de auth din _layout redirecționează.
    } catch {
      setError('Autentificarea nu a reușit. Încearcă din nou.');
    } finally {
      setLoadingProvider(null);
    }
  };

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

        <Button
          label="Continuă cu Google"
          variant="outline"
          onPress={() => onSocial('google')}
          loading={loadingProvider === 'google'}
          disabled={loadingProvider !== null}
          testID="welcome-google"
        />
        <Button
          label="Continuă cu Apple"
          variant="outline"
          onPress={() => onSocial('apple')}
          loading={loadingProvider === 'apple'}
          disabled={loadingProvider !== null}
          testID="welcome-apple"
        />
        <Button
          label="Continuă cu telefonul"
          variant="outline"
          onPress={() => router.push('/(auth)/phone')}
          disabled={loadingProvider !== null}
          testID="welcome-phone"
        />

        {error ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
