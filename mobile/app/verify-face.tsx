/**
 * Verificare facială (TZ secț. 2.2): ecran modal care explică pasul de verificare,
 * face un selfie REAL cu camera frontală și îl trimite la backend pentru comparare
 * cu pozele profilului (AWS Rekognition). Badge-ul „✓ Verificat" se câștigă doar
 * dacă serverul confirmă potrivirea — nimic nu e acordat local.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { LocalPhoto, openAppSettings } from '@/features/photos';
import {
  CAMERA_PERMISSION_BLOCKED_MESSAGE,
  CAMERA_PERMISSION_MESSAGE,
  captureSelfie,
  FACE_MESSAGES,
  FaceVerification,
  verifyFace,
} from '@/features/verification';
import { useTheme } from '@theme/index';

export default function VerifyFaceScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  /** Selfie-ul capturat (comprimat local), păstrat ca previzualizare la upload. */
  const [selfie, setSelfie] = useState<LocalPhoto | null>(null);
  /** Eroare apărută ÎNAINTE de rețea (captură eșuată, poză respinsă local). */
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const mutation = useMutation<FaceVerification, Error, LocalPhoto>({
    mutationFn: verifyFace,
    onSuccess: (result) => {
      // Badge-ul apare pe profil doar după ce serverul a persistat `verified`;
      // invalidăm cache-ul ca ecranul de profil să nu rămână cu starea veche.
      if (result.verified) {
        void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      }
    },
  });

  const succeeded = mutation.isSuccess && mutation.data.verified;
  const busy = capturing || mutation.isPending;

  /**
   * Mesajul de eșec, în ordinea în care lucrurile pot merge prost: local (captura),
   * apoi rețea/server (eroarea are deja mesaj tradus), apoi verdictul negativ.
   */
  const errorMessage =
    captureError ??
    (mutation.isError ? mutation.error.message : null) ??
    (mutation.isSuccess && !mutation.data.verified ? FACE_MESSAGES.no_match : null);

  const handleVerify = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return;

    setCaptureError(null);
    mutation.reset();
    setSelfie(null);
    setCapturing(true);

    const result = await captureSelfie(camera);
    setCapturing(false);

    if (result.status !== 'captured') {
      setCaptureError(result.message);
      return;
    }

    // Previzualizarea rămâne pe ecran cât ține uploadul: utilizatorul vede exact
    // ce s-a trimis, nu un dreptunghi gol cu un spinner.
    setSelfie(result.photo);
    mutation.mutate(result.photo);
  }, [mutation]);

  const handleRetry = useCallback(() => {
    setCaptureError(null);
    mutation.reset();
    setSelfie(null);
  }, [mutation]);

  const granted = permission?.granted === true;
  // `canAskAgain=false` → sistemul nu mai afișează dialogul; rămân doar Setările.
  const blocked = permission !== null && !permission.granted && !permission.canAskAgain;

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

      {/* Cadrul de captură: cameră live / previzualizarea selfie-ului / placeholder. */}
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
        {selfie ? (
          <Image
            testID="selfie-preview"
            source={{ uri: selfie.uri }}
            style={[styles.fill, { borderRadius: radius.card }]}
            resizeMode="cover"
          />
        ) : granted ? (
          <CameraView
            testID="camera-view"
            ref={cameraRef}
            // Verificarea are sens doar cu camera frontală: userul trebuie să se
            // vadă în cadru în timp ce se încadrează.
            facing="front"
            style={[styles.fill, { borderRadius: radius.card }]}
          />
        ) : (
          <>
            <Text style={styles.cameraEmoji}>🤳</Text>
            <Text
              testID="permission-notice"
              style={[
                typography.caption,
                styles.note,
                { color: colors.textSecondary, marginTop: spacing.sm, paddingHorizontal: spacing.lg },
              ]}
            >
              {permission === null
                ? 'Poziționează-ți fața în cadru'
                : blocked
                  ? CAMERA_PERMISSION_BLOCKED_MESSAGE
                  : CAMERA_PERMISSION_MESSAGE}
            </Text>
          </>
        )}

        {busy && (
          <View testID="verify-loading" style={[styles.fill, styles.overlay]}>
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        )}
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

      {errorMessage && (
        <View
          testID="verify-error"
          style={[
            styles.errorBox,
            {
              backgroundColor: colors.surfaceHover,
              borderRadius: radius.card,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.body, styles.note, { color: colors.danger }]}>
            {errorMessage}
          </Text>
        </View>
      )}

      {/* Acțiunea principală depinde de permisiune: fără ea nu există „ecran mort". */}
      {succeeded ? (
        <Button testID="done-button" label="Gata" onPress={() => router.back()} />
      ) : blocked ? (
        <Button
          testID="open-settings-button"
          label="Deschide setările"
          onPress={() => void openAppSettings()}
        />
      ) : !granted ? (
        <Button
          testID="grant-permission-button"
          label="Permite accesul la cameră"
          loading={permission === null}
          onPress={() => void requestPermission()}
        />
      ) : selfie && errorMessage ? (
        <Button testID="retry-button" label="Încearcă din nou" onPress={handleRetry} />
      ) : (
        <Button
          testID="verify-button"
          label="Fă un selfie și verifică"
          loading={busy}
          onPress={() => void handleVerify()}
        />
      )}

      <Text
        style={[
          typography.caption,
          styles.note,
          { color: colors.textSecondary, marginTop: spacing.lg },
        ]}
      >
        Selfie-ul este folosit doar pentru verificare și nu apare în profilul tău.
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
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFillObject },
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13, 13, 15, 0.55)',
  },
  cameraEmoji: { fontSize: 72, lineHeight: 84 },
  badge: { alignSelf: 'center', alignItems: 'center' },
  errorBox: { alignItems: 'center' },
  note: { textAlign: 'center' },
});
