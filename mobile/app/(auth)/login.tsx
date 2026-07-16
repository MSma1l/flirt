/** Ecran de autentificare: email + parolă → authStore.login().
 *
 * ECRAN DE REFERINȚĂ pentru i18n — tiparul de copiat la migrarea altor ecrane:
 *  - `useTranslation('<namespace>')` o dată, sus în componentă;
 *  - chei ierarhice `ecran.element` în namespace-ul zonei (aici: `auth`);
 *  - texte generice (butoane, erori comune) din `common`, prin prefix explicit:
 *    `t('common:actions.cancel')`.
 * Vezi `src/i18n/README.md` pentru convenții, pluralizare și interpolare.
 */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { validateEmail, validatePassword } from '@/features/auth/validation';
import { useTheme } from '@theme/index';

export default function Login() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const { colors, typography, spacing } = useTheme();
  const { t } = useTranslation('auth');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    // NOTĂ: `validateEmail` / `validatePassword` întorc încă mesaje fixe, în
    // română. Stau în `src/features/auth/validation.ts`, partajat cu register și
    // phone, deci migrarea lor e o sarcină separată (vezi README, „Ce a rămas").
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    setEmailError(eErr);
    setPasswordError(pErr);
    setFormError(null);
    if (eErr || pErr) return;

    setLoading(true);
    try {
      await login(email.trim(), password);
      // Guard-ul din _layout preia redirect-ul; `replace('/')` e defensiv
      // (consistent cu register.tsx) pentru a nu rămâne blocat pe login.
      router.replace('/');
    } catch {
      setFormError(t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('login.title')}</Text>
        <Text
          style={[
            typography.body,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {t('login.subtitle')}
        </Text>
      </View>

      <View style={{ gap: spacing.lg }}>
        <Input
          label={t('login.emailLabel')}
          value={email}
          onChangeText={setEmail}
          error={emailError}
          placeholder={t('login.emailPlaceholder')}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          testID="login-email"
        />
        <Input
          label={t('login.passwordLabel')}
          value={password}
          onChangeText={setPassword}
          error={passwordError}
          placeholder={t('login.passwordPlaceholder')}
          secureTextEntry
          autoCapitalize="none"
          testID="login-password"
        />

        {formError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
        ) : null}

        <Button
          label={t('login.submit')}
          onPress={onSubmit}
          loading={loading}
          testID="login-submit"
        />
        <Button
          label={t('login.goToRegister')}
          variant="ghost"
          onPress={() => router.replace('/(auth)/register')}
        />
      </View>
    </ScreenContainer>
  );
}
