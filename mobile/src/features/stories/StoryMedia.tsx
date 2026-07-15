/**
 * Randează media unei povești: imagine sau video (TZ secț. 11) — varianta NATIVĂ.
 *
 * Imaginile se afișează cu `<Image>`. Redarea video NATIVĂ are nevoie de un player
 * (ex. `expo-video`), care NU e încă în dependențe: până la instalare afișăm un
 * placeholder curat (nu crăpăm). Odată `expo-video` instalat, e de înlocuit doar
 * ramura de mai jos cu `<VideoView player={...} />`. Pe WEB video-ul se vede deja
 * (vezi `StoryMedia.web.tsx`, care folosește elementul nativ `<video>`).
 */
import React from 'react';
import {
  Image,
  ImageStyle,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { StoryMediaType } from './types';

export interface StoryMediaProps {
  uri: string;
  mediaType: StoryMediaType;
  /** Stil aplicat containerului (de obicei umplere pe tot ecranul). */
  style?: StyleProp<ViewStyle>;
  /** Culoarea textului placeholder-ului de video (temă). */
  hintColor?: string;
}

export function StoryMedia({ uri, mediaType, style, hintColor }: StoryMediaProps) {
  if (mediaType === 'video') {
    return (
      <View style={[styles.videoFallback, style]} testID="story-video-fallback">
        <Text style={styles.play}>▶</Text>
        <Text style={[styles.hint, hintColor ? { color: hintColor } : null]}>
          Videoclip
        </Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      // Stilul vine ca ViewStyle (umplere/rază), compatibil ca ImageStyle aici.
      style={style as StyleProp<ImageStyle>}
      resizeMode="contain"
      testID="story-image"
    />
  );
}

const styles = StyleSheet.create({
  videoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  play: { color: '#fff', fontSize: 64, lineHeight: 72 },
  hint: { color: '#bbb', marginTop: 8, fontSize: 14 },
});
