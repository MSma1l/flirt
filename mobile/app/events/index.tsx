/** Listă de evenimente (TZ secț. 8): feed via React Query, card → detaliu, link către Flirt Passport. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { EventCard } from '@/features/events/EventCard';
import { fetchEvents } from '@/features/events/eventsApi';
import { EventItem } from '@/features/events/types';
import { useTheme } from '@theme/index';

export default function EventsScreen() {
  const router = useRouter();
  const { colors, typography, spacing } = useTheme();

  const { data, isLoading, isError, refetch } = useQuery<EventItem[]>({
    queryKey: ['events'],
    queryFn: fetchEvents,
  });

  const header = (
    <View style={styles.header}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Evenimente</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Deschide Flirt Passport"
        onPress={() => router.push('/passport')}
        hitSlop={spacing.sm}
      >
        <Text style={[typography.bodyStrong, { color: colors.accent }]}>Flirt Passport ›</Text>
      </Pressable>
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
          Nu am putut încărca evenimentele.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const events = data ?? [];

  return (
    <ScreenContainer>
      {header}

      {events.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Niciun eveniment momentan — revino curând!
          </Text>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1, marginTop: spacing.lg }}
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Deschide ${item.title}`}
              onPress={() => router.push(`/events/${item.id}`)}
            >
              <EventCard event={item} />
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
