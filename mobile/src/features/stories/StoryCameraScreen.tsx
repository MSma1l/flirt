/**
 * Cameră LIVE pentru un story, stil Instagram/Snapchat (TZ secț. 11).
 *
 *  - previzualizare pe tot ecranul cu `CameraView` din `expo-camera`, cameră
 *    frontală (selfie) implicit;
 *  - buton mare, rotund, de captură (jos-centru) → poză (`takePictureAsync`);
 *  - comutare cameră frontală ↔ spate (flip) și acces la galerie (jos-stânga);
 *  - pe NATIV, un comutator Foto/Video păstrează și filmarea unui clip scurt;
 *  - permisiunea de cameră e cerută corect; refuzul NU lasă ecran mort: arătăm
 *    mesaj + „Permite acces" / „Deschide setările" + alegerea din galerie;
 *  - pe WEB funcționează prin getUserMedia; dacă browserul chiar nu dă camera,
 *    degradează elegant la galerie, fără crash.
 *
 * Captura efectivă (poză/clip) stă în `storyCamera.ts` — aici e doar interfața.
 */
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
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
import { captureStoryPhoto, recordStoryVideo } from '@/features/stories/storyCamera';
import { STORY_MESSAGES, STORY_VIDEO_MAX_SECONDS } from '@/features/stories/storyLimits';
import { openAppSettings } from '@/features/stories/storyPicker';
import { useTheme } from '@theme/index';

/** Filmarea (mod Video) e oferită doar pe nativ; pe web rămâne doar poza. */
const CAN_RECORD = Platform.OS !== 'web';

/** Fundal întunecat, imersiv — camera arată la fel indiferent de tema aplicației. */
const CAMERA_BG = '#0D0D0F';
const ON_DARK = '#FFFFFF';

interface Props {
  /** Media capturată (poză sau clip), gata de compunere/upload. */
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
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
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

  /** Pornește/oprește filmarea (nativ). Fără microfon filmăm mut — nu blocăm. */
  const onToggleRecord = useCallback(async () => {
    const cam = cameraRef.current;
    if (!cam || busy) return;
    if (recording) {
      cam.stopRecording();
      return;
    }
    setError(null);
    setRecording(true);
    const res = await recordStoryVideo(cam, STORY_VIDEO_MAX_SECONDS);
    setRecording(false);
    if (res.status === 'recorded') onCaptured(res.file);
    else setError(res.message);
  }, [recording, busy, onCaptured]);

  /** Trece în modul Video, cerând (opțional) și microfonul pentru sunet. */
  const enterVideoMode = useCallback(async () => {
    if (micPermission && !micPermission.granted && micPermission.canAskAgain) {
      await requestMicPermission();
    }
    setMode('video');
  }, [micPermission, requestMicPermission]);

  const toggleMode = useCallback(() => {
    if (recording) return; // nu comutăm în timpul filmării
    if (mode === 'photo') void enterVideoMode();
    else setMode('photo');
  }, [mode, recording, enterVideoMode]);

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
  const showStop = mode === 'video' && recording;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: CAMERA_BG }]} edges={['top', 'bottom']}>
      <CameraView
        testID="story-camera"
        ref={cameraRef}
        facing={facing}
        mode={mode === 'video' ? 'video' : 'picture'}
        style={StyleSheet.absoluteFill}
      />

      {/* Bara de sus: închide + comutator Foto/Video (nativ) */}
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

        {CAN_RECORD ? (
          <Pressable
            testID="story-mode"
            accessibilityRole="button"
            accessibilityLabel={mode === 'photo' ? 'Comută pe video' : 'Comută pe foto'}
            onPress={toggleMode}
            hitSlop={spacing.sm}
            style={[styles.modePill, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          >
            <Text style={[typography.badge, { color: ON_DARK }]}>
              {mode === 'photo' ? 'FOTO' : 'VIDEO'}
            </Text>
          </Pressable>
        ) : null}
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
          disabled={recording || busy}
          hitSlop={spacing.sm}
          style={[styles.sideButton, { borderColor: 'rgba(255,255,255,0.6)' }]}
        >
          <Text style={styles.sideGlyph}>🖼️</Text>
        </Pressable>

        <Pressable
          testID="story-capture"
          accessibilityRole="button"
          accessibilityLabel={mode === 'video' ? (recording ? 'Oprește filmarea' : 'Filmează') : 'Fă o poză'}
          onPress={() => (mode === 'video' ? void onToggleRecord() : void onCapture())}
          disabled={capturing || busy}
          style={styles.shutterOuter}
        >
          {capturing ? (
            <ActivityIndicator color={CAMERA_BG} />
          ) : (
            <View
              style={[
                showStop ? styles.shutterStop : styles.shutterInner,
                { backgroundColor: showStop ? colors.accent : ON_DARK },
              ]}
            />
          )}
        </Pressable>

        <Pressable
          testID="story-flip"
          accessibilityRole="button"
          accessibilityLabel="Comută camera"
          onPress={flip}
          disabled={recording || busy}
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
  modePill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
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
  shutterStop: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
});
