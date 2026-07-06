/** Deck-ul de ankete (TZ 4): feed via React Query, swipe cu butoane, modal la match. */
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { fetchFeed, swipe } from '@/features/feed/feedApi';
import { MatchModal } from '@/features/feed/MatchModal';
import { ProfileCard } from '@/features/feed/ProfileCard';
import { FeedCard, SwipeAction } from '@/features/feed/types';
import { useTheme } from '@theme/index';

export default function AnketeScreen() {
  const { colors, typography, spacing } = useTheme();
  const { data, isLoading, isError, refetch } = useQuery<FeedCard[]>({
    queryKey: ['feed'],
    queryFn: fetchFeed,
  });

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [matchName, setMatchName] = useState<string | null>(null);

  const cards = data ?? [];
  const current = cards[index];

  const onSwipe = async (action: SwipeAction) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const result = await swipe(current.userId, action);
      if (result.matched) setMatchName(current.name);
      setIndex((i) => i + 1);
    } finally {
      setBusy(false);
    }
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
      <ScreenContainer center>
        <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
          Nu mai sunt ankete acum
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
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
        onWriteMessage={() => setMatchName(null)}
        onContinue={() => setMatchName(null)}
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
});
