/**
 * Reclamă interstițială full-screen, afișată după fiecare N swipe-uri.
 *
 * Redare video FĂRĂ modul nativ nou (compatibil Expo Go): pe nativ folosim
 * `react-native-webview` (deja în proiect pentru hărți) cu un `<video autoplay
 * muted playsinline>` HTML5; pe web folosim direct elementul DOM `<video>`.
 * Reclamele doar-imagine merg pe `<Image>` standard.
 *
 * Un countdown vizibil pornește de la `min(duration_seconds, max_video_seconds)`
 * secunde. Butonul de închidere e DEZACTIVAT până când countdown-ul ajunge la 0,
 * apoi userul poate închide reclama și feed-ul continuă.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  ImageStyle,
  Modal,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { useTheme } from '@theme/index';

import { reportAdClick, reportAdImpression } from './adsApi';
import { Ad } from './types';

interface Props {
  visible: boolean;
  /** Reclama de afișat. `null` => modalul nu redă nimic (nu se deschide). */
  ad: Ad | null;
  /** Limita maximă de secunde din config (`max_video_seconds`). */
  maxSeconds: number;
  /** Chemat când userul închide reclama (permis doar după countdown). */
  onClose: () => void;
}

/**
 * Secundele de countdown: `min(durata reclamei, limita din config)`, cel puțin 1.
 * O durată absentă/invalidă (≤ 0) cade pe limita din config.
 */
export function resolveCountdownSeconds(durationSeconds: number, maxSeconds: number): number {
  const safeMax = maxSeconds > 0 ? maxSeconds : 1;
  const safeDuration = durationSeconds > 0 ? durationSeconds : safeMax;
  return Math.max(1, Math.min(safeDuration, safeMax));
}

/**
 * Serializează un string pentru un literal JS dintr-un `<script>` — `<` devine
 * `<`, deci un `</script>` din URL nu poate închide blocul. Separatorii de
 * linie U+2028/U+2029 sunt escapați (sunt terminatori de linie în JS). Identic
 * cu abordarea din harta evenimentelor.
 */
function toJsLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Documentul HTML redat în WebView: un video pe tot ecranul, autoplay mut. */
export function buildAdVideoHtml(videoUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; overflow: hidden; }
  video { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; background: #000; }
</style>
</head>
<body>
<video id="ad" autoplay muted playsinline loop preload="auto"></video>
<script>
  (function () {
    var URL = ${toJsLiteral(videoUrl)};
    var v = document.getElementById('ad');
    v.src = URL;
    var p = v.play();
    if (p && typeof p.catch === 'function') { p.catch(function () {}); }
  })();
</script>
</body>
</html>`;
}

export function AdInterstitial({ visible, ad, maxSeconds, onClose }: Props) {
  const { colors, typography, radius, spacing } = useTheme();

  const totalSeconds = ad ? resolveCountdownSeconds(ad.durationSeconds, maxSeconds) : maxSeconds;

  const [remaining, setRemaining] = useState(totalSeconds);

  // Pornește / repornește countdown-ul de fiecare dată când se deschide o reclamă.
  useEffect(() => {
    if (!visible || !ad) return;
    setRemaining(totalSeconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [visible, ad, totalSeconds]);

  // Raportăm o singură AFIȘARE per apariție a reclamei. `reportedAdId` reține id-ul
  // reclamei deja raportate, ca re-randările (countdown-ul tickăie în fiecare secundă)
  // să NU dubleze impression-ul. La închidere resetăm, deci o nouă apariție a
  // aceleiași reclame va raporta din nou.
  const reportedAdId = useRef<number | null>(null);
  useEffect(() => {
    if (!visible || !ad) {
      reportedAdId.current = null;
      return;
    }
    if (reportedAdId.current === ad.id) return;
    reportedAdId.current = ad.id;
    void reportAdImpression(ad.id);
  }, [visible, ad]);

  const canClose = remaining <= 0;

  const videoHtml = useMemo(
    () => (ad?.videoUrl ? buildAdVideoHtml(ad.videoUrl) : ''),
    [ad?.videoUrl],
  );

  if (!ad) return null;

  const requestClose = () => {
    if (canClose) onClose();
  };

  // Click pe reclamă: înregistrăm click-ul (best-effort). Dacă în viitor reclama
  // aduce un URL de destinație, aici s-ar deschide (Linking.openURL) — momentan
  // contractul nu expune un link, deci doar raportăm.
  const handleAdPress = () => {
    void reportAdClick(ad.id);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      // `onRequestClose` (Android back): respectăm aceeași gardă — nu se închide
      // înainte de expirarea countdown-ului.
      onRequestClose={requestClose}
    >
      <View style={styles.fill} testID="ad-interstitial">
        {/* Toată zona media e apăsabilă: un click deschide destinația reclamei
            (dacă/când există) și se raportează la backend. Butonul de închidere
            e randat DEASUPRA, deci apăsarea lui nu declanșează un click de reclamă. */}
        <Pressable
          style={styles.media}
          onPress={handleAdPress}
          accessibilityRole="link"
          accessibilityLabel="Deschide reclama"
          testID="ad-clickable"
        >
          {ad.videoUrl ? (
            renderVideo(videoHtml, ad.videoUrl)
          ) : ad.imageUrl ? (
            <Image
              source={{ uri: ad.imageUrl }}
              style={styles.media as StyleProp<ImageStyle>}
              resizeMode="cover"
              testID="ad-image"
            />
          ) : (
            <View style={[styles.media, styles.placeholder]} testID="ad-placeholder">
              <Text style={[typography.display, styles.placeholderText]}>{ad.title}</Text>
            </View>
          )}
        </Pressable>

        {/* Eticheta „Reclamă" + titlul, sus-stânga. */}
        <View style={[styles.badge, { top: spacing.xl, left: spacing.lg }]} pointerEvents="none">
          <Text style={styles.badgeText}>Reclamă</Text>
          {ad.title ? (
            <Text style={styles.titleText} numberOfLines={1}>
              {ad.title}
            </Text>
          ) : null}
        </View>

        {/* Buton countdown / închidere, sus-dreapta. */}
        <Pressable
          testID="ad-close"
          onPress={requestClose}
          disabled={!canClose}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canClose }}
          accessibilityLabel={
            canClose ? 'Închide reclama' : `Poți închide în ${remaining} secunde`
          }
          style={[
            styles.closeBtn,
            {
              top: spacing.xl,
              right: spacing.lg,
              borderRadius: radius.pill,
              backgroundColor: canClose ? colors.accent : 'rgba(0,0,0,0.55)',
            },
          ]}
        >
          <Text style={styles.closeText}>{canClose ? 'Închide ✕' : `${remaining}`}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/**
 * Redarea video, dependentă de platformă:
 *  - web: elementul DOM `<video>` (react-native-web randează în DOM).
 *  - nativ: WebView cu HTML5 `<video>` (autoplay inline permis prin props-uri).
 */
function renderVideo(html: string, videoUrl: string): React.ReactElement {
  if (Platform.OS === 'web') {
    // `createElement` (nu JSX): evită tiparea DOM într-un fișier nativ .tsx,
    // exact ca `<iframe>`-ul din harta evenimentelor.
    return React.createElement('video', {
      src: videoUrl,
      autoPlay: true,
      muted: true,
      loop: true,
      playsInline: true,
      controls: false,
      'data-testid': 'ad-video',
      style: {
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        backgroundColor: '#000',
      },
    });
  }
  return (
    <WebView
      testID="ad-video"
      originWhitelist={['*']}
      source={{ html }}
      scrollEnabled={false}
      style={styles.media}
      androidLayerType="hardware"
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      setSupportMultipleWindows={false}
      // Autoplay inline fără gest utilizator (necesar pe iOS și Android).
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: '#000',
  },
  media: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  placeholderText: {
    color: '#fff',
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    maxWidth: '60%',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  titleText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 6,
  },
  closeBtn: {
    position: 'absolute',
    minWidth: 44,
    height: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
