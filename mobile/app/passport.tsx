/** Flirt Passport (TZ secț. 8): grid de ștampile primite la check-in-ul evenimentelor. */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { BackButton, Button, ScreenContainer } from '@/components/ui';
import { formatEventDate } from '@/features/events/EventCard';
import { fetchPassport } from '@/features/events/eventsApi';
import { PassportStamp } from '@/features/events/types';
import { fetchMySubscription } from '@/features/subscription/subscriptionApi';
import { Subscription } from '@/features/subscription/types';
import { useTheme } from '@theme/index';

/** Contorul „Card reduceri": câte intrări i-au rămas userului (doar pt. planurile card). */
function DiscountCard({ subscription }: { subscription: Subscription }) {
  const { colors, typography, radius, spacing } = useTheme();
  const { entriesTotal, entriesRemaining } = subscription;
  if (entriesRemaining == null) return null;

  return (
    <View
      testID="passport-discount-card"
      accessibilityRole="text"
      accessibilityLabel={`Card reduceri: ${entriesRemaining} din ${entriesTotal ?? entriesRemaining} intrări rămase`}
      style={[
        styles.discount,
        {
          backgroundColor: colors.accent,
          borderRadius: radius.card,
          padding: spacing.lg,
          gap: spacing.xs,
        },
      ]}
    >
      <Text style={[typography.badge, { color: colors.onAccent }]}>CARD REDUCERI</Text>
      <Text style={[typography.h2, { color: colors.onAccent }]}>
        {entriesRemaining} din {entriesTotal ?? entriesRemaining} intrări rămase
      </Text>
      <Text style={[typography.caption, { color: colors.onAccent }]}>
        Arată cardul la intrarea în evenimentele partenere.
      </Text>
    </View>
  );
}

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
  const { colors, typography, spacing } = useTheme();

  const { data, isLoading, isError, refetch } = useQuery<PassportStamp[]>({
    queryKey: ['passport'],
    queryFn: fetchPassport,
  });

  const { data: subscription } = useQuery<Subscription | null>({
    queryKey: ['subscription-me'],
    queryFn: fetchMySubscription,
  });

  const header = (
    <View style={styles.header}>
      <BackButton />
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Flirt Passport</Text>
    </View>
  );

  const discountSection =
    subscription && subscription.entriesRemaining != null ? (
      <View style={{ marginTop: spacing.lg }}>
        <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
          Reducerile mele
        </Text>
        <DiscountCard subscription={subscription} />
      </View>
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
        <View style={{ flex: 1 }}>
          {discountSection}
          <View style={styles.empty}>
            <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
              Încă nu ai ștampile — participă la un eveniment!
            </Text>
          </View>
        </View>
      ) : (
        <FlatList
          style={{ flex: 1 }}
          data={stamps}
          keyExtractor={(item) => item.eventId}
          numColumns={2}
          columnWrapperStyle={{ gap: spacing.md }}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.xl }}
          ListHeaderComponent={
            discountSection ? (
              <View style={{ marginBottom: spacing.md }}>{discountSection}</View>
            ) : (
              <View style={{ marginTop: spacing.lg }} />
            )
          }
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
  discount: { alignItems: 'flex-start' },
});
