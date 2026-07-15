/**
 * Grila de poze de profil (TZ 2.4): adăugare, ștergere cu confirmare, reordonare.
 *
 * Prima poză este cea PRINCIPALĂ (o vede lumea prima în feed) — e marcată vizibil
 * cu un badge, iar reordonarea se face cu săgeți ‹ ›, accesibile și testabile
 * (drag & drop ar cere o dependență nativă în plus, fără câștig funcțional).
 */
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/ui';
import { useTheme } from '@theme/index';

import { PhotoTile } from './types';
import { PHOTO_LIMITS } from './validation';

interface Props {
  /** Pozele afișate, în ordine (index 0 = poza principală). */
  photos: PhotoTile[];
  /** Deschide galeria. */
  onAdd: () => void;
  /** Șterge poza de la index (apelat DUPĂ confirmarea utilizatorului). */
  onRemove: (index: number) => void;
  /** Mută poza de la `from` la `to`. */
  onMove: (from: number, to: number) => void;
  /** Numărul minim/maxim de poze (implicit: limitele din config). */
  min?: number;
  max?: number;
  /** Mesaj de eroare afișat sub grilă. */
  error?: string | null;
  /** True dacă accesul la galerie a fost refuzat → afișăm calea de recuperare. */
  permissionDenied?: boolean;
  /** Deschide Setările sistemului (recuperare după refuzul permisiunii). */
  onOpenSettings?: () => void;
  /** Blochează butoanele cât timp o operațiune e în curs. */
  busy?: boolean;
}

export function PhotoGrid({
  photos,
  onAdd,
  onRemove,
  onMove,
  min = PHOTO_LIMITS.min,
  max = PHOTO_LIMITS.max,
  error,
  permissionDenied,
  onOpenSettings,
  busy,
}: Props) {
  const { colors, typography, radius, spacing } = useTheme();

  const canAdd = photos.length < max;

  /** Ștergerea cere confirmare — o poză ștearsă din greșeală nu se recuperează. */
  const confirmRemove = (index: number) => {
    // Mesajul e extras o singură dată: același text pe ambele platforme, inclusiv
    // avertismentul special când dispare poza principală (index 0 dintre mai multe).
    const message =
      index === 0 && photos.length > 1
        ? 'Este poza ta principală. Următoarea poză îi va lua locul.'
        : 'Poza va fi eliminată din profil.';

    // Pe web `Alert.alert` din react-native-web e un no-op → dialogul nu apărea
    // niciodată și butonul „✕" părea mort. Folosim `window.confirm` nativ browserului.
    if (Platform.OS === 'web') {
      if (window.confirm(message)) {
        onRemove(index);
      }
      return;
    }

    // Nativ: dialogul RN cu buton distructiv, neschimbat.
    Alert.alert('Ștergi poza?', message, [
      { text: 'Anulează', style: 'cancel' },
      { text: 'Șterge', style: 'destructive', onPress: () => onRemove(index) },
    ]);
  };

  const tileStyle = {
    width: '31%' as const,
    aspectRatio: 3 / 4,
    borderRadius: radius.md,
    overflow: 'hidden' as const,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  };

  return (
    <View style={{ gap: spacing.sm, width: '100%' }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        Poze ({photos.length}/{max}) — minimum {min}. Prima poză este cea principală.
      </Text>

      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: spacing.sm,
          width: '100%',
        }}
      >
        {photos.map((photo, index) => (
          <View key={photo.key} testID={`photo-tile-${index}`} style={tileStyle}>
            <Image
              source={{ uri: photo.uri }}
              accessibilityLabel={index === 0 ? 'Poza principală' : `Poza ${index + 1}`}
              style={{ width: '100%', height: '100%' }}
              resizeMode="cover"
            />

            {index === 0 ? (
              <View
                testID="photo-main-badge"
                style={{
                  position: 'absolute',
                  top: spacing.xs,
                  left: spacing.xs,
                  paddingHorizontal: spacing.sm,
                  paddingVertical: 2,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accent,
                }}
              >
                <Text style={[typography.badge, { color: colors.onAccent }]}>
                  Principală
                </Text>
              </View>
            ) : null}

            {photo.uploading ? (
              <View
                testID={`photo-progress-${index}`}
                style={{
                  ...StyleSheet.absoluteFillObject,
                  backgroundColor: colors.scrim,
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: spacing.xs,
                }}
              >
                <ActivityIndicator color={colors.onAccent} />
                <Text style={[typography.badge, { color: colors.onAccent }]}>
                  {Math.round((photo.progress ?? 0) * 100)}%
                </Text>
              </View>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Șterge poza ${index + 1}`}
                  testID={`photo-remove-${index}`}
                  disabled={busy}
                  onPress={() => confirmRemove(index)}
                  hitSlop={spacing.xs}
                  style={{
                    position: 'absolute',
                    top: spacing.xs,
                    right: spacing.xs,
                    width: 24,
                    height: 24,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.scrim,
                  }}
                >
                  <Text style={[typography.badge, { color: colors.onAccent }]}>✕</Text>
                </Pressable>

                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    backgroundColor: colors.scrim,
                  }}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Mută poza ${index + 1} mai devreme`}
                    accessibilityState={{ disabled: index === 0 || !!busy }}
                    testID={`photo-move-left-${index}`}
                    disabled={index === 0 || busy}
                    onPress={() => onMove(index, index - 1)}
                    hitSlop={spacing.xs}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 2 }}
                  >
                    <Text
                      style={[
                        typography.bodyStrong,
                        { color: index === 0 ? colors.textDisabled : colors.onAccent },
                      ]}
                    >
                      ‹
                    </Text>
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Mută poza ${index + 1} mai târziu`}
                    accessibilityState={{
                      disabled: index === photos.length - 1 || !!busy,
                    }}
                    testID={`photo-move-right-${index}`}
                    disabled={index === photos.length - 1 || busy}
                    onPress={() => onMove(index, index + 1)}
                    hitSlop={spacing.xs}
                    style={{ paddingHorizontal: spacing.sm, paddingVertical: 2 }}
                  >
                    <Text
                      style={[
                        typography.bodyStrong,
                        {
                          color:
                            index === photos.length - 1
                              ? colors.textDisabled
                              : colors.onAccent,
                        },
                      ]}
                    >
                      ›
                    </Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        ))}

        {canAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adaugă o poză"
            testID="photo-add"
            disabled={busy}
            onPress={onAdd}
            style={[
              tileStyle,
              {
                alignItems: 'center',
                justifyContent: 'center',
                borderStyle: 'dashed',
                borderColor: colors.accent,
              },
            ]}
          >
            <Text style={[typography.h1, { color: colors.accent }]}>+</Text>
            <Text style={[typography.badge, { color: colors.textSecondary }]}>
              Adaugă
            </Text>
          </Pressable>
        ) : null}
      </View>

      {!canAdd ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          Ai atins numărul maxim de {max} poze.
        </Text>
      ) : null}

      {error ? (
        <Text testID="photo-error" style={[typography.caption, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}

      {permissionDenied && onOpenSettings ? (
        <Button
          label="Deschide setările"
          variant="outline"
          testID="photo-open-settings"
          onPress={onOpenSettings}
        />
      ) : null}
    </View>
  );
}
