/** Ecran de întâmpinare: logo FLIRT + slogan + acțiuni cont nou / autentificare / social.
 *
 * Contul se face pe EMAIL. Ruta `/(auth)/phone` și fluxul OTP din backend rămân în cod,
 * dar nu au nicio intrare din UI: fără Twilio n-ar avea cum să livreze codul, iar un buton
 * care duce la un ecran mort e mai rău decât lipsa lui. Dacă se reactivează telefonul,
 * se pune la loc butonul de aici — nimic altceva nu trebuie rescris.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { isAxiosError } from 'axios';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';

import { Button, LanguageSwitcher, ScreenContainer } from '@/components/ui';
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

/**
 * Cheile de eroare ale ecranului, ca uniune literală: `t()` e tipizat pe
 * cataloagele reale, deci o cheie greșită pică la `tsc`, nu pe ecran.
 */
type WelcomeErrorKey =
  | 'welcome.errors.openDocument'
  | 'welcome.errors.appleUnavailable'
  | 'welcome.errors.notConfigured'
  | 'welcome.errors.noToken'
  | 'welcome.errors.network'
  | 'welcome.errors.unverified'
  | 'welcome.errors.generic';

/**
 * Traduce orice eșec al fluxului social într-o CHEIE de mesaj, nu în text.
 *
 * Întoarcem cheia, nu textul deja tradus, ca mesajul din state să rămână corect
 * dacă userul comută limba cu eroarea pe ecran: traducerea se face la randare.
 */
function socialErrorKey(error: unknown): WelcomeErrorKey {
  if (error instanceof SocialAuthError) {
    switch (error.code) {
      case 'unavailable':
        return 'welcome.errors.appleUnavailable';
      case 'not_configured':
        return 'welcome.errors.notConfigured';
      case 'no_token':
        return 'welcome.errors.noToken';
      default:
        return 'welcome.errors.generic';
    }
  }

  // Eșecuri de la backend (`POST /auth/{provider}`): fără răspuns = rețea căzută,
  // 401 = token respins la verificarea JWKS. Le distingem, ca userul să știe dacă
  // are rost să reîncerce.
  if (isAxiosError(error)) {
    if (!error.response) {
      return 'welcome.errors.network';
    }
    if (error.response.status === 401) {
      return 'welcome.errors.unverified';
    }
  }

  return 'welcome.errors.generic';
}

export default function Welcome() {
  const router = useRouter();
  const loginWithProvider = useAuthStore((s) => s.loginWithProvider);
  const { colors, typography, spacing, radius } = useTheme();
  const { t } = useTranslation('auth');

  const [loadingProvider, setLoadingProvider] = useState<'google' | 'apple' | null>(null);
  const [errorKey, setErrorKey] = useState<WelcomeErrorKey | null>(null);
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
        // Fără providere sociale ecranul rămâne complet funcțional: email + parolă.
      });
    return () => {
      active = false;
    };
  }, []);

  /** Deschide un document legal în browser (URL-uri din config, nu hardcodate). */
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      setErrorKey('welcome.errors.openDocument');
    });
  };

  const onSocial = async (provider: 'google' | 'apple') => {
    setErrorKey(null);
    setLoadingProvider(provider);
    try {
      const idToken =
        provider === 'google' ? await getGoogleIdToken() : await getAppleIdToken();
      await loginWithProvider(provider, idToken);
      // La succes, guard-ul de auth din _layout redirecționează.
    } catch (err) {
      // Anularea e o alegere a userului, nu o eroare: nu-i arătăm nimic roșu.
      if (!isCanceled(err)) setErrorKey(socialErrorKey(err));
    } finally {
      setLoadingProvider(null);
    }
  };

  return (
    <ScreenContainer>
      {/* Primul ecran al aplicației: dacă limba dispozitivului nu e una dintre
          cele trei, userul aterizează în română și trebuie să poată comuta AICI,
          înainte de a citi orice buton. */}
      <LanguageSwitcher />

      <View style={styles.hero}>
        <Image
          testID="brand-logo"
          accessibilityLabel="FLIRT"
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        {/* „No Regrets" e semnătura mărcii, parte din logo-lockup — nu copy de
            interfață. Nu se traduce, exact ca numele „FLIRT". */}
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
        <Button
          label={t('welcome.createAccount')}
          onPress={() => router.push('/(auth)/register')}
        />
        <Button
          label={t('welcome.haveAccount')}
          variant="outline"
          onPress={() => router.push('/(auth)/login')}
        />

        {providers.google ? (
          <Button
            label={t('welcome.google')}
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

        {errorKey ? (
          <Text
            testID="welcome-social-error"
            style={[typography.caption, { color: colors.danger }]}
          >
            {t(errorKey)}
          </Text>
        ) : null}

        {/* Autentificarea socială creează cont fără a trece prin ecranul de
            înregistrare — acordul trebuie prezentat și aici.

            Textul e spart în bucăți (prefix / link / „și" / link / rest) pentru că
            două dintre ele sunt apăsabile. Fiecare bucată e o cheie separată, deci
            traducătorul poate schimba topica frazei fără să atingă JSX-ul. */}
        <Text
          testID="welcome-legal"
          style={[
            typography.caption,
            styles.legal,
            { color: colors.textSecondary, marginTop: spacing.sm },
          ]}
        >
          {t('welcome.legal.prefix')}{' '}
          <Text
            testID="welcome-terms-link"
            style={{ color: colors.link }}
            onPress={() => openLink(config.legal.termsUrl)}
          >
            {t('welcome.legal.terms')}
          </Text>{' '}
          {t('welcome.legal.and')}{' '}
          <Text
            testID="welcome-privacy-link"
            style={{ color: colors.link }}
            onPress={() => openLink(config.legal.privacyUrl)}
          >
            {t('welcome.legal.privacy')}
          </Text>
          {t('welcome.legal.suffix')}
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // Raport 1183:735 ≈ 1.61 → lățime 240, înălțime 150.
  logo: { width: 240, height: 150 },
  legal: { textAlign: 'center' },
  // Înălțime egală cu a butoanelor noastre (paddingVertical 15 + text) ca stiva
  // de acțiuni să rămână aliniată vizual.
  appleButton: { height: 52, width: '100%' },
});
