/** Flirt Passport (TZ secț. 8): grid de ștampile primite la check-in-ul evenimentelor. */
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('profile');
  const { entriesTotal, entriesRemaining } = subscription;
  if (entriesRemaining == null) return null;

  // Numărul de intrări trece prin plural: româna are trei forme (1 intrare /
  // 3 intrări / 21 DE intrări), rusa patru. `count` e cel rămas — el e subiectul
  // frazei — iar totalul intră ca simplă interpolare.
  const entries = { count: entriesRemaining, total: entriesTotal ?? entriesRemaining };

  return (
    <View
      testID="passport-discount-card"
      accessibilityRole="text"
      accessibilityLabel={t('passport.discountCard.a11y', entries)}
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
      <Text style={[typography.badge, { color: colors.onAccent }]}>
        {t('passport.discountCard.badge')}
      </Text>
      <Text style={[typography.h2, { color: colors.onAccent }]}>
        {t('passport.discountCard.entriesLeft', entries)}
      </Text>
      <Text style={[typography.caption, { color: colors.onAccent }]}>
        {t('passport.discountCard.hint')}
      </Text>
    </View>
  );
}

/** O ștampilă din grid: titlu eveniment, oraș, dată. */
function StampCard({ stamp }: { stamp: PassportStamp }) {
  const { colors, typography, radius, spacing } = useTheme();
  const { t } = useTranslation('profile');
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t('passport.stamp', { event: stamp.eventTitle })}
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
  const { t } = useTranslation('profile');

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
      {/* Numele produsului NU se traduce — ca „FLIRT" sau „Flirt Party". */}
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Flirt Passport</Text>
    </View>
  );

  const discountSection =
    subscription && subscription.entriesRemaining != null ? (
      <View style={{ marginTop: spacing.lg }}>
        <Text style={[typography.h2, { color: colors.textPrimary, marginBottom: spacing.sm }]}>
          {t('passport.discountsTitle')}
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
          {t('passport.loadError')}
        </Text>
        <Button label={t('passport.retry')} variant="outline" onPress={() => refetch()} />
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
              {t('passport.empty')}
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
