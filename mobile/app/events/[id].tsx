/** Detaliu eveniment (TZ secț. 8): info, hartă placeholder, toggle participare, check-in QR → ștampilă. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackButton, Button } from '@/components/ui';
import { formatEventDate, kindColor, kindLabel } from '@/features/events/EventCard';
import { EventMap } from '@/features/events/EventMap';
import { checkin, fetchEvent, setGoing } from '@/features/events/eventsApi';
import { EventItem } from '@/features/events/types';
import { createTicketOrder, fetchMyTicketOrders } from '@/features/tickets/ticketsApi';
import { TicketOrder } from '@/features/tickets/types';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

/** Prioritatea comenzilor pentru același eveniment: cea mai „vie" prima. */
const ORDER_RANK: Record<TicketOrder['status'], number> = {
  approved: 0,
  payment_declared: 1,
  awaiting_payment: 2,
  rejected: 3,
};

export default function EventDetailScreen() {
  const { t } = useTranslation('events');
  const { colors, typography, spacing, radius } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Array.isArray(id) ? id[0] : id;

  const [stampMessage, setStampMessage] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<EventItem>({
    queryKey: ['event', eventId],
    queryFn: () => fetchEvent(eventId),
    enabled: !!eventId,
  });

  const { data: myOrders } = useQuery<TicketOrder[]>({
    queryKey: ['ticket-orders'],
    queryFn: fetchMyTicketOrders,
  });

  // Comanda de bilet cea mai relevantă pentru acest eveniment (dacă există).
  const myOrder = useMemo<TicketOrder | null>(() => {
    const forEvent = (myOrders ?? []).filter((o) => o.eventId === eventId);
    return [...forEvent].sort((a, b) => ORDER_RANK[a.status] - ORDER_RANK[b.status])[0] ?? null;
  }, [myOrders, eventId]);

  const buyMutation = useMutation({
    mutationFn: () => createTicketOrder(eventId),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      router.push(`/tickets/${result.order.id}`);
    },
    onError: () => {
      alertMessage(t('detail.errorTitle'), t('detail.createOrderError'));
    },
  });

  const goingMutation = useMutation({
    mutationFn: (going: boolean) => setGoing(eventId, going),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event', eventId] });
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: () => {
      alertMessage(t('detail.errorTitle'), t('detail.goingError'));
    },
  });

  const checkinMutation = useMutation({
    mutationFn: () => checkin(eventId),
    onSuccess: () => {
      setStampMessage(t('detail.stamp'));
      queryClient.invalidateQueries({ queryKey: ['passport'] });
    },
    onError: () => {
      alertMessage(t('detail.checkinErrorTitle'), t('detail.checkinError'));
    },
  });

  const back = (
    <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
      <BackButton />
    </View>
  );

  /** Secțiunea de bilet online: buton de cumpărare sau starea comenzii existente. */
  const renderTicketSection = (event: EventItem) => {
    // Comandă activă (nu respinsă) → arată starea și trimite la ecranul comenzii.
    if (myOrder && myOrder.status !== 'rejected') {
      const label =
        myOrder.status === 'approved'
          ? t('detail.ticketStatus.approved')
          : myOrder.status === 'payment_declared'
            ? t('detail.ticketStatus.declared')
            : t('detail.ticketStatus.awaiting');
      const cta =
        myOrder.status === 'approved'
          ? t('detail.ticketCta.approved')
          : myOrder.status === 'payment_declared'
            ? t('detail.ticketCta.declared')
            : t('detail.ticketCta.awaiting');
      const color = myOrder.status === 'approved' ? colors.success : colors.warning;
      return (
        <View
          testID="ticket-status"
          style={[
            styles.ticketCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.card,
              padding: spacing.lg,
              gap: spacing.sm,
              marginTop: spacing.sm,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color }]}>{label}</Text>
          <Button label={cta} onPress={() => router.push(`/tickets/${myOrder.id}`)} />
        </View>
      );
    }

    // Fără comandă activă, dar evenimentul vinde bilete → buton de cumpărare.
    if (event.ticketPrice != null) {
      const currency = event.ticketCurrency ?? 'lei';
      return (
        <Button
          label={t('detail.buyTicket', { price: event.ticketPrice, currency })}
          testID="buy-ticket-btn"
          loading={buyMutation.isPending}
          onPress={() => buyMutation.mutate()}
          style={{ marginTop: spacing.sm }}
        />
      );
    }

    return null;
  };

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
            {t('detail.loadError')}
          </Text>
          <Button label={t('detail.retry')} variant="outline" onPress={() => refetch()} />
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

        {data.promoDiscountPercent != null && data.promoCode ? (
          <View
            testID="event-promo"
            accessibilityRole="text"
            accessibilityLabel={t('detail.promo.a11yLabel', {
              percent: data.promoDiscountPercent,
              code: data.promoCode,
            })}
            style={[
              styles.promo,
              {
                backgroundColor: colors.accent,
                borderRadius: radius.card,
                padding: spacing.lg,
                marginTop: spacing.sm,
                gap: spacing.xs,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.onAccent }]}>
              {t('detail.promo.discount', { percent: data.promoDiscountPercent })}
            </Text>
            <Text
              testID="event-promo-code"
              accessibilityLabel={t('detail.promo.a11yCode', { code: data.promoCode })}
              style={[typography.display, { color: colors.onAccent }]}
            >
              {data.promoCode}
            </Text>
            {data.promoDescription ? (
              <Text style={[typography.body, { color: colors.onAccent }]}>
                {data.promoDescription}
              </Text>
            ) : null}
            {data.iAmGoing ? (
              <Text style={[typography.caption, { color: colors.onAccent }]}>
                {t('detail.promo.showAtEntrance')}
              </Text>
            ) : null}
          </View>
        ) : null}

        {renderTicketSection(data)}

        {/* Hartă reală (OpenStreetMap prin Leaflet într-un WebView); fără coordonate → caseta cu orașul */}
        <View style={{ marginTop: spacing.sm }}>
          <EventMap lat={data.lat} lng={data.lng} title={data.title} city={data.city} />
        </View>

        <Text style={[typography.body, { color: colors.link, marginTop: spacing.sm }]}>
          {t('detail.attendees', { n: data.attendeeCount })}
        </Text>

        <Button
          label={data.iAmGoing ? t('detail.notGoing') : t('detail.going')}
          variant={data.iAmGoing ? 'outline' : 'primary'}
          loading={goingMutation.isPending}
          onPress={() => goingMutation.mutate(!data.iAmGoing)}
          style={{ marginTop: spacing.md }}
        />

        <Button
          label={t('detail.checkin')}
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
  promo: { alignItems: 'flex-start' },
  ticketCard: { alignItems: 'stretch' },
});
