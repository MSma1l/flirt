/** Deck-ul de ankete (TZ 4): feed via React Query, swipe cu butoane, modal la match. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { fetchFeed, swipe } from '@/features/feed/feedApi';
import { MatchModal } from '@/features/feed/MatchModal';
import { ProfileCard } from '@/features/feed/ProfileCard';
import { FeedCard, SwipeAction } from '@/features/feed/types';
import { StoriesBar } from '@/features/stories/StoriesBar';
import { useTheme } from '@theme/index';

export default function AnketeScreen() {
  const { colors, typography, spacing } = useTheme();
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

  const cards = data ?? [];
  const current = cards[index];

  // Când sosesc date noi (reîncărcare feed), pornim iar de la primul card.
  useEffect(() => {
    setIndex(0);
  }, [data]);

  const onSwipe = async (action: SwipeAction) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const result = await swipe(current.userId, action);
      if (result.matched) {
        setMatchName(current.name);
        setMatchChatId(result.chatId ?? null);
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }
      setIndex((i) => i + 1);
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
        <ProfileCard card={current} />
      </View>

      <View style={[styles.actions, { marginTop: spacing.xl }]}>
        <Pressable
          testID="swipe-dislike"
          accessibilityRole="button"
          accessibilityLabel="Nu-mi place"
          disabled={busy}
          onPress={() => onSwipe('dislike')}
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
          onPress={() => onSwipe('like')}
          style={[
            styles.actionBtn,
            { backgroundColor: colors.accent, borderColor: colors.accent },
          ]}
        >
          <Text style={[styles.actionIcon, { color: colors.onAccent }]}>♥</Text>
        </Pressable>
      </View>

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
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
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
  center: {
    textAlign: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
