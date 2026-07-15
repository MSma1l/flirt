/** Ecran de întâmpinare: logo FLIRT + slogan + acțiuni cont nou / autentificare / social / telefon. */
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import {
  getAppleIdToken,
  getAvailableSocialProviders,
  getGoogleIdToken,
  isCanceled,
  SocialAuthError,
  SocialProviders,
} from '@/features/auth/socialAuth';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

/** Traduce orice eșec al fluxului social într-un mesaj pe care userul îl înțelege. */
function socialErrorMessage(error: unknown): string {
  if (error instanceof SocialAuthError) {
    switch (error.code) {
      case 'unavailable':
        return 'Autentificarea Apple nu e disponibilă pe acest dispozitiv.';
      case 'not_configured':
        return 'Autentificarea socială nu e disponibilă în această versiune.';
      case 'no_token':
        return 'Providerul nu a întors un token valid. Încearcă din nou.';
      default:
        return 'Autentificarea nu a reușit. Încearcă din nou.';
    }
  }

  // Eșecuri de la backend (`POST /auth/{provider}`): fără răspuns = rețea căzută,
  // 401 = token respins la verificarea JWKS. Le distingem, ca userul să știe dacă
  // are rost să reîncerce.
  if (isAxiosError(error)) {
    if (!error.response) {
      return 'Nu am putut contacta serverul. Verifică conexiunea la internet.';
    }
    if (error.response.status === 401) {
      return 'Contul nu a putut fi verificat. Încearcă din nou.';
    }
  }

  return 'Autentificarea nu a reușit. Încearcă din nou.';
}

export default function Welcome() {
  const router = useRouter();
  const loginWithProvider = useAuthStore((s) => s.loginWithProvider);
  const { colors, typography, spacing, radius } = useTheme();

  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Pornim cu ambele ascunse: disponibilitatea Apple se află abia după un apel
  // asincron, iar un buton care apare și dispare ar fi mai rău decât unul întârziat.
  const [providers, setProviders] = useState<SocialProviders>({
    google: false,
    apple: false,
  });

  useEffect(() => {
    let active = true;
    getAvailableSocialProviders()
      .then((available) => {
        if (active) setProviders(available);
      })
      .catch(() => {
        // Fără providere sociale ecranul rămâne complet funcțional (email + telefon).
      });
    return () => {
      active = false;
    };
  }, []);

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
    } catch (err) {
      // Anularea e o alegere a userului, nu o eroare: nu-i arătăm nimic roșu.
      if (!isCanceled(err)) setError(socialErrorMessage(err));
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

        {providers.google ? (
          <Button
            label="Continuă cu Google"
            variant="outline"
            onPress={() => onSocial('google')}
            loading={loadingProvider === 'google'}
            disabled={loadingProvider !== null}
            testID="welcome-google"
          />
        ) : null}

        {/* Butonul OFICIAL Apple: logo, text și paletă impuse de Apple (HIG).
            Un buton desenat de noi e motiv de respingere la review — de aceea e
            singurul din ecran care nu folosește componenta noastră `Button`.
            Păstrăm doar raza „pill" a design system-ului. */}
        {providers.apple ? (
          <AppleAuthentication.AppleAuthenticationButton
            testID="welcome-apple"
            buttonType={
              AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
            }
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={radius.pill}
            style={styles.appleButton}
            onPress={() => onSocial('apple')}
          />
        ) : null}

        <Button
          label="Continuă cu telefonul"
          variant="outline"
          onPress={() => router.push('/(auth)/phone')}
          disabled={loadingProvider !== null}
          testID="welcome-phone"
        />

        {error ? (
          <Text
            testID="welcome-social-error"
            style={[typography.caption, { color: colors.danger }]}
          >
            {error}
          </Text>
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
  // Înălțime egală cu a butoanelor noastre (paddingVertical 15 + text) ca stiva
  // de acțiuni să rămână aliniată vizual.
  appleButton: { height: 52, width: '100%' },
});
