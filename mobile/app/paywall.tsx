/**
 * Abonamente / Paywall (TZ secț. 9): listează planurile disponibile, marchează
 * planul activ cu un badge, iar „Alege" activează abonamentul prin backend.
 *
 * Cerințe App Store Guideline 3.1.2, obligatorii pe ecranul de abonament:
 * durata + prețul pe perioadă, „Restaurează achizițiile", linkuri către
 * Termeni (EULA) și Politica de confidențialitate. Niciun nume de provider de
 * plăți nu apare în UI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import {
  fetchEntitlements,
  fetchMySubscription,
  fetchPlans,
  purchase,
} from '@/features/subscription/subscriptionApi';
import { Plan, Subscription } from '@/features/subscription/types';
import { useTheme } from '@theme/index';

export default function PaywallScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, radius, spacing } = useTheme();

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: fetchPlans,
  });

  const meQuery = useQuery<Subscription | null>({
    queryKey: ['subscription-me'],
    queryFn: fetchMySubscription,
  });

  const purchaseMutation = useMutation({
    mutationFn: (plan: string) => purchase(plan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-me'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-entitlements'] });
    },
  });

  // „Restaurează achizițiile": recitește drepturile contului și resincronizează
  // abonamentul afișat (Guideline 3.1.2 — restaurare fără plată nouă).
  const restoreMutation = useMutation({
    mutationFn: fetchEntitlements,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription-me'] });
      queryClient.invalidateQueries({ queryKey: ['subscription-entitlements'] });
      meQuery.refetch();
    },
  });

  /** Deschide un document legal în browser (URL-uri din config, nu hardcodate). */
  const openLink = (url: string) => {
    Linking.openURL(url).catch(() => {
      /* dacă browserul nu poate fi deschis, ecranul rămâne funcțional */
    });
  };

  const header = (
    <View style={[styles.headerRow, { marginBottom: spacing.lg }]}>
      <Text style={[typography.h1, { color: colors.textPrimary }]}>Abonamente</Text>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Închide"
        testID="paywall-close"
        hitSlop={12}
      >
        <Text style={[typography.h2, { color: colors.textSecondary }]}>✕</Text>
      </Pressable>
    </View>
  );

  if (plansQuery.isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (plansQuery.isError || !plansQuery.data) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          Nu am putut încărca abonamentele.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => plansQuery.refetch()} />
      </ScreenContainer>
    );
  }

  const plans = plansQuery.data;
  const currentPlan = meQuery.data?.plan ?? null;

  return (
    <ScreenContainer>
      {header}

      {purchaseMutation.isSuccess ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: colors.tagBg,
              borderColor: colors.accent,
              borderRadius: radius.md,
              padding: spacing.md,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.bodyStrong, { color: colors.textPrimary }]} testID="paywall-success">
            Abonament activat 🎉
          </Text>
        </View>
      ) : purchaseMutation.isError ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: colors.surface,
              borderColor: colors.danger,
              borderRadius: radius.md,
              padding: spacing.md,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.body, { color: colors.danger }]}>
            Nu am putut activa abonamentul. Reîncearcă.
          </Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {plans.map((plan: Plan) => {
          const isActive = plan.code === currentPlan;
          const isPending =
            purchaseMutation.isPending && purchaseMutation.variables === plan.code;
          return (
            <View
              key={plan.code}
              testID={`plan-${plan.code}`}
              style={[
                styles.card,
                {
                  backgroundColor: colors.surface,
                  borderColor: isActive ? colors.accent : colors.border,
                  borderRadius: radius.card,
                  padding: spacing.xl,
                  gap: spacing.md,
                },
              ]}
            >
              <View style={styles.cardHead}>
                <Text style={[typography.h2, styles.flex1, { color: colors.textPrimary }]}>
                  {plan.title}
                </Text>
                {isActive ? (
                  <View
                    testID={`plan-${plan.code}-active`}
                    style={[
                      styles.badge,
                      {
                        backgroundColor: colors.accent,
                        borderRadius: radius.pill,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.xs,
                      },
                    ]}
                  >
                    <Text style={[typography.badge, { color: colors.onAccent }]}>Activ</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[typography.h1, { color: colors.accent }]}>
                {plan.priceEur} € / lună
              </Text>

              <View style={{ gap: spacing.sm }}>
                {plan.features.map((feature: string) => (
                  <View key={feature} style={styles.featureRow}>
                    <Text style={[typography.bodyStrong, { color: colors.success }]}>✓</Text>
                    <Text style={[typography.body, styles.flex1, { color: colors.textSecondary }]}>
                      {feature}
                    </Text>
                  </View>
                ))}
              </View>

              <Button
                label={isActive ? 'Plan activ' : 'Alege'}
                variant={isActive ? 'outline' : 'primary'}
                disabled={isActive}
                loading={isPending}
                onPress={() => purchaseMutation.mutate(plan.code)}
                testID={`plan-${plan.code}-choose`}
              />
            </View>
          );
        })}

        {/* Restaurarea achizițiilor — obligatorie pentru abonamente. */}
        <Button
          label="Restaurează achizițiile"
          variant="ghost"
          loading={restoreMutation.isPending}
          onPress={() => restoreMutation.mutate()}
          testID="paywall-restore"
        />

        {restoreMutation.isSuccess ? (
          <Text
            testID="paywall-restore-done"
            style={[typography.caption, styles.center, { color: colors.success }]}
          >
            Achizițiile au fost restaurate.
          </Text>
        ) : restoreMutation.isError ? (
          <Text
            testID="paywall-restore-error"
            style={[typography.caption, styles.center, { color: colors.danger }]}
          >
            Nu am putut restaura achizițiile. Reîncearcă.
          </Text>
        ) : null}

        {/* Condițiile abonamentului + linkuri legale (Guideline 3.1.2). */}
        <Text
          style={[
            typography.caption,
            styles.center,
            { color: colors.textDisabled, marginTop: spacing.sm },
          ]}
        >
          Abonamentul se reînnoiește automat lunar, la prețul afișat, dacă nu îl anulezi
          cu cel puțin 24 de ore înainte de finalul perioadei curente. Îl poți gestiona
          sau anula oricând din setările contului tău.
        </Text>

        <View style={[styles.legalRow, { gap: spacing.lg }]}>
          <Text
            testID="paywall-terms-link"
            style={[typography.caption, { color: colors.link }]}
            onPress={() => openLink(config.legal.termsUrl)}
          >
            Termeni și condiții
          </Text>
          <Text
            testID="paywall-privacy-link"
            style={[typography.caption, { color: colors.link }]}
            onPress={() => openLink(config.legal.privacyUrl)}
          >
            Politica de confidențialitate
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  center: { textAlign: 'center' },
  flex1: { flex: 1 },
  banner: { borderWidth: 1 },
  card: { borderWidth: 1.5 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { alignSelf: 'flex-start' },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' },
});
