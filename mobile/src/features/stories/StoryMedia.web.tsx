/**
 * Randează media unei povești: imagine sau video (TZ secț. 11) — varianta WEB.
 *
 * Pe web nu avem nevoie de niciun pachet nativ de video: folosim direct elementul
 * DOM `<video>` (react-native-web randează în DOM), deci un video ales din galerie
 * SE VEDE în browser, fără degradare. Imaginile rămân pe `<Image>`.
 */
import React from 'react';
import { Image, ImageStyle, StyleProp, ViewStyle } from 'react-native';

import { StoryMediaType } from './types';

export interface StoryMediaProps {
  uri: string;
  mediaType: StoryMediaType;
  style?: StyleProp<ViewStyle>;
  hintColor?: string;
}

/** Umplere pe tot containerul, cu încadrare „contain" (ca `resizeMode`). */
const VIDEO_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
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
  return <Image source={{ uri }} style={style as StyleProp<ImageStyle>} resizeMode="contain" />;
}
