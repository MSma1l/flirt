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

import { BackButton, Button, Input, ScreenContainer } from '@/components/ui';
import { fetchReference, submitAnketa } from '@/features/anketa/anketaApi';
import { CountryPickerField } from '@/features/anketa/components/CountryPickerField';
import { DateOfBirthField } from '@/features/anketa/components/DateOfBirthField';
import { AnketaDraft, InterestOption, OptionItem } from '@/features/anketa/types';
import {
  FieldErrors,
  isValid,
  MAX_ABOUT_LENGTH,
  validateStep,
} from '@/features/anketa/validation';
import { PhotoGrid, usePhotoPicker } from '@/features/photos';
import { deletePhoto, reorderPhotos, uploadPhoto } from '@/features/photos/photosApi';
import { moveItem } from '@/features/photos/reorder';
import { PhotoTile } from '@/features/photos/types';
import {
  validateCanAddPhoto,
  validatePhotoCount,
} from '@/features/photos/validation';
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

/** Transformă opțiunile de referință {value,label} în chips {key,label}. */
function optionChips(options: OptionItem[]): ChipOption[] {
  return options.map((o) => ({ key: o.value, label: o.label }));
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

  // Pozele profilului (URL-uri de pe server), în ordinea afișării.
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [pendingPhotoUri, setPendingPhotoUri] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const picker = usePhotoPicker();

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
    setPhotos(profile.photos);
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

  /** Adaugă o poză: galerie → compresie → upload imediat (profilul deja există). */
  const handleAddPhoto = async () => {
    const fullError = validateCanAddPhoto(photos.length);
    if (fullError) {
      setPhotosError(fullError);
      return;
    }
    setPhotosError(null);

    const photo = await picker.pick();
    if (!photo) return; // anulat / permisiune refuzată — hook-ul deja are mesajul

    setPendingPhotoUri(photo.uri);
    setUploadProgress(0);
    setPhotosBusy(true);
    try {
      const urls = await uploadPhoto(photo, { onProgress: setUploadProgress });
      setPhotos(urls);
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch (error) {
      setPhotosError(
        error instanceof Error && error.message
          ? error.message
          : 'Nu am putut încărca poza. Încearcă din nou.',
      );
    } finally {
      setPendingPhotoUri(null);
      setPhotosBusy(false);
    }
  };

  /** Șterge o poză de pe server (confirmarea o cere grila). */
  const handleRemovePhoto = async (index: number) => {
    const url = photos[index];
    if (!url) return;

    setPhotosError(null);
    setPhotosBusy(true);
    try {
      const urls = await deletePhoto(url);
      setPhotos(urls);
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch {
      setPhotosError('Nu am putut șterge poza. Încearcă din nou.');
    } finally {
      setPhotosBusy(false);
    }
  };

  /** Reordonează pozele (prima = principală) și salvează ordinea pe server. */
  const handleMovePhoto = async (from: number, to: number) => {
    const previous = photos;
    const next = moveItem(photos, from, to);

    setPhotosError(null);
    setPhotos(next); // optimist — reordonarea trebuie să pară instantanee
    setPhotosBusy(true);
    try {
      const urls = await reorderPhotos(next);
      setPhotos(urls);
      await queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch {
      setPhotos(previous); // revenim la ordinea reală de pe server
      setPhotosError('Nu am putut salva ordinea pozelor. Încearcă din nou.');
    } finally {
      setPhotosBusy(false);
    }
  };

  const handleSave = async () => {
    const allErrors = validateAll(draft);
    setErrors(allErrors);

    const countError = validatePhotoCount(photos.length);
    setPhotosError(countError);

    if (!isValid(allErrors) || countError) return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      // `photos` merge OBLIGATORIU în payload: PUT /profiles/me rescrie lista de
      // poze, deci fără ea backend-ul le-ar șterge pe toate la o simplă editare.
      await submitAnketa({ ...(draft as AnketaDraft), photos });
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

  /** Celulele grilei: pozele de pe server + (opțional) poza în curs de upload. */
  const photoTiles: PhotoTile[] = [
    ...photos.map((url) => ({ key: url, uri: url })),
    ...(pendingPhotoUri
      ? [
          {
            key: pendingPhotoUri,
            uri: pendingPhotoUri,
            uploading: true,
            progress: uploadProgress,
          },
        ]
      : []),
  ];

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <BackButton />
        <Text style={[typography.h1, { color: colors.textPrimary }]}>Editează profilul</Text>
      </View>

      <ScrollView
        style={{ flex: 1, marginTop: spacing.lg }}
        contentContainerStyle={{ gap: spacing.lg, paddingBottom: spacing.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <PhotoGrid
          photos={photoTiles}
          onAdd={handleAddPhoto}
          onRemove={handleRemovePhoto}
          onMove={handleMovePhoto}
          busy={photosBusy || picker.picking || submitting}
          error={photosError ?? picker.error}
          permissionDenied={picker.permissionDenied}
          onOpenSettings={picker.openSettings}
        />

        <Input
          label="Nume"
          placeholder="Numele tău"
          value={draft.name ?? ''}
          onChangeText={(t) => setField('name', t)}
          error={errors.name}
        />
        <DateOfBirthField
          label="Data nașterii"
          value={draft.birthDate}
          onChange={(iso) => setField('birthDate', iso)}
          error={errors.birthDate}
        />
        <ChipGroup
          label="Gen"
          options={optionChips(reference.genders)}
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
        <CountryPickerField
          label="Naționalitate (opțional)"
          value={draft.nationality}
          onChange={(code) => setField('nationality', code)}
        />
        <ChipGroup
          label="Limbi de comunicare"
          options={optionChips(reference.languages)}
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
          options={optionChips(reference.datingStatuses)}
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
