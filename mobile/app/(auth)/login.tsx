/** Ecran de autentificare: email + parolă → authStore.login(). */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { validateEmail, validatePassword } from '@/features/auth/validation';
import { useTheme } from '@theme/index';

export default function Login() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const { colors, typography, spacing } = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setEmailError(eErr);
    setPasswordError(pErr);
    setFormError(null);
    if (eErr || pErr) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
      // La succes, statusul devine 'authenticated' → index preia redirect-ul.
    } catch {
      setFormError('Email sau parolă incorecte. Încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Bine ai revenit</Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          Autentifică-te ca să continui.
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
          testID="login-email"
        />
        <Input
          label="Parolă"
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          placeholder="Parola ta"
          secureTextEntry
          autoCapitalize="none"
          testID="login-password"
        />

        {formError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
        ) : null}

        <Button
          label="Autentificare"
          onPress={onSubmit}
          loading={loading}
          testID="login-submit"
        />
        <Button
          label="Nu ai cont? Creează unul"
          variant="ghost"
          onPress={() => router.replace('/(auth)/register')}
        />
      </View>
    </ScreenContainer>
  );
}
