/** Ecran de întâmpinare: logo FLIRT + slogan + acțiuni cont nou / autentificare / social / telefon. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import { getAppleIdToken, getGoogleIdToken } from '@/features/auth/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

export default function Welcome() {
  const router = useRouter();
  const loginWithProvider = useAuthStore((s) => s.loginWithProvider);
  const { colors, typography, spacing } = useTheme();

  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Deschide un document legal în browser (URL-uri din config, nu hardcodate). */
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      setError('Nu am putut deschide documentul. Încearcă din nou.');
    });
  };

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

        {/* Autentificarea socială / prin telefon creează cont fără a trece prin
            ecranul de înregistrare — acordul trebuie prezentat și aici. */}
        <Text
          testID="welcome-legal"
          style={[
            typography.caption,
            styles.legal,
            { color: colors.textSecondary, marginTop: spacing.sm },
          ]}
        >
          Continuând, accepți{' '}
          <Text
            testID="welcome-terms-link"
            style={{ color: colors.link }}
            onPress={() => openLink(config.legal.termsUrl)}
          >
            Termenii și condițiile
          </Text>{' '}
          și{' '}
          <Text
            testID="welcome-privacy-link"
            style={{ color: colors.link }}
            onPress={() => openLink(config.legal.privacyUrl)}
          >
            Politica de confidențialitate
          </Text>
          . FLIRT are toleranță zero față de conținutul abuziv.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  legal: { textAlign: 'center' },
});
