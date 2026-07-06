/** Mesaje — placeholder: listă de match-uri (dacă există) sau mesaj gol. */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { CompatBadge } from '@/features/feed/CompatBadge';
import { fetchMatches } from '@/features/feed/feedApi';
import { MatchItem } from '@/features/feed/types';
import { useTheme } from '@theme/index';

export default function MesajeScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const { data, isLoading } = useQuery<MatchItem[]>({
    queryKey: ['matches'],
    queryFn: fetchMatches,
  });

  const matches = data ?? [];

  if (isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (matches.length === 0) {
    return (
      <ScreenContainer center>
        <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
          Mesajele apar aici după un match 💬
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.lg }]}>
        Mesaje
      </Text>
      <FlatList
        data={matches}
        keyExtractor={(m) => m.matchId}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <View
            style={[
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radius.md,
                padding: spacing.md,
              },
            ]}
          >
            <View style={styles.rowText}>
              <Text style={[typography.bodyStrong, { color: colors.textPrimary }]}>
                {item.name}, {item.age}
              </Text>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {item.city}
              </Text>
            </View>
            <CompatBadge score={item.compatibility} />
          </View>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  center: {
    textAlign: 'center',
  },
});
