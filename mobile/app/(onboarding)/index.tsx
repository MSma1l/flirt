/** Wizard de anketă (multi-pas într-un ecran) — chestionarul de înregistrare. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Input, ProgressDots, ScreenContainer } from '@/components/ui';
import { fetchReference, submitAnketa } from '@/features/anketa/anketaApi';
import { ANKETA_STEPS, useAnketaStore } from '@/features/anketa/anketaStore';
import { AnketaDraft, InterestOption } from '@/features/anketa/types';
import {
  FieldErrors,
  isValid,
  MAX_ABOUT_LENGTH,
  validateStep,
} from '@/features/anketa/validation';
import { useAuthStore } from '@/store/authStore';
import { useTheme } from '@theme/index';

/** Chip selectabil (folosit pentru gen, limbi, statusuri, interese). */
function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        borderWidth: 1.5,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.tagBg : colors.surface,
      }}
    >
      <Text
        style={[
          typography.caption,
          { color: selected ? colors.accent : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** O opțiune normalizată pentru grupul de chips. */
interface ChipOption {
  key: string;
  label: string;
}

/** Transformă o listă de string-uri în opțiuni {key,label}. */
function stringOptions(values: string[]): ChipOption[] {
  return values.map((v) => ({ key: v, label: v }));
}

/** Grup de chips pentru selecție simplă sau multiplă. */
function ChipGroup({
  label,
  options,
  values,
  onToggle,
  error,
}: {
  label: string;
  options: ChipOption[];
  values: string[];
  onToggle: (key: string) => void;
  error?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.sm, width: '100%' }}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {options.map((o) => (
          <Chip
            key={o.key}
            label={o.label}
            selected={values.includes(o.key)}
            onPress={() => onToggle(o.key)}
          />
        ))}
      </View>
      {error ? (
        <Text style={[typography.caption, { color: colors.danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

export default function AnketaWizard() {
  const router = useRouter();
  const { colors, typography, spacing, radius } = useTheme();
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);

  const { draft, step, setField, next, prev, reset } = useAnketaStore();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    data: reference,
    isLoading,
    isError,
    refetch,
  } = useQuery({ queryKey: ['anketa-reference'], queryFn: fetchReference });

  /** Comută o valoare într-un câmp multi-select (array de string-uri). */
  const toggleMulti = (
    field: 'languages' | 'datingStatuses' | 'interests',
    key: string,
  ) => {
    const current = (draft[field] as string[] | undefined) ?? [];
    const value = current.includes(key)
      ? current.filter((v) => v !== key)
      : [...current, key];
    setField(field, value);
  };

  const handleNext = async () => {
    const stepErrors = validateStep(step, draft);
    setErrors(stepErrors);
    if (!isValid(stepErrors)) return;

    if (step < ANKETA_STEPS - 1) {
      next();
      return;
    }

    // Ultimul pas → trimite anketa.
    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitAnketa(draft as AnketaDraft);
      setProfileCompleted(true);
      reset();
      router.replace('/(tabs)/ankete');
    } catch {
      setSubmitError('Nu am putut salva anketa. Încearcă din nou.');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer center>
        <ActivityIndicator color={colors.accent} />
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
          ]}
        >
          Se încarcă...
        </Text>
      </ScreenContainer>
    );
  }

  if (isError || !reference) {
    return (
      <ScreenContainer center>
        <Text
          style={[
            typography.bodyStrong,
            { color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.lg },
          ]}
        >
          A apărut o eroare la încărcarea datelor.
        </Text>
        <Button label="Reîncearcă" variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const isLastStep = step === ANKETA_STEPS - 1;

  return (
    <ScreenContainer>
      <ProgressDots total={ANKETA_STEPS} current={step} />

      <ScrollView
        style={{ flex: 1, marginTop: spacing.xl }}
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Despre tine</Text>
            <Input
              label="Nume"
              placeholder="Numele tău"
              value={draft.name ?? ''}
              onChangeText={(t) => setField('name', t)}
              error={errors.name}
            />
            <Input
              label="Data nașterii (AAAA-LL-ZZ)"
              placeholder="1998-05-20"
              autoCapitalize="none"
              value={draft.birthDate ?? ''}
              onChangeText={(t) => setField('birthDate', t)}
              error={errors.birthDate}
            />
            <ChipGroup
              label="Gen"
              options={stringOptions(reference.genders)}
              values={draft.gender ? [draft.gender] : []}
              onToggle={(key) => setField('gender', key)}
              error={errors.gender}
            />
            <Input
              label="Înălțime (cm)"
              placeholder="175"
              keyboardType="number-pad"
              value={draft.heightCm != null ? String(draft.heightCm) : ''}
              onChangeText={(t) => {
                const n = parseInt(t.replace(/[^0-9]/g, ''), 10);
                setField('heightCm', Number.isNaN(n) ? (undefined as never) : n);
              }}
              error={errors.heightCm}
            />
          </>
        )}

        {step === 1 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Localizare</Text>
            <Input
              label="Oraș"
              placeholder="Orașul tău"
              value={draft.city ?? ''}
              onChangeText={(t) => setField('city', t)}
              error={errors.city}
            />
            <Input
              label="Stradă / cartier (opțional)"
              placeholder="Opțional"
              value={draft.street ?? ''}
              onChangeText={(t) => setField('street', t)}
            />
            <Input
              label="Naționalitate (opțional)"
              placeholder="Opțional"
              value={draft.nationality ?? ''}
              onChangeText={(t) => setField('nationality', t)}
            />
            <ChipGroup
              label="Limbi de comunicare"
              options={stringOptions(reference.languages)}
              values={draft.languages ?? []}
              onToggle={(key) => toggleMulti('languages', key)}
              error={errors.languages}
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Prezentare</Text>
            <View style={{ gap: spacing.xs, width: '100%' }}>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                Despre tine ({(draft.about ?? '').length}/{MAX_ABOUT_LENGTH})
              </Text>
              <TextInput
                multiline
                textAlignVertical="top"
                maxLength={MAX_ABOUT_LENGTH}
                placeholder="Spune câteva cuvinte despre tine"
                placeholderTextColor={colors.textDisabled}
                value={draft.about ?? ''}
                onChangeText={(t) => setField('about', t)}
                style={[
                  typography.body,
                  {
                    minHeight: 120,
                    backgroundColor: colors.surface,
                    borderColor: errors.about ? colors.danger : colors.border,
                    borderWidth: 1,
                    borderRadius: radius.md,
                    color: colors.textPrimary,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                  },
                ]}
              />
              {errors.about ? (
                <Text style={[typography.caption, { color: colors.danger }]}>
                  {errors.about}
                </Text>
              ) : null}
            </View>
            <ChipGroup
              label="Statusul cunoștinței"
              options={stringOptions(reference.datingStatuses)}
              values={draft.datingStatuses ?? []}
              onToggle={(key) => toggleMulti('datingStatuses', key)}
            />
          </>
        )}

        {step === 3 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Interese</Text>
            <ChipGroup
              label="Alege ce te reprezintă"
              options={reference.interests.map((i: InterestOption) => ({
                key: i.slug,
                label: i.label,
              }))}
              values={draft.interests ?? []}
              onToggle={(key) => toggleMulti('interests', key)}
              error={errors.interests}
            />
          </>
        )}

        {submitError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{submitError}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 ? (
          <Button
            label="Înapoi"
            variant="outline"
            onPress={prev}
            style={styles.flex}
          />
        ) : null}
        <Button
          label={isLastStep ? 'Finalizează' : 'Continuă'}
          onPress={handleNext}
          loading={submitting}
          style={styles.flex}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  flex: { flex: 1 },
});
