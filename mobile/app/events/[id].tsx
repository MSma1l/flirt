/** Detaliu eveniment (TZ secț. 8): info, hartă placeholder, toggle participare, check-in QR → ștampilă. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { formatEventDate, kindColor, kindLabel } from '@/features/events/EventCard';
import { EventMap } from '@/features/events/EventMap';
import { checkin, fetchEvent, setGoing } from '@/features/events/eventsApi';
import { EventItem } from '@/features/events/types';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

export default function EventDetailScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Array.isArray(id) ? id[0] : id;

  const [stampMessage, setStampMessage] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId),
    enabled: !!eventId,
  });

  const goingMutation = useMutation({
    mutationFn: (going: boolean) => setGoing(eventId, going),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: () => {
      alertMessage('Ceva n-a mers', 'Nu am putut actualiza participarea. Reîncearcă.');
    },
  });

  const checkinMutation = useMutation({
    mutationFn: () => checkin(eventId),
    onSuccess: () => {
      setStampMessage('Ai primit o ștampilă Flirt Passport 🎉');
      queryClient.invalidateQueries({ queryKey: ['passport'] });
    },
    onError: () => {
      alertMessage('Check-in eșuat', 'Nu am putut face check-in-ul. Reîncearcă.');
    },
  });

  const back = (
    <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Înapoi"
        onPress={() => router.back()}
        hitSlop={spacing.sm}
      >
        <Text style={[typography.h2, { color: colors.accent }]}>‹</Text>
      </Pressable>
    </View>
  );

  const renderBody = () => {
    if (isLoading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      );
    }

    if (isError || !data) {
      return (
        <View style={styles.center}>
          <Text
            style={[
              typography.body,
              styles.textCenter,
              { color: colors.textSecondary, marginBottom: spacing.lg },
            ]}
          >
            Nu am putut încărca evenimentul.
          </Text>
          <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
        </View>
      );
    }

    const cover = kindColor(data.kind, colors);

    return (
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}>
        <View
          style={[
            styles.pill,
            {
              backgroundColor: cover,
              borderRadius: radius.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
            },
          ]}
        >
          <Text style={[typography.badge, { color: colors.onAccent }]}>
            {kindLabel(data.kind)}
          </Text>
        </View>

        <Text style={[typography.display, { color: colors.textPrimary }]}>{data.title}</Text>

        <Text style={[typography.bodyStrong, { color: colors.link }]}>
          {formatEventDate(data.startsAt)}
        </Text>

        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {data.venue} · {data.city}
        </Text>

        {data.description ? (
          <Text style={[typography.body, { color: colors.textPrimary, marginTop: spacing.sm }]}>
            {data.description}
          </Text>
        ) : null}

        {/* Hartă reală (OpenStreetMap prin Leaflet într-un WebView); fără coordonate → caseta cu orașul */}
        <View style={{ marginTop: spacing.sm }}>
          <EventMap lat={data.lat} lng={data.lng} title={data.title} city={data.city} />
        </View>

        <Text style={[typography.body, { color: colors.link, marginTop: spacing.sm }]}>
          {data.attendeeCount} participanți
        </Text>

        <Button
          label={data.iAmGoing ? 'Nu mai merg' : 'Merg'}
          variant={data.iAmGoing ? 'outline' : 'primary'}
          loading={goingMutation.isPending}
          onPress={() => goingMutation.mutate(!data.iAmGoing)}
          style={{ marginTop: spacing.md }}
        />

        <Button
          label="Check-in (QR)"
          variant="outline"
          loading={checkinMutation.isPending}
          onPress={() => checkinMutation.mutate()}
        />

        {stampMessage ? (
          <Text
            accessibilityRole="text"
            style={[
              typography.bodyStrong,
              styles.textCenter,
              { color: colors.success, marginTop: spacing.sm },
            ]}
          >
            {stampMessage}
          </Text>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      {back}
      {renderBody()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  textCenter: { textAlign: 'center' },
  pill: { alignSelf: 'flex-start' },
});
