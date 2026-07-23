/** Biletul Flirt Party (TZ secț. 6.3): cod one-time de acces + status. */
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BackButton, ScreenContainer } from '@/components/ui';
import { fetchTicket, Ticket } from '@/features/settings/settingsApi';
import { useTheme } from '@theme/index';

/** Rupe codul în grupuri de 4 (separate prin spații) ca să se încadreze pe
 * lățimea cardului și să nu iasă din ecran; spațiile dau și puncte de rupere. */
function formatCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join(' ');
}

export default function TicketScreen() {
  const { colors, typography, spacing, radius } = useTheme();

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

      <BackButton style={{ alignSelf: 'flex-start', marginBottom: spacing.lg }} />

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
        {/* Cod QR real, generat din codul biletului — se scanează la intrare. */}
        <View
          testID="ticket-qr"
          style={[
            styles.qr,
            {
              backgroundColor: '#ffffff',
              borderColor: colors.border,
              borderRadius: radius.md,
            },
          ]}
        >
          <QRCode
            value={data.code}
            size={168}
            color="#111111"
            backgroundColor="#ffffff"
          />
        </View>

        {/* Codul în clar, sub QR — pentru introducere manuală la intrare.
            Încadrat pe lățimea cardului și rupt în grupuri ca să nu iasă din ecran. */}
        <View style={styles.codeBox}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Cod bilet</Text>
          <Text style={[styles.code, { color: colors.textPrimary }]}>
            {formatCode(data.code)}
          </Text>
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
    width: 200,
    height: 200,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBox: {
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 4,
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 1,
    textAlign: 'center',
  },
  status: { alignItems: 'center' },
});
