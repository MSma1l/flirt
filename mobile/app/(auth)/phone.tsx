/** Autentificare prin telefon în 2 pași: (1) telefon → OTP, (2) cod OTP → sesiune. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

// Telefon: cifre, opțional prefix „+", spații / cratime / paranteze permise.
const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;

/**
 * Cheile de eroare, ca uniuni literale, nu ca `string`: `t()` e tipizat pe
 * cataloagele reale (vezi `i18n-types.d.ts`), deci o cheie scrisă greșit sau
 * ștearsă din JSON pică la `tsc`, nu pe ecran.
 */
type PhoneFieldErrorKey = 'phone.errors.phoneRequired' | 'phone.errors.phoneInvalid';
type CodeFieldErrorKey = 'phone.errors.codeRequired' | 'phone.errors.codeInvalid';
type PhoneFormErrorKey = 'phone.errors.sendFailed' | 'phone.errors.wrongCode';

/**
 * CHEIA mesajului de eroare sau `null` dacă telefonul e non-gol și plauzibil.
 *
 * Validatoarele întorc chei, nu texte: sunt funcții pure, în afara componentei,
 * unde `t` nu există — iar eroarea ținută în state se re-traduce singură dacă
 * userul comută limba cu ea pe ecran.
 */
function validatePhone(value: string): PhoneFieldErrorKey | null {
  const v = value.trim();
  if (!v) return 'phone.errors.phoneRequired';
  if (!PHONE_RE.test(v)) return 'phone.errors.phoneInvalid';
  return null;
}

/** CHEIA mesajului de eroare sau `null` dacă codul are exact 6 cifre. */
function validateCode(value: string): CodeFieldErrorKey | null {
  const v = value.trim();
  if (!v) return 'phone.errors.codeRequired';
  if (!/^\d{6}$/.test(v)) return 'phone.errors.codeInvalid';
  return null;
}

type Step = 'phone' | 'code';

export default function Phone() {
  const router = useRouter();
  const requestPhoneOtp = useAuthStore((s) => s.requestPhoneOtp);
  const verifyPhoneOtp = useAuthStore((s) => s.verifyPhoneOtp);
  const { colors, typography, spacing } = useTheme();
  // Namespace-ul zonei + `common` pentru butoanele generice („Confirmă", „Înapoi"),
  // pe care nu le duplicăm în `auth`.
  const { t } = useTranslation(['auth', 'common']);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneErrorKey, setPhoneErrorKey] = useState<PhoneFieldErrorKey | null>(null);
  const [codeErrorKey, setCodeErrorKey] = useState<CodeFieldErrorKey | null>(null);
  const [formErrorKey, setFormErrorKey] = useState<PhoneFormErrorKey | null>(null);
  const [loading, setLoading] = useState(false);

  const onRequest = async () => {
    const err = validatePhone(phone);
    setPhoneErrorKey(err);
    setFormErrorKey(null);
    if (err) return;

    setLoading(true);
    try {
      await requestPhoneOtp(phone.trim());
      setCode('');
      setCodeErrorKey(null);
      setStep('code');
    } catch {
      setFormErrorKey('phone.errors.sendFailed');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    const err = validateCode(code);
    setCodeErrorKey(err);
    setFormErrorKey(null);
    if (err) return;

    setLoading(true);
    try {
      await verifyPhoneOtp(phone.trim(), code.trim());
      // La succes, guard-ul de auth din _layout redirecționează.
    } catch {
      setFormErrorKey('phone.errors.wrongCode');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>
          {step === 'phone' ? t('phone.requestTitle') : t('phone.verifyTitle')}
        </Text>
        <Text
          style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}
        >
          {step === 'phone'
            ? t('phone.requestSubtitle')
            : t('phone.verifySubtitle', { phone: phone.trim() })}
        </Text>
      </View>

      {step === 'phone' ? (
        <View style={{ gap: spacing.lg }}>
          <Input
            label={t('phone.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            error={phoneErrorKey ? t(phoneErrorKey) : null}
            placeholder={t('phone.phonePlaceholder')}
            keyboardType="phone-pad"
            autoComplete="tel"
            testID="phone-input"
          />

          {formErrorKey ? (
            <Text style={[typography.caption, { color: colors.danger }]}>
              {t(formErrorKey)}
            </Text>
          ) : null}

          <Button
            label={t('phone.send')}
            onPress={onRequest}
            loading={loading}
            testID="phone-request"
          />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Input
            label={t('phone.codeLabel')}
            value={code}
            onChangeText={setCode}
            error={codeErrorKey ? t(codeErrorKey) : null}
            placeholder={t('phone.codePlaceholder')}
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            testID="phone-code"
          />

          {formErrorKey ? (
            <Text style={[typography.caption, { color: colors.danger }]}>
              {t(formErrorKey)}
            </Text>
          ) : null}

          <Button
            label={t('common:actions.confirm')}
            onPress={onVerify}
            loading={loading}
            testID="phone-verify"
          />
          <Button
            label={t('phone.resend')}
            variant="ghost"
            onPress={onRequest}
            disabled={loading}
            testID="phone-resend"
          />
          <Button
            label={t('common:actions.back')}
            variant="ghost"
            onPress={() => {
              setStep('phone');
              setFormErrorKey(null);
            }}
            disabled={loading}
            testID="phone-back"
          />

          {/* Notă vizibilă DOAR în build-urile de dezvoltare — niciodată în producție
              (App Store Guideline 2.1: fără texte de dev în UI). */}
          {__DEV__ ? (
            <Text
              testID="phone-dev-hint"
              style={[typography.caption, { color: colors.textDisabled }]}
            >
              {t('phone.devHint')}
            </Text>
          ) : null}
        </View>
      )}
    </ScreenContainer>
  );
}
