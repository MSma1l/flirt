/**
 * Ecranul unei comenzi de bilet online (transfer bancar).
 *
 * Ghidează userul pe pași simpli, în funcție de starea comenzii:
 *  - `awaiting_payment` → instrucțiuni de plată (beneficiar, IBAN, sumă, referință,
 *    comentariul de copiat) + pași numerotați + butonul „Am făcut transferul".
 *  - `payment_declared` → mesaj „plata e în verificare".
 *  - `approved`         → biletul ca QR + codul în clar dedesubt.
 *  - `rejected`         → mesaj + buton de reîncercare (creează comandă nouă).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BackButton, Button } from '@/components/ui';
import {
  createTicketOrder,
  declareTicketPayment,
  fetchTicketOrder,
} from '@/features/tickets/ticketsApi';
import { PaymentInstructions, TicketOrderDetail } from '@/features/tickets/types';
import { alertMessage } from '@/utils/dialog';
import { useTheme } from '@theme/index';

/** Rupe codul în grupuri de 4 ca să se încadreze pe lățimea cardului (vezi app/ticket.tsx). */
function formatCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join(' ');
}

export default function TicketOrderScreen() {
  const { t } = useTranslation('social');
  const { colors, typography, spacing } = useTheme();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Array.isArray(id) ? id[0] : id;

  const { data, isLoading, isError, refetch } = useQuery<TicketOrderDetail>({
    queryKey: ['ticket-order', orderId],
    queryFn: () => fetchTicketOrder(orderId),
    enabled: !!orderId,
  });

  const declareMutation = useMutation({
    mutationFn: () => declareTicketPayment(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-order', orderId] });
    },
    onError: () => {
      alertMessage(t('ticket.errorTitle'), t('ticket.declareError'));
    },
  });

  const retryMutation = useMutation({
    mutationFn: () => {
      const eventId = data?.order.eventId;
      if (!eventId) throw new Error('missing event');
      return createTicketOrder(eventId);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-orders'] });
      router.replace(`/tickets/${result.order.id}`);
    },
    onError: () => {
      alertMessage(t('ticket.errorTitle'), t('ticket.retryError'));
    },
  });

  const back = (
    <View style={[styles.header, { paddingHorizontal: spacing.lg, paddingVertical: spacing.md }]}>
      <BackButton />
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
            {t('ticket.loadError')}
          </Text>
          <Button label={t('ticket.retry')} variant="outline" onPress={() => refetch()} />
        </View>
      );
    }

    const { order, payment } = data;

    return (
      <ScrollView contentContainerStyle={{ padding: spacing.xl, gap: spacing.md }}>
        {order.status === 'awaiting_payment' && payment ? (
          <AwaitingPayment
            payment={payment}
            declaring={declareMutation.isPending}
            onDeclare={() => declareMutation.mutate()}
          />
        ) : null}

        {order.status === 'awaiting_payment' && !payment ? (
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {t('ticket.instructionsUnavailable')}
          </Text>
        ) : null}

        {order.status === 'payment_declared' ? (
          <View testID="order-in-review" style={{ gap: spacing.sm }}>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('ticket.review.title')}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t('ticket.review.body')}
            </Text>
          </View>
        ) : null}

        {order.status === 'approved' && order.ticketCode ? (
          <Approved code={order.ticketCode} />
        ) : null}

        {order.status === 'rejected' ? (
          <View testID="order-rejected" style={{ gap: spacing.md }}>
            <Text style={[typography.h1, { color: colors.danger }]}>{t('ticket.rejected.title')}</Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t('ticket.rejected.body')}
            </Text>
            <Button
              label={t('ticket.rejected.retry')}
              loading={retryMutation.isPending}
              disabled={!order.eventId}
              onPress={() => retryMutation.mutate()}
            />
          </View>
        ) : null}
      </ScrollView>
    );
  };

  return (
    <View style={[styles.safe, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {back}
      {renderBody()}
    </View>
  );
}

/** Instrucțiunile de plată + pașii numerotați + butonul de declarare. */
function AwaitingPayment({
  payment,
  declaring,
  onDeclare,
}: {
  payment: PaymentInstructions;
  declaring: boolean;
  onDeclare: () => void;
}) {
  const { t } = useTranslation('social');
  const { colors, typography, spacing, radius } = useTheme();
  const amountLabel = `${payment.amount} ${payment.currency}`;

  const steps = [
    t('ticket.pay.step1'),
    t('ticket.pay.step2', {
      amount: amountLabel,
      beneficiary: payment.beneficiary,
      iban: payment.iban,
    }),
    t('ticket.pay.step3', { comment: payment.commentTemplate }),
    t('ticket.pay.step4'),
  ];

  return (
    <View testID="order-instructions" style={{ gap: spacing.md }}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('ticket.pay.title')}</Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('ticket.pay.intro')}
      </Text>

      {/* Datele de plată — text selectabil (expo-clipboard nu e instalat, deci fără buton de copiere). */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.card,
            padding: spacing.lg,
            gap: spacing.md,
          },
        ]}
      >
        <PayRow label={t('ticket.pay.beneficiary')} value={payment.beneficiary} />
        <PayRow label={t('ticket.pay.iban')} value={payment.iban} mono />
        <PayRow label={t('ticket.pay.bank')} value={payment.bankName} />
        <PayRow label={t('ticket.pay.amount')} value={amountLabel} testID="pay-amount" />
        <PayRow label={t('ticket.pay.reference')} value={payment.reference} mono />
        <PayRow label={t('ticket.pay.comment')} value={payment.commentTemplate} testID="pay-comment" />
      </View>

      {payment.instructions ? (
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {payment.instructions}
        </Text>
      ) : null}

      {/* Pași numerotați simpli. */}
      <View style={{ gap: spacing.sm }}>
        {steps.map((step, i) => (
          <View key={i} style={styles.step}>
            <View
              style={[
                styles.stepNum,
                { backgroundColor: colors.accent, borderRadius: radius.pill },
              ]}
            >
              <Text style={[typography.badge, { color: colors.onAccent }]}>{i + 1}</Text>
            </View>
            <Text style={[typography.body, styles.stepText, { color: colors.textPrimary }]}>
              {step}
            </Text>
          </View>
        ))}
      </View>

      <Button
        label={t('ticket.pay.declare')}
        loading={declaring}
        onPress={onDeclare}
        testID="declare-btn"
        style={{ marginTop: spacing.sm }}
      />
    </View>
  );
}

/** Un rând etichetă + valoare selectabilă. */
function PayRow({
  label,
  value,
  mono,
  testID,
}: {
  label: string;
  value: string;
  mono?: boolean;
  testID?: string;
}) {
  const { colors, typography } = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <Text
        testID={testID}
        selectable
        style={[
          mono ? styles.mono : typography.bodyStrong,
          { color: colors.textPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/** Biletul ca QR + codul în clar dedesubt (vezi app/ticket.tsx). */
function Approved({ code }: { code: string }) {
  const { t } = useTranslation('social');
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View testID="order-approved" style={{ gap: spacing.md }}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('ticket.approved.title')}</Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t('ticket.approved.body')}
      </Text>

      <View
        testID="order-qr"
        style={[
          styles.qrCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderRadius: radius.card,
            padding: spacing.xl,
            gap: spacing.lg,
          },
        ]}
      >
        <View
          style={[
            styles.qr,
            { backgroundColor: '#ffffff', borderColor: colors.border, borderRadius: radius.md },
          ]}
        >
          <QRCode value={code} size={168} color="#111111" backgroundColor="#ffffff" />
        </View>

        <View style={styles.codeBox}>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{t('ticket.approved.code')}</Text>
          <Text style={[styles.code, { color: colors.textPrimary }]}>{formatCode(code)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  textCenter: { textAlign: 'center' },
  card: {},
  mono: { fontFamily: 'Courier', fontSize: 15, lineHeight: 22, letterSpacing: 0.5 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNum: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
  qrCard: { alignItems: 'center' },
  qr: {
    width: 200,
    height: 200,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBox: { alignSelf: 'stretch', alignItems: 'center', gap: 4 },
  code: {
    fontFamily: 'Courier',
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 1,
    textAlign: 'center',
  },
});
