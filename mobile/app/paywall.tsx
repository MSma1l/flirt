/**
 * Abonamente / Paywall (TZ secț. 9): listează planurile din catalogul backend-ului,
 * cu PREȚURILE REALE aduse din magazin, și le cumpără prin In-App Purchase nativ.
 *
 * Guideline 3.1.1: plata trece exclusiv prin App Store / Play — ecranul nu
 * cunoaște niciun alt provider. Guideline 3.1.2, obligatoriu aici: durata +
 * prețul pe perioadă (prețul afișat = cel din magazin, nu unul din cod),
 * „Restaurează achizițiile", linkuri către Termeni (EULA) și Confidențialitate.
 *
 * Toată logica de achiziție (ordinea confirmare-backend → finishTransaction,
 * anulări, tranzacții rămase) stă în `@/features/billing/iap` — ecranul doar o
 * comandă și traduce rezultatul în UI.
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
  IapError,
  PurchaseOutcome,
  RestoreResult,
  StoreCatalog,
  fetchStoreCatalog,
  purchasePlan,
  restore,
  resumeUnfinishedPurchases,
} from '@/features/billing/iap';
import { fetchMySubscription, fetchPlans, purchase } from '@/features/subscription/subscriptionApi';
import { Plan, Subscription } from '@/features/subscription/types';
import { useTheme } from '@theme/index';

/** Un plan cu preț > 0 se vinde OBLIGATORIU prin magazin (nu prin API direct). */
function productIdOf(plan: Plan): string | undefined {
  return config.iap.productIds[plan.code];
}

export default function PaywallScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, radius, spacing } = useTheme();

  const refreshSubscription = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['subscription-me'] });
    queryClient.invalidateQueries({ queryKey: ['subscription-entitlements'] });
  }, [queryClient]);

  const plansQuery = useQuery<Plan[]>({
    queryKey: ['plans'],
    queryFn: fetchPlans,
  });

  const meQuery = useQuery<Subscription | null>({
    queryKey: ['subscription-me'],
    queryFn: fetchMySubscription,
  });

  // Prețurile vin din magazin, nu din backend: Apple cere ca suma afișată să fie
  // exact cea din App Store Connect, localizată în moneda userului.
  const storeQuery = useQuery<StoreCatalog>({
    queryKey: ['iap-catalog'],
    queryFn: fetchStoreCatalog,
    retry: false,
  });

  // Plasa de siguranță: dacă o achiziție anterioară a rămas neconfirmată (backend
  // picat, aplicație închisă în timpul plății, Ask to Buy aprobat între timp), o
  // ducem la capăt acum. Fără asta, userul ar fi plătit fără să primească nimic.
  React.useEffect(() => {
    resumeUnfinishedPurchases()
      .then((plans) => {
        if (plans.length > 0) refreshSubscription();
      })
      .catch(() => {
        /* magazin indisponibil — `storeQuery` afișează deja avertismentul */
      });
  }, [refreshSubscription]);

  const purchaseMutation = useMutation<PurchaseOutcome, unknown, Plan>({
    mutationFn: async (plan: Plan) => {
      // Planurile fără produs în magazin (ex. cel gratuit) nu implică plată:
      // se activează direct la backend, fără dovadă de la Apple.
      if (!productIdOf(plan)) {
        const subscription = await purchase(plan.code);
        return { status: 'active', plan: plan.code, subscription };
      }
      return purchasePlan(plan.code);
    },
    onSuccess: refreshSubscription,
  });

  const restoreMutation = useMutation<RestoreResult>({
    mutationFn: restore,
    onSuccess: () => {
      refreshSubscription();
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

  if (plansQuery.isLoading || storeQuery.isLoading) {
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
  const storeProducts = storeQuery.data?.products ?? [];

  // Magazinul e mut (conexiune eșuată) sau nu cunoaște unele produse: o spunem
  // pe față. Un card fără preț și cu buton inert e respins pe Guideline 2.1.
  const storeUnavailable = storeQuery.isError;
  const missingPlans = storeQuery.data?.missingPlans ?? [];

  const outcome = purchaseMutation.data;
  const purchaseError = purchaseMutation.error;
  // Anularea NU e o eroare: userul a închis foaia de plată intenționat.
  const errorMessage =
    purchaseError instanceof IapError
      ? purchaseError.kind === 'cancelled'
        ? null
        : purchaseError.message
      : purchaseError
        ? 'Nu am putut activa abonamentul. Reîncearcă.'
        : null;

  return (
    <ScreenContainer>
      {header}

      {outcome?.status === 'active' ? (
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
          <Text
            style={[typography.bodyStrong, { color: colors.textPrimary }]}
            testID="paywall-success"
          >
            Abonament activat 🎉
          </Text>
        </View>
      ) : outcome?.status === 'pending' ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: colors.surface,
              borderColor: colors.accent,
              borderRadius: radius.md,
              padding: spacing.md,
              marginBottom: spacing.lg,
            },
          ]}
        >
          <Text style={[typography.body, { color: colors.textPrimary }]} testID="paywall-pending">
            Achiziția este în așteptarea aprobării. Abonamentul se activează singur imediat ce
            plata e confirmată.
          </Text>
        </View>
      ) : errorMessage ? (
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
          <Text style={[typography.body, { color: colors.danger }]} testID="paywall-error">
            {errorMessage}
          </Text>
        </View>
      ) : null}

      {storeUnavailable || missingPlans.length > 0 ? (
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
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            testID="paywall-store-warning"
          >
            {storeUnavailable
              ? 'Nu am putut contacta magazinul, așa că abonamentele nu pot fi cumpărate acum. Verifică-ți conexiunea și reîncearcă.'
              : 'Unele planuri nu sunt disponibile în magazin momentan. Reîncearcă mai târziu.'}
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
            purchaseMutation.isPending && purchaseMutation.variables?.code === plan.code;

          const product = storeProducts.find((item) => item.plan === plan.code);
          const needsStore = productIdOf(plan) !== undefined;
          const unavailable = needsStore && !product;

          // Prețul afișat e cel al magazinului (localizat). Cel din catalogul
          // backend rămâne doar ca ultimă soluție, când magazinul e mut — caz în
          // care butonul e oricum dezactivat, deci nimeni nu cumpără la el.
          const priceLabel = product
            ? `${product.displayPrice} / lună`
            : `${plan.priceEur} € / lună`;

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

              <Text
                style={[typography.h1, { color: colors.accent }]}
                testID={`plan-${plan.code}-price`}
              >
                {priceLabel}
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

              {unavailable ? (
                <Text
                  testID={`plan-${plan.code}-unavailable`}
                  style={[typography.caption, { color: colors.danger }]}
                >
                  Indisponibil în magazin momentan.
                </Text>
              ) : null}

              <Button
                label={isActive ? 'Plan activ' : unavailable ? 'Indisponibil' : 'Alege'}
                variant={isActive || unavailable ? 'outline' : 'primary'}
                disabled={isActive || unavailable || purchaseMutation.isPending}
                loading={isPending}
                onPress={() => purchaseMutation.mutate(plan)}
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
          restoreMutation.data.restoredPlans.length > 0 ? (
            <Text
              testID="paywall-restore-done"
              style={[typography.caption, styles.center, { color: colors.success }]}
            >
              Achizițiile au fost restaurate.
            </Text>
          ) : (
            <Text
              testID="paywall-restore-empty"
              style={[typography.caption, styles.center, { color: colors.textSecondary }]}
            >
              Nu am găsit achiziții de restaurat pe acest cont.
            </Text>
          )
        ) : restoreMutation.isError ? (
          <Text
            testID="paywall-restore-error"
            style={[typography.caption, styles.center, { color: colors.danger }]}
          >
            {restoreMutation.error instanceof IapError
              ? restoreMutation.error.message
              : 'Nu am putut restaura achizițiile. Reîncearcă.'}
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
