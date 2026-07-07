/** Deck-ul de ankete (TZ 4.4, 4.7): feed React Query, swipe cu gesturi+butoane, undo, mesaj la like. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
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
import { fetchFeed, swipe, undoSwipe } from '@/features/feed/feedApi';
import { MatchModal } from '@/features/feed/MatchModal';
import { ProfileCard } from '@/features/feed/ProfileCard';
import { SendFirstMessageSheet } from '@/features/feed/SendFirstMessageSheet';
import { FeedCard, SwipeAction } from '@/features/feed/types';
import { StoriesBar } from '@/features/stories/StoriesBar';
import { useTheme } from '@theme/index';

const SCREEN_WIDTH = Dimensions.get('window').width;
/** Distanța (px) de la care un drag orizontal se consideră swipe. */
const SWIPE_THRESHOLD = 110;

export default function AnketeScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery<FeedCard[]>({
    queryKey: ['feed'],
    queryFn: fetchFeed,
  });

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchName, setMatchName] = useState<string | null>(null);
  const [matchChatId, setMatchChatId] = useState<string | null>(null);
  // Cardul pentru care s-a dat like și așteaptă alegerea din sheet (mesaj / doar like).
  const [pendingLike, setPendingLike] = useState<FeedCard | null>(null);
  // Câte swipe-uri s-au făcut în sesiune (pentru activarea butonului de undo).
  const [swipeCount, setSwipeCount] = useState(0);

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

  const performSwipe = async (card: FeedCard, action: SwipeAction, message?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await swipe(card.userId, action, message);
      if (result.matched) {
        setMatchName(card.name);
        setMatchChatId(result.chatId ?? null);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }
      setSwipeCount((c) => c + 1);
      setIndex((i) => i + 1);
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

  const requestDislike = () => {
    if (!current || busy) return;
    performSwipe(current, 'dislike');
  };

  // Menținem cea mai recentă logică de release într-un ref (PanResponder e creat o singură dată).
  const onSwipeReleaseRef = useRef<(direction: 'left' | 'right') => void>(() => {});
  onSwipeReleaseRef.current = (direction) => {
    if (!current || busy) {
      resetCardPosition();
      return;
    }
    if (direction === 'right') {
      // Like: readucem cardul în centru și deschidem sheet-ul.
      resetCardPosition();
      requestLike();
    } else {
      // Dislike: aruncăm cardul în afara ecranului, apoi confirmăm.
      Animated.timing(position, {
        toValue: { x: -SCREEN_WIDTH * 1.5, y: 0 },
        duration: 200,
        useNativeDriver: false,
      }).start(() => performSwipe(current, 'dislike'));
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_evt, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy });
      },
      onPanResponderRelease: (_evt, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          onSwipeReleaseRef.current('right');
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          onSwipeReleaseRef.current('left');
        } else {
          resetCardPosition();
        }
      },
      onPanResponderTerminate: () => resetCardPosition(),
    }),
  ).current;

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
    try {
      const result = await undoSwipe();
      if (result.undone) {
        setSwipeCount((c) => Math.max(0, c - 1));
        setIndex((i) => Math.max(0, i - 1));
        position.setValue({ x: 0, y: 0 });
        await refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  const closeMatch = () => {
    setMatchName(null);
    setMatchChatId(null);
  };

  const onWriteMessage = () => {
    const chatId = matchChatId;
    closeMatch();
    if (chatId) router.push(`/chat/${chatId}`);
  };

  const reloadDeck = () => {
    setIndex(0);
    refetch();
  };

  // Indicii vizuale LIKE / NOPE în funcție de direcția drag-ului.
  const likeOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const nopeOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-8deg', '0deg', '8deg'],
  });

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
        </View>

        {/* Match-ul poate apărea și pe ultimul card (deck golit după swipe). */}
        <MatchModal
          visible={matchName !== null}
          name={matchName ?? ''}
          onWriteMessage={onWriteMessage}
          onContinue={closeMatch}
        />
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
            pointerEvents="none"
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
            pointerEvents="none"
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
        </Animated.View>
      </View>

      <View style={[styles.actions, { marginTop: spacing.xl }]}>
        <Pressable
          testID="deck-undo"
          accessibilityRole="button"
          accessibilityLabel="Înapoi"
          disabled={busy || swipeCount === 0}
          onPress={onUndo}
          style={[
            styles.sideBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: swipeCount === 0 ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[styles.sideIcon, { color: colors.textSecondary }]}>↩</Text>
        </Pressable>

        <Pressable
          testID="swipe-dislike"
          accessibilityRole="button"
          accessibilityLabel="Nu-mi place"
          disabled={busy}
          onPress={requestDislike}
          style={[
            styles.actionBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.actionIcon, { color: colors.textSecondary }]}>✕</Text>
        </Pressable>

        <Pressable
          testID="swipe-like"
          accessibilityRole="button"
          accessibilityLabel="Îmi place"
          disabled={busy}
          onPress={requestLike}
          style={[
            styles.actionBtn,
            { backgroundColor: colors.accent, borderColor: colors.accent },
          ]}
        >
          <Text style={[styles.actionIcon, { color: colors.onAccent }]}>♥</Text>
        </Pressable>
      </View>

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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
  },
  animatedCard: {
    flex: 1,
  },
  cue: {
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {
    fontSize: 28,
    lineHeight: 32,
  },
  sideBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideIcon: {
    fontSize: 22,
    lineHeight: 26,
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
