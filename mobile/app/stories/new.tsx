/**
 * Publicare story nou (TZ secț. 11), stil Instagram/Snapchat:
 *  - se deschide DIRECT pe camera LIVE (selfie), cu buton mare de captură, flip
 *    și acces la galerie — vezi `StoryCameraScreen`. Merge și pe web (getUserMedia);
 *  - după captură SAU alegere din galerie se trece la COMPUNERE: previzualizarea
 *    pozei + descriere opțională + „Publică" (ori „Refă");
 *  - poza e urcată prin `POST /stories/media`, apoi povestea se creează cu
 *    `createStory`. Progres + erori în română, prin helperul de dialog.
 *
 * Un story e DOAR o poză — nu există filmare/alegere de video. Motivul: Apple
 * Guideline 1.2 cere filtrarea automată a conținutului obiecționabil, iar noi putem
 * modera NSFW doar pozele (`photo_moderation` în backend); un clip ar intra
 * nemoderat. Backend-ul refuză oricum orice upload de video cu 422.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { StoryCameraScreen } from '@/features/stories/StoryCameraScreen';
import { StoryMedia } from '@/features/stories/StoryMedia';
import {
  createStory,
  StoryMediaFile,
  uploadStoryMedia,
} from '@/features/stories/storiesApi';
import { STORY_MESSAGES } from '@/features/stories/storyLimits';
import { openAppSettings, pickStoryMedia } from '@/features/stories/storyPicker';
import { alertMessage, confirmAsync } from '@/utils/dialog';
import { firstError, LIMITS, maxLen, noHtml } from '@/utils/validation';
import { useTheme } from '@theme/index';

export default function NewStoryScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [media, setMedia] = useState<StoryMediaFile | null>(null);
  const [caption, setCaption] = useState('');
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

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

  /** Poza capturată live → trecem la compunere. */
  const onCaptured = useCallback((file: StoryMediaFile) => {
    setError(null);
    setMedia(file);
  }, []);

  /** Alege poza din galerie (doar imagini). */
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
      // Suntem încă pe cameră (fără cutie de eroare) → mesaj clar prin dialog.
      alertMessage('Poză respinsă', res.message);
    }
  }, [handleDenied, mutation]);

  /** Renunță la media aleasă și revine la cameră. */
  const onRetake = useCallback(() => {
    setError(null);
    setCaptionError(null);
    mutation.reset();
    setMedia(null);
  }, [mutation]);

  const submit = useCallback(() => {
    // Descrierea e opțională: ≤500 caractere + fără marcaje HTML.
    const capErr = firstError(maxLen(caption, LIMITS.caption), noHtml(caption));
    setCaptionError(capErr);
    if (capErr || !media) return;
    mutation.mutate();
  }, [caption, media, mutation]);

  const uploading = mutation.isPending;

  // --- Fără media încă: camera LIVE (Instagram/Snapchat) --------------------
  if (!media) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <StoryCameraScreen
          onCaptured={onCaptured}
          onPickGallery={() => void onPickGallery()}
          onClose={() => router.back()}
        />
      </>
    );
  }

  // --- Compunere: previzualizare + descriere + publică ----------------------
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
        Verifică poza, adaugă un text și publică.
      </Text>

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

      {error ? (
        <View
          testID="story-error"
          style={[styles.errorBox, { backgroundColor: colors.surfaceHover, borderRadius: radius.card, padding: spacing.sm, marginBottom: spacing.lg }]}
        >
          <Text style={[typography.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
        </View>
      ) : null}

      <View style={{ gap: spacing.md }}>
        <Button
          label="Refă"
          variant="outline"
          onPress={onRetake}
          disabled={uploading}
          testID="story-retake"
        />

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
  overlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(13,13,15,0.55)' },
  errorBox: { alignItems: 'center' },
});
