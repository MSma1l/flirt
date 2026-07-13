/** Biletul Flirt Party (TZ secț. 6.3): cod one-time de acces + status. */
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '@/components/ui';
import { fetchTicket, Ticket } from '@/features/settings/settingsApi';
import { useTheme } from '@theme/index';

export default function TicketScreen() {
  const { colors, typography, spacing, radius } = useTheme();
  const router = useRouter();

  const { data, isLoading, isError, refetch } = useQuery<Ticket>({
    queryKey: ['ticket'],
    queryFn: fetchTicket,
  });

  if (isLoading) {
    return (
      <ScreenContainer center>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (isError || !data) {
    return (
      <ScreenContainer center>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={[typography.body, styles.center, { color: colors.danger }]}>
          Nu am putut încărca biletul.
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[
            typography.bodyStrong,
            styles.center,
            { color: colors.accent, marginTop: spacing.md },
          ]}
        >
          Reîncearcă
        </Text>
      </ScreenContainer>
    );
  }

  const used = data.used;

  return (
    <ScreenContainer>
      <Stack.Screen options={{ headerShown: false }} />

      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{ marginBottom: spacing.lg }}
      >
        <Text style={[typography.bodyStrong, { color: colors.accent }]}>‹ Înapoi</Text>
      </Pressable>

      <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.xs }]}>
        Biletul meu Flirt Party
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary, marginBottom: spacing.xl }]}>
        Prezintă acest bilet la intrare. Este valabil o singură dată.
      </Text>

      <View
        testID="ticket-card"
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.card,
            padding: spacing.xl,
            gap: spacing.lg,
          },
        ]}
      >
        {/* Codul de acces, afișat mare, într-un cadru — se prezintă la intrare. */}
        <View
          testID="ticket-qr"
          style={[
            styles.qr,
            {
              backgroundColor: colors.bg,
              borderColor: colors.textPrimary,
              borderRadius: radius.md,
            },
          ]}
        >
          <Text style={[typography.badge, { color: colors.textSecondary }]}>
            Cod de acces
          </Text>
          <Text
            style={[
              typography.badge,
              styles.qrCode,
              { color: colors.textPrimary, marginTop: spacing.sm },
            ]}
          >
            {data.code}
          </Text>
        </View>

        <View style={{ gap: spacing.xs, alignItems: 'center' }}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Cod bilet</Text>
          <Text style={[styles.code, { color: colors.textPrimary }]}>{data.code}</Text>
        </View>

        <View
          style={[
            styles.status,
            {
              backgroundColor: used ? colors.tagBg : colors.surfaceHover,
              borderRadius: radius.pill,
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
            },
          ]}
        >
          <Text
            style={[typography.badge, { color: used ? colors.danger : colors.success }]}
          >
            {used ? 'FOLOSIT' : 'NEFOLOSIT'}
          </Text>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  card: { alignItems: 'center' },
  qr: {
    width: 180,
    height: 180,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCode: {
    fontFamily: 'Courier',
    letterSpacing: 2,
    textAlign: 'center',
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: 4,
    textAlign: 'center',
  },
  status: { alignItems: 'center' },
});
