/**
 * Ecran de înregistrare: email + parolă + confirmare + acceptarea Termenilor
 * și a Politicii de confidențialitate (obligatorie — App Store Guideline 1.2:
 * acordul explicit cu politica de toleranță zero față de conținutul abuziv).
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input, LanguageSwitcher, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import { useAuthStore } from '@/store/authStore';
import {
  AuthValidationKey,
  MIN_PASSWORD_LENGTH,
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '@/features/auth/validation';
import { useTheme } from '@theme/index';

/**
 * Cheile de eroare ale ecranului, ca uniune literală: `t()` e tipizat pe
 * cataloagele reale, deci o cheie greșită pică la `tsc`, nu pe ecran.
 */
type RegisterErrorKey = 'register.errors.openDocument' | 'register.errors.failed';

export default function Register() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const { colors, typography, radius, spacing } = useTheme();
  const { t } = useTranslation('auth');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [emailError, setEmailError] = useState<AuthValidationKey | null>(null);
  const [passwordError, setPasswordError] = useState<AuthValidationKey | null>(null);
  const [confirmError, setConfirmError] = useState<AuthValidationKey | null>(null);
  // Ținem CHEIA erorii, nu textul: dacă userul comută limba cu eroarea pe ecran,
  // mesajul se re-traduce la randare în loc să rămână în limba veche.
  const [formErrorKey, setFormErrorKey] = useState<RegisterErrorKey | null>(null);
  const [loading, setLoading] = useState(false);

  /** Deschide un document legal în browser (URL-uri din config, nu hardcodate). */
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      setFormErrorKey('register.errors.openDocument');
    });
  };


  /**
   * Traduce o cheie de eroare de validare. `min` e dat mereu: cheile care nu-l
   * folosesc îl ignoră, iar pragul rămâne într-un singur loc, în cod.
   */
  const tValidation = (key: AuthValidationKey | null) =>
    key ? t(key, { min: MIN_PASSWORD_LENGTH }) : null;

  const onSubmit = async () => {
    // Fără acceptarea termenilor nu se creează cont (butonul e oricum blocat).
    if (!accepted) return;

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const cErr = validatePasswordMatch(password, confirm);
    setEmailError(eErr);
    setPasswordError(pErr);
    setConfirmError(cErr);
    setFormErrorKey(null);
    if (eErr || pErr || cErr) return;

    setLoading(true);
    try {
      await register(email.trim(), password);
      // Statusul devine 'authenticated' → revenim la index pentru redirect (onboarding).
      router.replace('/');
    } catch {
      setFormErrorKey('register.errors.failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <LanguageSwitcher style={{ marginBottom: spacing.lg }} />

      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>
          {t('register.title')}
        </Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {t('register.subtitle')}
        </Text>
      </View>

      <View style={{ gap: spacing.lg }}>
        <Input
          label={t('register.emailLabel')}
          value={email}
          onChangeText={setEmail}
          error={tValidation(emailError)}
          placeholder={t('register.emailPlaceholder')}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          testID="register-email"
        />
        <Input
          label={t('register.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          error={tValidation(passwordError)}
          placeholder={t('register.passwordPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
          testID="register-password"
        />
        <Input
          label={t('register.confirmLabel')}
          value={confirm}
          onChangeText={setConfirm}
          error={tValidation(confirmError)}
          placeholder={t('register.confirmPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
          testID="register-confirm"
        />

        {/* Acord obligatoriu: termeni + confidențialitate + toleranță zero. */}
        <Pressable
          testID="register-terms"
          accessibilityRole="checkbox"
          accessibilityLabel={t('register.termsA11y')}
          accessibilityState={{ checked: accepted }}
          onPress={() => setAccepted((v) => !v)}
          style={[styles.termsRow, { gap: spacing.md }]}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderRadius: radius.sm,
                borderColor: accepted ? colors.accent : colors.border,
                backgroundColor: accepted ? colors.accent : 'transparent',
              },
            ]}
          >
            {accepted ? (
              <Text style={[typography.badge, { color: colors.onAccent }]}>✓</Text>
            ) : null}
          </View>

          {/* Spart în bucăți (prefix / link / „și" / link / rest) pentru că două
              dintre ele sunt apăsabile. Fiecare bucată e o cheie separată, deci
              traducătorul poate schimba topica frazei fără să atingă JSX-ul. */}
          <Text style={[typography.caption, styles.flex1, { color: colors.textSecondary }]}>
            {t('register.terms.prefix')}{' '}
            <Text
              testID="register-terms-link"
              style={{ color: colors.link }}
              onPress={() => openLink(config.legal.termsUrl)}
            >
              {t('register.terms.terms')}
            </Text>{' '}
            {t('register.terms.and')}{' '}
            <Text
              testID="register-privacy-link"
              style={{ color: colors.link }}
              onPress={() => openLink(config.legal.privacyUrl)}
            >
              {t('register.terms.privacy')}
            </Text>
            {t('register.terms.suffix')}
          </Text>
        </Pressable>

        {formErrorKey ? (
          <Text style={[typography.caption, { color: colors.danger }]}>
            {t(formErrorKey)}
          </Text>
        ) : null}

        <Button
          label={t('register.submit')}
          onPress={onSubmit}
          loading={loading}
          disabled={!accepted}
          testID="register-submit"
        />
        <Button
          label={t('register.goToLogin')}
          variant="ghost"
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  termsRow: { flexDirection: 'row', alignItems: 'flex-start' },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  flex1: { flex: 1 },
});
