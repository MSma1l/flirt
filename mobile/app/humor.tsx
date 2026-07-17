/**
 * Test de umor (TZ secț. 2.7): arată carduri de glume pe rând, utilizatorul
 * marchează fiecare „amuzant" / „nu prea", iar la final se salvează profilul.
 *
 * Ecranul e OBLIGATORIU: userul ajunge aici automat după anketă și la orice
 * login în care `GET /humor/me` spune că vectorul lipsește (vezi `humorGate.ts`).
 * De aceea NU are buton de renunțare — dar nici nu are voie să fie o fundătură:
 * dacă quiz-ul nu se poate încărca, ecranul deschide singur poarta pentru sesiunea
 * curentă, ca userul să intre totuși în aplicație.
 *
 * Limba: DOUĂ surse diferite, ambele cu fallback pe română.
 *  - textul glumei vine de la server (`text_ro/ru/uk/en`) → `cardText.ts`;
 *  - restul ecranului (titlu, butoane, erori) vine din catalogul `humor` → `t()`.
 * Glumele NU se pun în cataloage: sunt conținut de la server, ca etichetele de la
 * `/profiles/reference`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, ProgressDots, ScreenContainer } from '@/components/ui';
import { cardText } from '@/features/humor/cardText';
import { fetchQuiz, submitQuiz } from '@/features/humor/humorApi';
import { HUMOR_ME_QUERY_KEY, useHumorGateStore } from '@/features/humor/humorGate';
import { HumorAnswer, HumorCard, HumorProfile } from '@/features/humor/types';
import { useLanguage } from '@/i18n/useLanguage';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

/** Unde pleacă userul când a terminat (sau când quiz-ul e indisponibil). */
const AFTER_QUIZ_ROUTE = '/(tabs)/ankete' as const;

export default function HumorScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, radius, spacing } = useTheme();
  const { t } = useTranslation('humor');
  const { current: language } = useLanguage();

  const userId = useAuthStore((s) => s.user?.id);
  const markUnavailable = useHumorGateStore((s) => s.markUnavailable);

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<HumorAnswer[]>([]);

  const { data, isLoading, isError, refetch } = useQuery<HumorCard[]>({
    queryKey: ['humor-quiz'],
    queryFn: fetchQuiz,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: HumorAnswer[]) => submitQuiz(payload),
    onSuccess: (profile: HumorProfile) => {
      // Poarta citește aceeași cheie: punându-i rezultatul proaspăt, `AuthGuard`
      // vede imediat vectorul plin și nu ne mai trimite înapoi la quiz. Fără asta
      // ar apărea exact bucla quiz → feed → guard → quiz.
      queryClient.setQueryData(HUMOR_ME_QUERY_KEY, profile);
    },
  });

  /**
   * Supapa: quiz-ul nu se poate face (server căzut sau zero carduri). Deschidem
   * poarta pentru sesiunea curentă și lăsăm userul în aplicație — un test
   * obligatoriu care se sparge la o eroare de rețea ar deveni un zid. La
   * următoarea pornire i se cere din nou.
   */
  const continueWithoutQuiz = () => {
    if (userId) markUnavailable(userId);
    router.replace(AFTER_QUIZ_ROUTE);
  };

  const header = (
    <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('quiz.title')}</Text>
  );

  if (isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
      </ScreenContainer>
    );
  }

  if (isError || !data) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          {t('quiz.loadError')}
        </Text>
        <View style={{ gap: spacing.md }}>
          <Button label={t('quiz.retry')} variant="outline" onPress={() => refetch()} />
          <Button
            label={t('quiz.continueAnyway')}
            variant="ghost"
            onPress={continueWithoutQuiz}
            testID="humor-continue-anyway"
          />
        </View>
      </ScreenContainer>
    );
  }

  const cards = data;

  if (cards.length === 0) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginBottom: spacing.lg },
          ]}
        >
          {t('quiz.empty')}
        </Text>
        <Button
          label={t('quiz.continueAnyway')}
          onPress={continueWithoutQuiz}
          testID="humor-continue-anyway"
        />
      </ScreenContainer>
    );
  }

  // După ce se salvează profilul, arătăm mesajul de confirmare.
  if (submitMutation.isSuccess) {
    return (
      <ScreenContainer center>
        <Text style={styles.emoji}>🎭</Text>
        <Text
          style={[
            typography.h2,
            styles.center,
            { color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.xl },
          ]}
        >
          {t('quiz.saved')}
        </Text>
        {/* `replace`, nu `back()`: la intrarea prin poartă (după anketă sau după
            login) nu există ecran în spate la care să ne întoarcem. */}
        <Button
          label={t('quiz.done')}
          onPress={() => router.replace(AFTER_QUIZ_ROUTE)}
          testID="humor-done"
        />
      </ScreenContainer>
    );
  }

  const card = cards[index];

  const answer = (funny: boolean) => {
    const next: HumorAnswer[] = [...answers, { cardId: card.id, funny }];
    if (index + 1 < cards.length) {
      setAnswers(next);
      setIndex(index + 1);
    } else {
      setAnswers(next);
      submitMutation.mutate(next);
    }
  };

  const submitting = submitMutation.isPending;

  return (
    <ScreenContainer>
      {header}

      <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
        <ProgressDots total={cards.length} current={index} />
        {/* Punctele singure nu spun nimic unui cititor de ecran (și nici ochiului,
            la 7 carduri) — progresul scris e și accesibilitate, nu doar decor. */}
        <Text
          testID="humor-progress"
          style={[typography.caption, styles.center, { color: colors.textSecondary }]}
        >
          {t('quiz.progress', { current: index + 1, total: cards.length })}
        </Text>
      </View>

      <View style={styles.cardWrap}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderRadius: radius.card,
              padding: spacing.xl,
            },
          ]}
        >
          <Text style={styles.cardEmoji}>😄</Text>
          <Text
            testID="humor-card-text"
            style={[
              typography.h2,
              styles.center,
              { color: colors.textPrimary, marginTop: spacing.lg },
            ]}
          >
            {cardText(card, language)}
          </Text>
        </View>
      </View>

      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        {submitting ? (
          <ActivityIndicator color={colors.accent} />
        ) : submitMutation.isError ? (
          <>
            <Text style={[typography.body, styles.center, { color: colors.danger }]}>
              {t('quiz.saveError')}
            </Text>
            <Button
              label={t('quiz.retry')}
              onPress={() => submitMutation.mutate(answers)}
              testID="humor-retry"
            />
          </>
        ) : (
          <>
            <Button
              label={t('quiz.funny')}
              onPress={() => answer(true)}
              testID="humor-funny"
            />
            <Button
              label={t('quiz.notFunny')}
              variant="outline"
              onPress={() => answer(false)}
              testID="humor-not-funny"
            />
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  // `flex: 1` merge aici pentru că TOT lanțul de deasupra are înălțime
  // (SafeAreaView flex:1 → View flex:1 din ScreenContainer); pe web, un `flex: 1`
  // cu părinte fără înălțime s-ar prăbuși la 0.
  cardWrap: { flex: 1, justifyContent: 'center' },
  card: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 48, lineHeight: 56 },
  emoji: { fontSize: 56, lineHeight: 64, textAlign: 'center' },
});
