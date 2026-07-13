/**
 * Hartă reală pentru un eveniment: WebView + Leaflet + tiles OpenStreetMap.
 * Gratuit, fără cheie API și fără cont — merge în Expo Go, identic pe iOS și Android.
 * Fără coordonate, cade elegant înapoi pe caseta cu orașul (comportamentul vechi).
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { config } from '@/config';
import { useTheme } from '@theme/index';

export interface EventMapProps {
  /** Latitudinea evenimentului (grade zecimale). */
  lat?: number | null;
  /** Longitudinea evenimentului (grade zecimale). */
  lng?: number | null;
  /** Titlul evenimentului, afișat în popup-ul markerului. */
  title?: string;
  /** Text afișat în fallback când lipsesc coordonatele (de regulă orașul). */
  city?: string;
  /** Înălțimea hărții în puncte. */
  height?: number;
}

/** Verifică dacă perechea de coordonate e utilizabilă (numere finite, în intervalele valide). */
export function hasValidCoords(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Serializează o valoare pentru încorporare într-un literal JS din interiorul unui `<script>`.
 * `<` devine `<`, deci un `</script>` din date nu poate închide blocul.
 */
function toJsLiteral(value: string | number): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

interface HtmlParams {
  lat: number;
  lng: number;
  title: string;
}

/**
 * Construiește documentul HTML al hărții. Singurele date injectate sunt lat/lng
 * (numere validate) și titlul evenimentului — inserat în DOM prin `textContent`,
 * niciodată prin `innerHTML`. Nicio informație de utilizator nu ajunge în pagină.
 */
export function buildMapHtml({ lat, lng, title }: HtmlParams): string {
  const { tileUrl, attribution, zoom, leafletCssUrl, leafletJsUrl } = config.map;

  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="${leafletCssUrl}" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: transparent; }
  #map { height: 100%; width: 100%; }
  .leaflet-control-attribution { font-size: 10px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="${leafletJsUrl}"></script>
<script>
  (function () {
    var LAT = ${toJsLiteral(lat)};
    var LNG = ${toJsLiteral(lng)};
    var ZOOM = ${toJsLiteral(zoom)};
    var TITLE = ${toJsLiteral(title)};
    var TILE_URL = ${toJsLiteral(tileUrl)};
    var ATTRIBUTION = ${toJsLiteral(attribution)};

    if (typeof L === 'undefined') return;

    var map = L.map('map', {
      center: [LAT, LNG],
      zoom: ZOOM,
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
    });

    // Atribuția OSM este obligatorie prin licență — nu o elimina.
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    var marker = L.marker([LAT, LNG]).addTo(map);
    if (TITLE) {
      // textContent (nu innerHTML): titlul nu poate injecta markup.
      var label = document.createElement('span');
      label.textContent = TITLE;
      marker.bindPopup(label);
    }
  })();
</script>
</body>
</html>`;
}

/** Hartă a locului evenimentului; fără coordonate valide afișează caseta cu orașul. */
export function EventMap({ lat, lng, title, city, height = 180 }: EventMapProps) {
  const { colors, typography, radius } = useTheme();

  const valid = hasValidCoords(lat, lng);

  const html = useMemo(
    () => (valid ? buildMapHtml({ lat: lat as number, lng: lng as number, title: title ?? '' }) : ''),
    [valid, lat, lng, title],
  );

  const frame = {
    height,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.card,
  };

  if (!valid) {
    return (
      <View
        accessibilityRole="image"
        accessibilityLabel={city ? `Locație: ${city}` : 'Locație indisponibilă'}
        style={[styles.frame, styles.fallback, frame, { height: 120 }]}
      >
        <Text style={[typography.bodyStrong, { color: colors.textSecondary }]}>
          📍 {city}
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={title ? `Harta locației: ${title}` : 'Harta locației'}
      style={[styles.frame, frame]}
    >
      <WebView
        testID="event-map-webview"
        originWhitelist={['*']}
        source={{ html }}
        scrollEnabled={false}
        style={styles.webview}
        androidLayerType="hardware"
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
