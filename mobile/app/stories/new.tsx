/**
 * Publicare story nou (TZ secț. 11), stil Instagram:
 *  - alege o poză SAU un clip din galerie (`expo-image-picker`, imagini + video);
 *  - SAU filmează cu camera selfie (`expo-camera`) — DOAR nativ (pe web butonul e
 *    ascuns cu un mesaj clar; alegerea din galerie rămâne disponibilă);
 *  - media aleasă e urcată prin `POST /stories/media`, apoi se creează povestea cu
 *    `media_url` + `media_type`. Progres + erori în română, prin helperul de dialog.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { StoryMedia } from '@/features/stories/StoryMedia';
import {
  createStory,
  StoryMediaFile,
  uploadStoryMedia,
} from '@/features/stories/storiesApi';
import { recordStoryVideo } from '@/features/stories/storyCamera';
import { STORY_MESSAGES, STORY_VIDEO_MAX_SECONDS } from '@/features/stories/storyLimits';
import { openAppSettings, pickStoryMedia } from '@/features/stories/storyPicker';
import { alertMessage, confirmAsync } from '@/utils/dialog';
import { firstError, LIMITS, maxLen, noHtml } from '@/utils/validation';
import { useTheme } from '@theme/index';

/** Pe web nu filmăm cu camera (ca la selfie-ul de verificare) — doar galerie. */
const CAN_RECORD = Platform.OS !== 'web';

export default function NewStoryScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [media, setMedia] = useState<StoryMediaFile | null>(null);
  const [caption, setCaption] = useState('');
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Camera de filmare (nativ). Permisiunile de cameră + microfon sunt necesare.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();

  const mutation = useMutation({
    mutationFn: async () => {
      if (!media) throw new Error(STORY_MESSAGES.uploadFailed);
      setProgress(0);
      const uploaded = await uploadStoryMedia(media, setProgress);
      return createStory(uploaded.mediaUrl, uploaded.mediaType, caption.trim() || undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      router.back();
    },
    onError: () => setError(STORY_MESSAGES.createFailed),
  });

  /** Tratează refuzul de permisiune: mesaj + cale spre Setări dacă e blocat definitiv. */
  const handleDenied = useCallback(
    async (canAskAgain: boolean, blockedMsg: string, deniedMsg: string) => {
      if (canAskAgain) {
        alertMessage('Permisiune necesară', deniedMsg);
        return;
      }
      const go = await confirmAsync('Permisiune necesară', blockedMsg, {
        confirmText: 'Deschide setările',
      });
      if (go) await openAppSettings();
    },
    [],
  );

  /** Alege media din galerie (imagine sau video). */
  const onPickGallery = useCallback(async () => {
    setError(null);
    mutation.reset();
    const res = await pickStoryMedia();
    if (res.status === 'picked') {
      setMedia(res.file);
    } else if (res.status === 'denied') {
      await handleDenied(
        res.canAskAgain,
        STORY_MESSAGES.permissionBlocked,
        STORY_MESSAGES.permissionDenied,
      );
    } else if (res.status === 'rejected') {
      setError(res.message);
    }
  }, [handleDenied, mutation]);

  /** Deschide camera de filmare, cerând permisiunile de cameră + microfon. */
  const onOpenCamera = useCallback(async () => {
    setError(null);
    mutation.reset();
    const cam = camPerm?.granted ? camPerm : await requestCamPerm();
    const mic = micPerm?.granted ? micPerm : await requestMicPerm();
    if (cam?.granted && mic?.granted) {
      setCameraOpen(true);
      return;
    }
    const blocked = (cam && !cam.granted && !cam.canAskAgain) || (mic && !mic.granted && !mic.canAskAgain);
    await handleDenied(
      !blocked,
      STORY_MESSAGES.cameraPermissionBlocked,
      STORY_MESSAGES.cameraPermission,
    );
  }, [camPerm, micPerm, requestCamPerm, requestMicPerm, handleDenied]);

  /** Pornește înregistrarea; se rezolvă la stop sau la atingerea duratei maxime. */
  const onStartRecording = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam) return;
    setRecording(true);
    const res = await recordStoryVideo(cam, STORY_VIDEO_MAX_SECONDS);
    setRecording(false);
    setCameraOpen(false);
    if (res.status === 'recorded') {
      setMedia(res.file);
    } else {
      setError(res.message);
    }
  }, []);

  const onStopRecording = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const submit = useCallback(() => {
    // Descrierea e opțională: ≤500 caractere + fără marcaje HTML.
    const capErr = firstError(maxLen(caption, LIMITS.caption), noHtml(caption));
    setCaptionError(capErr);
    if (capErr || !media) return;
    mutation.mutate();
  }, [caption, media, mutation]);

  // --- Ecranul de cameră (nativ) --------------------------------------------
  if (cameraOpen) {
    return (
      <SafeAreaView style={[styles.cameraScreen, { backgroundColor: '#000' }]} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <CameraView
          testID="story-camera"
          ref={cameraRef}
          facing="front"
          mode="video"
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.cameraTop, { padding: spacing.lg }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Închide camera"
            onPress={() => {
              onStopRecording();
              setCameraOpen(false);
            }}
            hitSlop={spacing.sm}
          >
            <Text style={[typography.h2, { color: '#fff' }]}>✕</Text>
          </Pressable>
        </View>
        <View style={[styles.cameraBottom, { padding: spacing.xl }]}>
          {recording ? (
            <Button testID="story-stop" label="Stop" onPress={onStopRecording} />
          ) : (
            <Button testID="story-record" label="Filmează" onPress={() => void onStartRecording()} />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const uploading = mutation.isPending;

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Story nou</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Închide"
          onPress={() => router.back()}
          hitSlop={spacing.sm}
        >
          <Text style={[typography.h2, { color: colors.textPrimary }]}>✕</Text>
        </Pressable>
      </View>

      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.sm, marginBottom: spacing.lg }]}>
        Alege o poză sau un clip din galerie{CAN_RECORD ? ' ori filmează pe loc' : ''}.
      </Text>

      {/* Previzualizarea media alese */}
      {media ? (
        <View
          testID="story-preview"
          style={[
            styles.preview,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, marginBottom: spacing.lg },
          ]}
        >
          <StoryMedia
            uri={media.uri}
            mediaType={media.mediaType}
            style={[styles.previewFill, { borderRadius: radius.card }]}
            hintColor={colors.textSecondary}
          />
          {uploading ? (
            <View testID="story-uploading" style={[styles.previewFill, styles.overlay]}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={[typography.caption, { color: '#fff', marginTop: spacing.sm }]}>
                {Math.round(progress * 100)}%
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View
          testID="story-empty"
          style={[
            styles.preview,
            styles.emptyBox,
            { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.card, marginBottom: spacing.lg },
          ]}
        >
          <Text style={styles.emptyEmoji}>🖼️</Text>
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.lg }]}>
            Nimic ales încă.
          </Text>
        </View>
      )}

      {error ? (
        <View
          testID="story-error"
          style={[styles.errorBox, { backgroundColor: colors.surfaceHover, borderRadius: radius.card, padding: spacing.sm, marginBottom: spacing.lg }]}
        >
          <Text style={[typography.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        {/* Butoanele de sursă */}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button
              label={media ? 'Schimbă' : 'Din galerie'}
              variant="outline"
              onPress={() => void onPickGallery()}
              disabled={uploading}
              testID="story-pick"
            />
          </View>
          {CAN_RECORD ? (
            <View style={{ flex: 1 }}>
              <Button
                label="Filmează"
                variant="outline"
                onPress={() => void onOpenCamera()}
                disabled={uploading}
                testID="story-open-camera"
              />
            </View>
          ) : null}
        </View>

        {!CAN_RECORD ? (
          <Text testID="story-web-note" style={[typography.caption, { color: colors.textSecondary }]}>
            Filmarea cu camera e disponibilă în aplicația de telefon. Pe web poți alege din galerie.
          </Text>
        ) : null}

        <Input
          label="Descriere (opțional)"
          placeholder="Adaugă un text…"
          value={caption}
          onChangeText={setCaption}
          error={captionError}
          maxLength={LIMITS.caption}
          testID="story-caption"
        />

        <Button
          label="Publică"
          loading={uploading}
          onPress={submit}
          disabled={!media}
          testID="story-submit"
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  preview: { aspectRatio: 1, borderWidth: 2, overflow: 'hidden' },
  previewFill: { ...StyleSheet.absoluteFillObject },
  emptyBox: { borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  emptyEmoji: { fontSize: 56, lineHeight: 66 },
  overlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,13,15,0.55)' },
  errorBox: { alignItems: 'center' },
  cameraScreen: { flex: 1 },
  cameraTop: { flexDirection: 'row', justifyContent: 'flex-end' },
  cameraBottom: { marginTop: 'auto', alignItems: 'center' },
});
