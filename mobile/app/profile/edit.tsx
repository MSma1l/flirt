/** Editarea profilului propriu (TZ secț. 6.1): formular pre-completat + salvare. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { fetchReference, submitAnketa } from '@/features/anketa/anketaApi';
import { AnketaDraft, InterestOption } from '@/features/anketa/types';
import {
  FieldErrors,
  isValid,
  MAX_ABOUT_LENGTH,
  validateStep,
} from '@/features/anketa/validation';
import { fetchMyProfile } from '@/features/profile/profileApi';
import { useTheme } from '@theme/index';

/** Chip selectabil (gen, limbi, statusuri, interese). */
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

/** Validează întreg formularul (toate câmpurile din anketă). */
function validateAll(draft: Partial<AnketaDraft>): FieldErrors {
  return {
    ...validateStep(0, draft),
    ...validateStep(1, draft),
    ...validateStep(2, draft),
    ...validateStep(3, draft),
  };
}

export default function ProfileEditScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { colors, typography, spacing, radius } = useTheme();

  const [draft, setDraft] = useState<Partial<AnketaDraft>>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const profileQuery = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const referenceQuery = useQuery({ queryKey: ['anketa-reference'], queryFn: fetchReference });

  const profile = profileQuery.data;
  const reference = referenceQuery.data;

  // Pre-completează formularul odată ce profilul e încărcat.
  useEffect(() => {
    if (!profile) return;
    setDraft({
      name: profile.name,
      birthDate: profile.birthDate,
      gender: profile.gender,
      heightCm: profile.heightCm,
      city: profile.city,
      street: profile.street,
      nationality: profile.nationality,
      languages: profile.languages,
      about: profile.about,
      datingStatuses: profile.datingStatuses,
      interests: profile.interests,
    });
  }, [profile]);

  /** Setează un câmp în draft. */
  const setField = <K extends keyof AnketaDraft>(field: K, value: AnketaDraft[K]) => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  /** Comută o valoare într-un câmp multi-select. */
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

  const handleSave = async () => {
    const allErrors = validateAll(draft);
    setErrors(allErrors);
    if (!isValid(allErrors)) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      await submitAnketa(draft as AnketaDraft);
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      router.back();
    } catch {
      setSubmitError('Nu am putut salva profilul. Încearcă din nou.');
    } finally {
      setSubmitting(false);
    }
  };

  const isLoading = profileQuery.isLoading || referenceQuery.isLoading;
  const isError = profileQuery.isError || referenceQuery.isError;

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
          A apărut o eroare la încărcarea profilului.
        </Text>
        <Button
          label="Reîncearcă"
          variant="outline"
          onPress={() => {
            profileQuery.refetch();
            referenceQuery.refetch();
          }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Înapoi"
          onPress={() => router.back()}
          hitSlop={spacing.sm}
        >
          <Text style={[typography.h2, { color: colors.accent }]}>‹</Text>
        </Pressable>
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Editează profilul</Text>
      </View>

      <ScrollView
        style={{ flex: 1, marginTop: spacing.lg }}
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
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
            <Text style={[typography.caption, { color: colors.danger }]}>{errors.about}</Text>
          ) : null}
        </View>

        <ChipGroup
          label="Statusul cunoștinței"
          options={stringOptions(reference.datingStatuses)}
          values={draft.datingStatuses ?? []}
          onToggle={(key) => toggleMulti('datingStatuses', key)}
        />

        <ChipGroup
          label="Interese"
          options={reference.interests.map((i: InterestOption) => ({
            key: i.slug,
            label: i.label,
          }))}
          values={draft.interests ?? []}
          onToggle={(key) => toggleMulti('interests', key)}
          error={errors.interests}
        />

        {submitError ? (
          <Text style={[typography.caption, { color: colors.danger }]}>{submitError}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Salvează" onPress={handleSave} loading={submitting} style={styles.flex} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footer: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  flex: { flex: 1 },
});
