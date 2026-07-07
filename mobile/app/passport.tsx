/** Flirt Passport (TZ secț. 8): grid de ștampile primite la check-in-ul evenimentelor. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { formatEventDate } from '@/features/events/EventCard';
import { fetchPassport } from '@/features/events/eventsApi';
import { PassportStamp } from '@/features/events/types';
import { useTheme } from '@theme/index';

/** O ștampilă din grid: titlu eveniment, oraș, dată. */
function StampCard({ stamp }: { stamp: PassportStamp }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Ștampilă ${stamp.eventTitle}`}
      style={[
        styles.stamp,
        {
          backgroundColor: colors.surface,
          borderColor: colors.accent,
          borderRadius: radius.card,
          padding: spacing.md,
        },
      ]}
    >
      <Text style={styles.icon}>🎫</Text>
      <Text
        numberOfLines={2}
        style={[typography.bodyStrong, { color: colors.textPrimary, marginTop: spacing.xs }]}
      >
        {stamp.eventTitle}
      </Text>
      <Text style={[typography.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {stamp.city}
      </Text>
      <Text style={[typography.caption, { color: colors.link, marginTop: spacing.xs }]}>
        {formatEventDate(stamp.stampedAt)}
      </Text>
    </View>
  );
}

export default function PassportScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();

  const { data, isLoading, isError, refetch } = useQuery<PassportStamp[]>({
    queryKey: ['passport'],
    queryFn: fetchPassport,
  });

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Înapoi"
        onPress={() => router.back()}
        hitSlop={spacing.sm}
      >
        <Text style={[typography.h2, { color: colors.accent }]}>‹</Text>
      </Pressable>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Flirt Passport</Text>
    </View>
  );

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
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          Nu am putut încărca Flirt Passport.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const stamps = data ?? [];

  return (
    <ScreenContainer>
      {header}

      {stamps.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Încă nu ai ștampile — participă la un eveniment!
          </Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1, marginTop: spacing.lg }}
          data={stamps}
          keyExtractor={(item) => item.eventId}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          renderItem={({ item }) => <StampCard stamp={item} />}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stamp: {
    flex: 1,
    borderWidth: 1,
  },
  icon: { fontSize: 28, lineHeight: 32 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
