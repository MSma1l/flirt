/**
 * Verificare facială (TZ secț. 2.2): ecran modal care explică pasul de
 * verificare prin selfie, arată un placeholder de „cameră" și declanșează
 * verificarea la backend. Captura reală se activează ulterior cu expo-camera.
 */
import { useMutation } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { FaceVerification, verifyFace } from '@/features/verification/faceApi';
import { useTheme } from '@theme/index';

export default function VerifyFaceScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();

  const mutation = useMutation<FaceVerification>({
    mutationFn: verifyFace,
  });

  const succeeded = mutation.isSuccess && mutation.data.verified;
  const failed = mutation.isError || (mutation.isSuccess && !mutation.data.verified);

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header: titlu + buton de închidere. */}
      <View style={[styles.header, { marginBottom: spacing.xl }]}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Verificare</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Închide"
          onPress={() => router.back()}
          hitSlop={12}
        >
          <Text style={[typography.h2, { color: colors.textSecondary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.xl }]}>
        Confirmă că profilul îți aparține printr-un selfie rapid. Verificarea îți aduce un badge de
        încredere și îi ajută pe ceilalți să știe că ești o persoană reală.
      </Text>

      {/* Placeholder de „cameră" — dreptunghi stilizat cu emoji selfie. */}
      <View
        testID="camera-placeholder"
        style={[
          styles.camera,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.card,
            marginBottom: spacing.lg,
          },
        ]}
      >
        <Text style={styles.cameraEmoji}>🤳</Text>
        <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          Poziționează-ți fața în cadru
        </Text>
      </View>

      {/* Badge de rezultat (verde la succes / roșu la eșec). */}
      {succeeded && (
        <View
          testID="verify-success"
          style={[
            styles.badge,
            {
              backgroundColor: colors.tagBg,
              borderRadius: radius.pill,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.success }]}>Cont verificat ✓</Text>
        </View>
      )}

      {failed && (
        <View
          testID="verify-error"
          style={[
            styles.badge,
            {
              backgroundColor: colors.surfaceHover,
              borderRadius: radius.pill,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>
            Verificare eșuată, reîncearcă
          </Text>
        </View>
      )}

      <Button
        testID="verify-button"
        label="Fă un selfie și verifică"
        loading={mutation.isPending}
        onPress={() => mutation.mutate()}
      />

      <Text
        style={[
          typography.caption,
          styles.note,
          { color: colors.textSecondary, marginTop: spacing.lg },
        ]}
      >
        Captura reală a selfie-ului se activează cu camera (expo-camera).
      </Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  camera: {
    aspectRatio: 1,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraEmoji: { fontSize: 72, lineHeight: 84 },
  badge: { alignSelf: 'center', alignItems: 'center' },
  note: { textAlign: 'center' },
});
