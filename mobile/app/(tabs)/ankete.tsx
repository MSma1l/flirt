/**
 * Deck-ul de ankete (TZ 4.4, 4.7): feed React Query, undo, mesaj la like.
 *
 * Comanda e 100% pe gesturi, în patru direcții — nu mai există butoane:
 *   stânga = dislike · dreapta = like · sus = super like · jos = înapoi (undo)
 * Aceleași patru direcții merg și prin înclinarea telefonului (doar pe nativ).
 * Pentru cine nu poate face swipe (VoiceOver), aceleași acțiuni sunt expuse ca
 * `accessibilityActions` pe bara de indicii de sub deck.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityActionEvent,
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { AdInterstitial } from '@/features/ads/AdInterstitial';
import { fetchNextAd } from '@/features/ads/adsApi';
import { Ad } from '@/features/ads/types';
import { useAdConfig } from '@/features/ads/useAdConfig';
import { fetchFeed, swipe, undoSwipe } from '@/features/feed/feedApi';
import { MatchModal } from '@/features/feed/MatchModal';
import { ProfileCard } from '@/features/feed/ProfileCard';
import { SendFirstMessageSheet } from '@/features/feed/SendFirstMessageSheet';
import {
  resolveDirection,
  SWIPE_THRESHOLD_X,
  SWIPE_THRESHOLD_Y,
  SwipeDirection,
} from '@/features/feed/swipeDirection';
import { FeedCard, SwipeAction } from '@/features/feed/types';
import { useTiltSwipe } from '@/features/feed/useTiltSwipe';
import { StoriesBar } from '@/features/stories/StoriesBar';
import { useTheme } from '@theme/index';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;
/** Cât de departe „aruncăm" cardul în afara ecranului la o acțiune confirmată. */
const FLING_X = SCREEN_WIDTH * 1.5;
const FLING_Y = SCREEN_HEIGHT * 1.5;
/** Cât se mișcă degetul până acceptăm că e un gest, nu o atingere. */
const GESTURE_SLOP = 8;

export default function AnketeScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<FeedCard[]>({
    queryKey: ['feed'],
    queryFn: fetchFeed,
  });

  // Config-ul de reclame (o dată, în cache): prag de swipe + limită de secunde.
  const { data: adConfig } = useAdConfig();

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  // Reclama interstițială curentă (null = nicio reclamă deschisă).
  const [activeAd, setActiveAd] = useState<Ad | null>(null);
  // Contor de swipe-uri DOAR pentru reclame: crește la fiecare swipe reușit și
  // NU scade la undo (altfel n-am ajunge niciodată la prag). Ref, ca să nu forțeze
  // re-render la fiecare swipe și să nu fie citit „vechi" din closure.
  const adSwipeCountRef = useRef(0);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [matchChatId, setMatchChatId] = useState<string | null>(null);
  // Cardul pentru care s-a dat like și așteaptă alegerea din sheet (mesaj / doar like).
  const [pendingLike, setPendingLike] = useState<FeedCard | null>(null);
  // Câte swipe-uri s-au făcut în sesiune (pentru activarea butonului de undo).
  const [swipeCount, setSwipeCount] = useState(0);
  // Eroare la o acțiune (swipe / undo), afișată sub butoane. Null = fără eroare.
  const [actionError, setActionError] = useState<string | null>(null);

  const cards = data ?? [];
  const current = cards[index];

  // Poziția cardului de sus pentru gesturi (stabilă între render-uri).
  const position = useRef(new Animated.ValueXY()).current;

  // Când sosesc date noi (reîncărcare feed), pornim iar de la primul card.
  useEffect(() => {
    setIndex(0);
    position.setValue({ x: 0, y: 0 });
  }, [data, position]);

  const resetCardPosition = () => {
    Animated.spring(position, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: false,
      friction: 6,
    }).start();
  };

  /**
   * După un swipe reușit: dacă s-a atins pragul (`swipes_before_ad`) și reclamele
   * sunt active, aduce următoarea reclamă și o afișează. Un 204 (fără reclamă) sau
   * orice eroare de rețea NU blochează feed-ul — reclama e „best effort".
   */
  const maybeShowAd = async () => {
    adSwipeCountRef.current += 1;
    const threshold = adConfig?.swipesBeforeAd ?? 0;
    if (!adConfig?.enabled || threshold <= 0) return;
    if (adSwipeCountRef.current % threshold !== 0) return;
    try {
      const ad = await fetchNextAd();
      if (ad) setActiveAd(ad);
    } catch {
      // Reclama nu s-a putut aduce: userul continuă să dea swipe normal.
    }
  };

  const performSwipe = async (card: FeedCard, action: SwipeAction, message?: string) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await swipe(card.userId, action, message);
      if (result.matched) {
        setMatchName(card.name);
        setMatchChatId(result.chatId ?? null);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }
      setSwipeCount((c) => c + 1);
      setIndex((i) => i + 1);
      await maybeShowAd();
    } catch {
      // Rețea/server picat: nu avansăm indexul, rămânem pe același card și anunțăm userul.
      setActionError('Nu am putut trimite. Încearcă din nou.');
    } finally {
      position.setValue({ x: 0, y: 0 });
      setBusy(false);
    }
  };

  // Like → deschide sheet-ul de mesaj de deschidere (nu face swipe imediat).
  const requestLike = () => {
    if (!current || busy) return;
    setPendingLike(current);
  };

  const onSendFirstMessage = (message: string) => {
    const card = pendingLike;
    setPendingLike(null);
    if (card) performSwipe(card, 'like', message);
  };

  const onSkipFirstMessage = () => {
    const card = pendingLike;
    setPendingLike(null);
    if (card) performSwipe(card, 'like');
  };

  const onCloseFirstMessage = () => {
    setPendingLike(null);
    resetCardPosition();
  };

  const onUndo = async () => {
    if (busy || swipeCount === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await undoSwipe();
      if (result.undone) {
        setSwipeCount((c) => Math.max(0, c - 1));
        setIndex((i) => Math.max(0, i - 1));
        position.setValue({ x: 0, y: 0 });
        // Fără refetch: deck-ul local încă păstrează cardul anterior, iar un feed nou
        // ar reseta indexul la 0 (efectul de mai sus) și ne-ar arunca la primul card.
      }
    } catch {
      setActionError('Nu am putut anula. Încearcă din nou.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Execută acțiunea unei direcții, FĂRĂ animație.
   * Punctul unic în care se decide ce înseamnă fiecare direcție — degetul,
   * înclinarea telefonului și VoiceOver ajung toate aici.
   */
  const runActionRef = useRef<(direction: SwipeDirection) => void>(() => {});
  runActionRef.current = (direction) => {
    // Jos = undo: singura direcție care are sens și fără card pe ecran.
    if (direction === 'down') {
      onUndo();
      return;
    }
    if (!current || busy) return;
    if (direction === 'right') {
      requestLike();
    } else if (direction === 'left') {
      performSwipe(current, 'dislike');
    } else {
      // Sus = super like. Backendul nu acceptă încă `super_like`: până atunci
      // serverul răspunde cu eroare, iar `performSwipe` o prinde și afișează
      // mesajul standard, păstrând cardul. Nimic nu crapă.
      performSwipe(current, 'super_like');
    }
  };

  /**
   * Gest confirmat (deget sau înclinare): întâi confirmarea vizuală, apoi acțiunea.
   * Like-ul e singurul care NU aruncă cardul: deschide sheet-ul de mesaj, deci
   * cardul trebuie să rămână pe ecran.
   */
  const handleDirectionRef = useRef<(direction: SwipeDirection) => void>(() => {});
  handleDirectionRef.current = (direction) => {
    if (direction === 'down') {
      resetCardPosition();
      runActionRef.current('down');
      return;
    }
    if (!current || busy) {
      resetCardPosition();
      return;
    }
    if (direction === 'right') {
      resetCardPosition();
      runActionRef.current('right');
      return;
    }
    const toValue =
      direction === 'left' ? { x: -FLING_X, y: 0 } : { x: 0, y: -FLING_Y };
    Animated.timing(position, {
      toValue,
      duration: 200,
      useNativeDriver: false,
    }).start(() => runActionRef.current(direction));
  };

  const panResponder = useRef(
    PanResponder.create({
      // Preluăm gestul pe ORICE axă: verticalul e la fel de important ca orizontalul.
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > GESTURE_SLOP || Math.abs(gesture.dy) > GESTURE_SLOP,
      onPanResponderMove: (_evt, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_evt, gesture) => {
        const direction = resolveDirection(gesture.dx, gesture.dy);
        // Gest scurt sau diagonal (indecis) → cardul revine, nu ghicim o direcție.
        if (!direction) {
          resetCardPosition();
          return;
        }
        handleDirectionRef.current(direction);
      },
      onPanResponderTerminate: () => resetCardPosition(),
    }),
  ).current;

  // Înclinarea telefonului, doar pe nativ. Aceleași direcții, aceeași gardă `busy`,
  // aceeași confirmare vizuală (trece prin exact același handler ca degetul).
  // Cât timp e deschis un modal (sheet-ul de mesaj / match-ul), senzorul tace:
  // degetul e blocat de modal, deci nici înclinarea n-are voie să acționeze
  // pe cardul de dedesubt — altfel userul dă like „pe nevăzute" din spatele lui.
  const tiltEnabled =
    !busy && pendingLike === null && matchName === null && activeAd === null;
  useTiltSwipe({
    enabled: tiltEnabled,
    onDirection: (direction) => handleDirectionRef.current(direction),
  });

  /** VoiceOver nu poate face swipe pe un card: aceleași 4 acțiuni, ca acțiuni a11y. */
  const onAccessibilityAction = (event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case 'like':
        runActionRef.current('right');
        break;
      case 'dislike':
        runActionRef.current('left');
        break;
      case 'superLike':
        runActionRef.current('up');
        break;
      case 'undo':
        runActionRef.current('down');
        break;
    }
  };

  const closeMatch = () => {
    setMatchName(null);
    setMatchChatId(null);
  };

  const closeAd = () => setActiveAd(null);

  // Reclama interstițială: aceeași instanță în ambele randări (deck plin / gol),
  // fiindcă un swipe poate goli deck-ul chiar în momentul în care apare reclama.
  const adModal = (
    <AdInterstitial
      visible={activeAd !== null}
      ad={activeAd}
      maxSeconds={adConfig?.maxVideoSeconds ?? 10}
      onClose={closeAd}
    />
  );

  const onWriteMessage = () => {
    const chatId = matchChatId;
    closeMatch();
    if (chatId) router.push(`/chat/${chatId}`);
  };

  const reloadDeck = () => {
    setIndex(0);
    refetch();
  };

  // Indicii vizuale pentru toate cele 4 direcții. Butoanele nu mai există, deci
  // ăsta e SINGURUL mod în care userul află că sus/jos fac ceva.
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD_X],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nopeOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD_X, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const superOpacity = position.y.interpolate({
    inputRange: [-SWIPE_THRESHOLD_Y, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const undoOpacity = position.y.interpolate({
    inputRange: [0, SWIPE_THRESHOLD_Y],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-8deg', '0deg', '8deg'],
  });

  // Mesajul de eroare pentru acțiuni, sub butoane (același stil ca eroarea de feed).
  const actionErrorText = actionError ? (
    <Text
      testID="deck-action-error"
      style={[
        typography.body,
        styles.center,
        { color: colors.danger, marginTop: spacing.md },
      ]}
    >
      {actionError}
    </Text>
  ) : null;

  if (isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer center>
        <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
          Nu am putut încărca anketele.
        </Text>
        <Pressable onPress={() => refetch()} style={{ marginTop: spacing.md }}>
          <Text style={[typography.bodyStrong, { color: colors.accent }]}>
            Reîncearcă
          </Text>
        </Pressable>
      </ScreenContainer>
    );
  }

  if (!current) {
    return (
      <ScreenContainer>
        <StoriesBar />
        <View style={[styles.emptyState, { gap: spacing.lg }]}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Nu mai sunt ankete acum
          </Text>
          <Button label="Caută mai multe" onPress={reloadDeck} testID="deck-reload" />
          {swipeCount > 0 ? (
            <Button
              label="↩ Înapoi"
              variant="ghost"
              onPress={onUndo}
              disabled={busy}
              testID="deck-undo"
            />
          ) : null}
          {actionErrorText}
        </View>

        {/* Match-ul poate apărea și pe ultimul card (deck golit după swipe). */}
        <MatchModal
          visible={matchName !== null}
          name={matchName ?? ''}
          onWriteMessage={onWriteMessage}
          onContinue={closeMatch}
        />

        {adModal}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <StoriesBar />
      <View style={styles.deck}>
        <Animated.View
          style={[
            styles.animatedCard,
            {
              transform: [
                { translateX: position.x },
                { translateY: position.y },
                { rotate },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <ProfileCard card={current} />

          {/* Indiciu LIKE (drag dreapta) */}
          <Animated.View
            style={[
              styles.cue,
              styles.cueLeft,
              {
                borderColor: colors.success,
                borderRadius: radius.md,
                opacity: likeOpacity,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.success }]}>LIKE</Text>
          </Animated.View>

          {/* Indiciu NOPE (drag stânga) */}
          <Animated.View
            style={[
              styles.cue,
              styles.cueRight,
              {
                borderColor: colors.danger,
                borderRadius: radius.md,
                opacity: nopeOpacity,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>NOPE</Text>
          </Animated.View>

          {/* Indiciu SUPER LIKE (drag sus) */}
          <Animated.View
            style={[
              styles.cue,
              styles.cueTop,
              {
                borderColor: colors.accent,
                borderRadius: radius.md,
                opacity: superOpacity,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.accent }]}>
              ★ SUPER LIKE
            </Text>
          </Animated.View>

          {/* Indiciu ÎNAPOI / undo (drag jos) */}
          <Animated.View
            style={[
              styles.cue,
              styles.cueBottom,
              {
                borderColor: colors.textSecondary,
                borderRadius: radius.md,
                opacity: undoOpacity,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.textSecondary }]}>
              ↩ ÎNAPOI
            </Text>
          </Animated.View>
        </Animated.View>
      </View>

      {/*
        Bara de indicii. Are două roluri, ambele obligatorii:
        1. Sighted: butoanele au dispărut, deci userul n-ar avea de unde ști că
           sus/jos există până nu nimerește gestul din greșeală.
        2. VoiceOver: e elementul focusabil care poartă cele 4 acțiuni. NU punem
           `accessible` pe card — ar înghiți butoanele de favorit/raportare/blocare
           din ProfileCard și le-ar face inaccesibile la screen reader.
      */}
      <View
        testID="deck-gestures"
        accessible
        accessibilityLabel={`Anketa ${current.name}, ${current.age} ani`}
        accessibilityHint="Trage cardul: dreapta pentru like, stânga pentru nu-mi place, sus pentru super like, jos pentru înapoi. Sau înclină telefonul în aceleași direcții."
        accessibilityActions={[
          { name: 'like', label: 'Îmi place' },
          { name: 'dislike', label: 'Nu-mi place' },
          { name: 'superLike', label: 'Super like' },
          { name: 'undo', label: 'Înapoi la anketa anterioară' },
        ]}
        onAccessibilityAction={onAccessibilityAction}
        style={[styles.hintWrap, { marginTop: spacing.lg }]}
      >
        <Text style={[typography.caption, styles.center, { color: colors.textSecondary }]}>
          ← nu-mi place · îmi place → · ↑ super like · ↓ înapoi
        </Text>
      </View>

      {actionErrorText}

      <SendFirstMessageSheet
        visible={pendingLike !== null}
        name={pendingLike?.name ?? ''}
        onSend={onSendFirstMessage}
        onSkip={onSkipFirstMessage}
        onClose={onCloseFirstMessage}
      />

      <MatchModal
        visible={matchName !== null}
        name={matchName ?? ''}
        onWriteMessage={onWriteMessage}
        onContinue={closeMatch}
      />

      {adModal}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
    // Deck-ul începe imediat sub bara de story-uri, cu un mic respiro.
    marginTop: 12,
  },
  animatedCard: {
    flex: 1,
  },
  cue: {
    // Indiciile sunt pur vizuale: nu prind atingeri, ca să nu fure gestul
    // de swipe de sub ele. `pointerEvents` aici, în style — ca PROP e deprecat
    // pe React Native Web și scoate warning la fiecare randare.
    pointerEvents: 'none',
    position: 'absolute',
    top: 24,
    borderWidth: 3,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  cueLeft: {
    left: 24,
  },
  cueRight: {
    right: 24,
  },
  cueTop: {
    alignSelf: 'center',
  },
  cueBottom: {
    // Indiciul de undo stă jos, în direcția în care trage degetul.
    top: undefined,
    bottom: 24,
    alignSelf: 'center',
  },
  hintWrap: {
    alignItems: 'center',
  },
  center: {
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
