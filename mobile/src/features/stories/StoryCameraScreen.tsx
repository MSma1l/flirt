/**
 * Cameră LIVE pentru un story, stil Instagram/Snapchat (TZ secț. 11).
 *
 *  - previzualizare pe tot ecranul cu `CameraView` din `expo-camera`, cameră
 *    frontală (selfie) implicit;
 *  - buton mare, rotund, de captură (jos-centru) → poză (`takePictureAsync`);
 *  - comutare cameră frontală ↔ spate (flip) și acces la galerie (jos-stânga);
 *  - permisiunea de cameră e cerută corect; refuzul NU lasă ecran mort: arătăm
 *    mesaj + „Permite acces" / „Deschide setările" + alegerea din galerie;
 *  - pe WEB funcționează prin getUserMedia; dacă browserul chiar nu dă camera,
 *    degradează elegant la galerie, fără crash.
 *
 * Un story e DOAR o poză: nu există mod Video / filmare. Motivul e Apple Guideline
 * 1.2 — conținutul încărcat trebuie filtrat automat, iar noi putem modera NSFW doar
 * pozele (`photo_moderation` în backend); un clip ar intra nemoderat. Nu repune
 * filmarea aici fără moderare de video: backend-ul o refuză oricum cu 422.
 * Așa că nu cerem nici microfon.
 *
 * Captura efectivă stă în `storyCamera.ts` — aici e doar interfața.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { StoryMediaFile } from '@/features/stories/storiesApi';
import { captureStoryPhoto } from '@/features/stories/storyCamera';
import { STORY_MESSAGES } from '@/features/stories/storyLimits';
import { openAppSettings } from '@/features/stories/storyPicker';
import { useTheme } from '@theme/index';

/** Fundal întunecat, imersiv — camera arată la fel indiferent de tema aplicației. */
const CAMERA_BG = '#0D0D0F';
const ON_DARK = '#FFFFFF';

interface Props {
  /** Poza capturată, gata de compunere/upload. */
  onCaptured: (file: StoryMediaFile) => void;
  /** Deschide galeria (alternativă la captura live). */
  onPickGallery: () => void;
  /** Închide ecranul de story. */
  onClose: () => void;
  /** Blochează controalele când părintele e ocupat (ex. upload în curs). */
  busy?: boolean;
}

export function StoryCameraScreen({ onCaptured, onPickGallery, onClose, busy }: Props) {
  const { colors, typography, spacing } = useTheme();

  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // La prima afișare cerem permisiunea o singură dată (dacă sistemul ne mai lasă).
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || !permission) return;
    if (!permission.granted && permission.canAskAgain) {
      askedRef.current = true;
      void requestPermission();
    }
  }, [permission, requestPermission]);

  /** Face o poză și o trimite mai departe (compresie inclusă). */
  const onCapture = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || capturing || busy) return;
    setError(null);
    setCapturing(true);
    const res = await captureStoryPhoto(cam);
    setCapturing(false);
    if (res.status === 'captured') onCaptured(res.file);
    else setError(res.message);
  }, [capturing, busy, onCaptured]);

  const flip = useCallback(() => {
    setFacing((f) => (f === 'front' ? 'back' : 'front'));
  }, []);

  // --- Permisiuni încă în curs de rezolvare ---------------------------------
  if (!permission) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: CAMERA_BG }]} testID="story-camera-loading">
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // --- Permisiune refuzată: mesaj clar + căi de recuperare (nu ecran mort) ---
  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: CAMERA_BG }]}
        edges={['top', 'bottom']}
      >
        <View style={[styles.topBar, { padding: spacing.lg }]}>
          <Pressable
            testID="story-close"
            accessibilityRole="button"
            accessibilityLabel="Închide"
            onPress={onClose}
            hitSlop={spacing.sm}
          >
            <Text style={[typography.h2, { color: ON_DARK }]}>✕</Text>
          </Pressable>
        </View>

        <View style={[styles.center, { padding: spacing.xl, gap: spacing.md }]}>
          <Text style={styles.permEmoji}>📷</Text>
          <Text style={[typography.bodyStrong, { color: ON_DARK, textAlign: 'center' }]}>
            {Platform.OS === 'web' ? STORY_MESSAGES.cameraUnavailable : STORY_MESSAGES.cameraPermission}
          </Text>

          {blocked ? (
            <Button
              testID="story-settings"
              label="Deschide setările"
              onPress={() => void openAppSettings()}
            />
          ) : (
            <Button
              testID="story-grant"
              label="Permite acces la cameră"
              onPress={() => void requestPermission()}
            />
          )}

          <Button
            testID="story-gallery"
            label="Alege din galerie"
            variant="outline"
            onPress={onPickGallery}
          />
        </View>
      </SafeAreaView>
    );
  }

  // --- Camera LIVE ----------------------------------------------------------
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: CAMERA_BG }]} edges={['top', 'bottom']}>
      {/* `mode="picture"` fix: story-ul e doar poză (vezi antetul fișierului). */}
      <CameraView
        testID="story-camera"
        ref={cameraRef}
        facing={facing}
        mode="picture"
        style={StyleSheet.absoluteFill}
      />

      {/* Bara de sus: închide */}
      <View style={[styles.topBar, { padding: spacing.lg }]}>
        <Pressable
          testID="story-close"
          accessibilityRole="button"
          accessibilityLabel="Închide"
          onPress={onClose}
          hitSlop={spacing.sm}
        >
          <Text style={[typography.h2, { color: ON_DARK }]}>✕</Text>
        </Pressable>
      </View>

      {/* Eroare de captură (transientă), peste previzualizare */}
      {error ? (
        <View style={[styles.errorBanner, { padding: spacing.sm }]}>
          <Text testID="story-camera-error" style={[typography.caption, { color: ON_DARK, textAlign: 'center' }]}>
            {error}
          </Text>
        </View>
      ) : null}

      {/* Controalele de jos: galerie · captură · flip */}
      <View style={[styles.bottomBar, { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl }]}>
        <Pressable
          testID="story-gallery"
          accessibilityRole="button"
          accessibilityLabel="Alege din galerie"
          onPress={onPickGallery}
          disabled={busy}
          hitSlop={spacing.sm}
          style={[styles.sideButton, { borderColor: 'rgba(255,255,255,0.6)' }]}
        >
          <Text style={styles.sideGlyph}>🖼️</Text>
        </Pressable>

        <Pressable
          testID="story-capture"
          accessibilityRole="button"
          accessibilityLabel="Fă o poză"
          onPress={() => void onCapture()}
          disabled={capturing || busy}
          style={styles.shutterOuter}
        >
          {capturing ? (
            <ActivityIndicator color={CAMERA_BG} />
          ) : (
            <View style={[styles.shutterInner, { backgroundColor: ON_DARK }]} />
          )}
        </Pressable>

        <Pressable
          testID="story-flip"
          accessibilityRole="button"
          accessibilityLabel="Comută camera"
          onPress={flip}
          disabled={busy}
          hitSlop={spacing.sm}
          style={[styles.sideButton, { borderColor: 'rgba(255,255,255,0.6)' }]}
        >
          <Text style={styles.sideGlyph}>🔄</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const SHUTTER = 78;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  permEmoji: { fontSize: 56, lineHeight: 66 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 160,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    zIndex: 2,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 2,
  },
  sideButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sideGlyph: { fontSize: 24, lineHeight: 30 },
  shutterOuter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  shutterInner: {
    width: SHUTTER - 22,
    height: SHUTTER - 22,
    borderRadius: (SHUTTER - 22) / 2,
  },
});
