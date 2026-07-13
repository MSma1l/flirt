/**
 * Ecran de înregistrare: email + parolă + confirmare + acceptarea Termenilor
 * și a Politicii de confidențialitate (obligatorie — App Store Guideline 1.2:
 * acordul explicit cu politica de toleranță zero față de conținutul abuziv).
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import { useAuthStore } from '@/store/authStore';
import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '@/features/auth/validation';
import { useTheme } from '@theme/index';

export default function Register() {
  const router = useRouter();
  const register = useAuthStore((s) => s.register);
  const { colors, typography, radius, spacing } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /** Deschide un document legal în browser (URL-uri din config, nu hardcodate). */
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      setFormError('Nu am putut deschide documentul. Încearcă din nou.');
    });
  };

  const onSubmit = async () => {
    // Fără acceptarea termenilor nu se creează cont (butonul e oricum blocat).
    if (!accepted) return;

    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const cErr = validatePasswordMatch(password, confirm);
    setEmailError(eErr);
    setPasswordError(pErr);
    setConfirmError(cErr);
    setFormError(null);
    if (eErr || pErr || cErr) return;

    setLoading(true);
    try {
      await register(email.trim(), password);
      // Statusul devine 'authenticated' → revenim la index pentru redirect (onboarding).
      router.replace('/');
    } catch {
      setFormError('Nu am putut crea contul. Poate emailul este deja folosit.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Creează cont</Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          Câțiva pași și ești gata.
        </Text>
      </View>

      <View style={{ gap: spacing.lg }}>
        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={emailError}
          placeholder="nume@exemplu.com"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          testID="register-email"
        />
        <Input
          label="Parolă"
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          placeholder="Cel puțin 8 caractere"
          secureTextEntry
          autoCapitalize="none"
          testID="register-password"
        />
        <Input
          label="Confirmă parola"
          value={confirm}
          onChangeText={setConfirm}
          error={confirmError}
          placeholder="Repetă parola"
          secureTextEntry
          autoCapitalize="none"
          testID="register-confirm"
        />

        {/* Acord obligatoriu: termeni + confidențialitate + toleranță zero. */}
        <Pressable
          testID="register-terms"
          accessibilityRole="checkbox"
          accessibilityLabel="Accept Termenii și Politica de confidențialitate"
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

          <Text style={[typography.caption, styles.flex1, { color: colors.textSecondary }]}>
            Am citit și accept{' '}
            <Text
              testID="register-terms-link"
              style={{ color: colors.link }}
              onPress={() => openLink(config.legal.termsUrl)}
            >
              Termenii și condițiile
            </Text>{' '}
            și{' '}
            <Text
              testID="register-privacy-link"
              style={{ color: colors.link }}
              onPress={() => openLink(config.legal.privacyUrl)}
            >
              Politica de confidențialitate
            </Text>
            . Înțeleg că FLIRT are toleranță zero față de conținutul abuziv și de
            comportamentul ofensator: astfel de conținut este eliminat, iar conturile
            responsabile sunt suspendate în cel mult 24 de ore de la raportare.
          </Text>
        </Pressable>

        {formError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
        ) : null}

        <Button
          label="Creează cont"
          onPress={onSubmit}
          loading={loading}
          disabled={!accepted}
          testID="register-submit"
        />
        <Button
          label="Ai deja cont? Autentifică-te"
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
