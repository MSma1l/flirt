/**
 * Test de umor (TZ secț. 2.7): arată carduri de glume pe rând, utilizatorul
 * marchează fiecare „amuzant" / „nu prea", iar la final se salvează profilul.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, ProgressDots, ScreenContainer } from '@/components/ui';
import { fetchQuiz, submitQuiz } from '@/features/humor/humorApi';
import { HumorAnswer, HumorCard } from '@/features/humor/types';
import { useTheme } from '@theme/index';

export default function HumorScreen() {
  const router = useRouter();
  const { colors, typography, radius, spacing } = useTheme();

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<HumorAnswer[]>([]);

  const { data, isLoading, isError, refetch } = useQuery<HumorCard[]>({
    queryKey: ['humor-quiz'],
    queryFn: fetchQuiz,
  });

  const submitMutation = useMutation({
    mutationFn: (payload: HumorAnswer[]) => submitQuiz(payload),
  });

  const header = (
    <Text style={[typography.h1, { color: colors.textPrimary }]}>Simțul umorului</Text>
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
          Nu am putut încărca testul de umor.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const cards = data;

  if (cards.length === 0) {
    return (
      <ScreenContainer>
        {header}
        <View style={styles.center1}>
          <Text style={[typography.body, styles.center, { color: colors.textSecondary }]}>
            Nu există glume disponibile deocamdată.
          </Text>
        </View>
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
          Profilul tău de umor a fost salvat 🎭
        </Text>
        <Button label="Închide" onPress={() => router.back()} testID="humor-done" />
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

      <View style={{ marginTop: spacing.lg }}>
        <ProgressDots total={cards.length} current={index} />
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
            style={[
              typography.h2,
              styles.center,
              { color: colors.textPrimary, marginTop: spacing.lg },
            ]}
          >
            {card.text}
          </Text>
        </View>
      </View>

      <View style={{ gap: spacing.md, marginTop: spacing.lg }}>
        {submitting ? (
          <ActivityIndicator color={colors.accent} />
        ) : submitMutation.isError ? (
          <>
            <Text style={[typography.body, styles.center, { color: colors.danger }]}>
              Nu am putut salva. Reîncearcă.
            </Text>
            <Button
              label="Reîncearcă"
              onPress={() => submitMutation.mutate(answers)}
              testID="humor-retry"
            />
          </>
        ) : (
          <>
            <Button
              label="😂 Amuzant"
              onPress={() => answer(true)}
              testID="humor-funny"
            />
            <Button
              label="😐 Nu prea"
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
  center1: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cardWrap: { flex: 1, justifyContent: 'center' },
  card: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardEmoji: { fontSize: 48, lineHeight: 56 },
  emoji: { fontSize: 56, lineHeight: 64, textAlign: 'center' },
});
