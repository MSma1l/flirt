/**
 * Randează media unei povești: imagine sau video (TZ secț. 11) — varianta WEB.
 *
 * Pe web nu avem nevoie de niciun pachet nativ de video: folosim direct elementul
 * DOM `<video>` (react-native-web randează în DOM), deci un video ales din galerie
 * SE VEDE în browser, fără degradare. Imaginile rămân pe `<Image>`.
 */
import React from 'react';
import { Image, ImageStyle, StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { StoryMediaType } from './types';

export interface StoryMediaProps {
  uri: string;
  mediaType: StoryMediaType;
  style?: StyleProp<ViewStyle>;
  hintColor?: string;
}

/** Umplere pe TOT containerul, cu încadrare „cover" (ca `resizeMode` pe nativ). */
const VIDEO_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  backgroundColor: '#000',
};

export function StoryMedia({ uri, mediaType, style }: StoryMediaProps) {
  if (mediaType === 'video') {
    return (
      <video
        src={uri}
        autoPlay
        muted
        loop
        playsInline
        controls={false}
        style={VIDEO_STYLE}
        data-testid="story-video"
      />
    );
  }
  // `cover` + fundal negru = povestea umple tot ecranul (ca la Instagram);
  // `contain` ar lăsa benzi la orice poză care nu e în formatul ecranului.
  return (
    <Image
      source={{ uri }}
      style={[styles.fill, style as StyleProp<ImageStyle>]}
      resizeMode="cover"
      testID="story-image"
    />
  );
}

const styles = StyleSheet.create({
  fill: { backgroundColor: '#000' },
});
