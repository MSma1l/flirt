/** Ecran de înregistrare: email + parolă + confirmare → authStore.register(). */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
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
  const { colors, typography, spacing } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
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

        {formError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
        ) : null}

        <Button
          label="Creează cont"
          onPress={onSubmit}
          loading={loading}
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
