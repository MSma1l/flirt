/** Autentificare prin telefon în 2 pași: (1) telefon → OTP, (2) cod OTP → sesiune. */
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

// Telefon: cifre, opțional prefix „+", spații / cratime / paranteze permise.
const PHONE_RE = /^\+?[\d\s().-]{6,20}$/;

/** Mesaj de eroare sau `null` dacă telefonul este non-gol și are un format plauzibil. */
function validatePhone(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Introdu numărul de telefon.';
  if (!PHONE_RE.test(v)) return 'Numărul de telefon nu este valid.';
  return null;
}

/** Mesaj de eroare sau `null` dacă codul are exact 6 cifre. */
function validateCode(value: string): string | null {
  const v = value.trim();
  if (!v) return 'Introdu codul primit.';
  if (!/^\d{6}$/.test(v)) return 'Codul trebuie să aibă 6 cifre.';
  return null;
}

type Step = 'phone' | 'code';

export default function Phone() {
  const router = useRouter();
  const requestPhoneOtp = useAuthStore((s) => s.requestPhoneOtp);
  const verifyPhoneOtp = useAuthStore((s) => s.verifyPhoneOtp);
  const { colors, typography, spacing } = useTheme();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onRequest = async () => {
    const err = validatePhone(phone);
    setPhoneError(err);
    setFormError(null);
    if (err) return;

    setLoading(true);
    try {
      await requestPhoneOtp(phone.trim());
      setCode('');
      setCodeError(null);
      setStep('code');
    } catch {
      setFormError('Nu am putut trimite codul. Încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    const err = validateCode(code);
    setCodeError(err);
    setFormError(null);
    if (err) return;

    setLoading(true);
    try {
      await verifyPhoneOtp(phone.trim(), code.trim());
      // La succes, guard-ul de auth din _layout redirecționează.
    } catch {
      setFormError('Cod incorect. Verifică și încearcă din nou.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={{ marginBottom: spacing.xxl }}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>
          {step === 'phone' ? 'Intră cu telefonul' : 'Verifică numărul'}
        </Text>
        <Text
          style={[typography.body, { color: colors.textSecondary, marginTop: spacing.xs }]}
        >
          {step === 'phone'
            ? 'Îți trimitem un cod de verificare prin SMS.'
            : `Am trimis un cod la ${phone.trim()}.`}
        </Text>
      </View>

      {step === 'phone' ? (
        <View style={{ gap: spacing.lg }}>
          <Input
            label="Număr de telefon"
            value={phone}
            onChangeText={setPhone}
            error={phoneError}
            placeholder="+40 700 000 000"
            keyboardType="phone-pad"
            autoComplete="tel"
            testID="phone-input"
          />

          {formError ? (
            <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
          ) : null}

          <Button
            label="Trimite codul"
            onPress={onRequest}
            loading={loading}
            testID="phone-request"
          />
        </View>
      ) : (
        <View style={{ gap: spacing.lg }}>
          <Input
            label="Cod de verificare"
            value={code}
            onChangeText={setCode}
            error={codeError}
            placeholder="000000"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            testID="phone-code"
          />

          {formError ? (
            <Text style={[typography.caption, { color: colors.danger }]}>{formError}</Text>
          ) : null}

          <Button
            label="Confirmă"
            onPress={onVerify}
            loading={loading}
            testID="phone-verify"
          />
          <Button
            label="Retrimite cod"
            variant="ghost"
            onPress={onRequest}
            disabled={loading}
            testID="phone-resend"
          />
          <Button
            label="Înapoi"
            variant="ghost"
            onPress={() => {
              setStep('phone');
              setFormError(null);
            }}
            disabled={loading}
            testID="phone-back"
          />

          {/* Notă discretă pentru dezvoltare: backend-ul în mod stub acceptă acest cod. */}
          <Text style={[typography.caption, { color: colors.textDisabled }]}>
            În dev: cod de test 000000
          </Text>
        </View>
      )}
    </ScreenContainer>
  );
}
