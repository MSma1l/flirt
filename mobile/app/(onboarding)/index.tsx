/** Wizard de anketă (multi-pas într-un ecran) — chestionarul de înregistrare. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { CountryPickerField } from '@/features/anketa/components/CountryPickerField';
import { DateOfBirthField } from '@/features/anketa/components/DateOfBirthField';
import {
  ANKETA_STEPS,
  PHOTOS_STEP,
  SEARCH_PREFS_STEP,
  useAnketaStore,
} from '@/features/anketa/anketaStore';
import { AnketaDraft, InterestOption, OptionItem } from '@/features/anketa/types';
import {
  FieldErrors,
  isValid,
  MAX_ABOUT_LENGTH,
  SEARCH_AGE_MIN,
  validateStep,
} from '@/features/anketa/validation';
import { PhotoGrid, usePhotoPicker } from '@/features/photos';
import { deletePhoto, reorderPhotos, uploadPhoto } from '@/features/photos/photosApi';
import { PhotoTile } from '@/features/photos/types';
import {
  PHOTO_LIMITS,
  validateCanAddPhoto,
  validatePhotoCount,
} from '@/features/photos/validation';
import { useLanguage } from '@/i18n/useLanguage';
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

/** Transformă opțiunile de referință {value,label} în chips {key,label}. */
function optionChips(options: OptionItem[]): ChipOption[] {
  return options.map((o) => ({ key: o.value, label: o.label }));
}

/**
 * Citește o vârstă dintr-un câmp text: doar cifre, iar câmpul golit înseamnă
 * „nimic ales" (`undefined`) — nu 0, ca validarea să ceară o valoare, nu să
 * reclame un interval absurd.
 */
function parseAge(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? undefined : n;
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
  const { t } = useTranslation('onboarding');
  const { current: language } = useLanguage();
  const { colors, typography, spacing, radius } = useTheme();
  const setProfileCompleted = useAuthStore((s) => s.setProfileCompleted);

  const {
    draft,
    photos,
    step,
    setField,
    addPhoto,
    removePhoto,
    movePhoto,
    next,
    prev,
    reset,
  } = useAnketaStore();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const picker = usePhotoPicker();

  // Ce s-a terminat deja, ca o REÎNCERCARE să nu refacă munca (și, mai ales, să
  // nu retrimită anketa — un al doilea PUT ar rescrie `photos` cu lista goală și
  // ar șterge pozele deja urcate).
  const anketaSavedRef = useRef(false);
  // Poze deja urcate: URI local → URL de pe server. Ținem minte URL-ul ca, dacă
  // utilizatorul scoate din grilă o poză deja urcată (după un eșec parțial), să
  // o putem șterge și de pe server, nu doar din listă.
  const uploadedRef = useRef<Map<string, string>>(new Map());

  const {
    data: reference,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    // Limba intră în cheie: etichetele referinței vin DEJA localizate de la
    // server, deci un cache comun tuturor limbilor ar servi etichetele vechi
    // după comutare.
    queryKey: ['anketa-reference', language],
    queryFn: () => fetchReference(language),
  });

  /** Comută o valoare într-un câmp multi-select (array de string-uri). */
  const toggleMulti = (
    field: 'languages' | 'datingStatuses' | 'interests' | 'interestedIn',
    key: string,
  ) => {
    const current = (draft[field] as string[] | undefined) ?? [];
    const value = current.includes(key)
      ? current.filter((v) => v !== key)
      : [...current, key];
    setField(field, value);
  };

  /** Alege o poză din galerie (permisiune + compresie sunt tratate în hook). */
  const handleAddPhoto = async () => {
    const fullError = validateCanAddPhoto(photos.length);
    if (fullError) {
      setPhotosError(fullError);
      return;
    }
    setPhotosError(null);
    const photo = await picker.pick();
    if (photo) addPhoto(photo);
  };

  /**
   * Scoate o poză din grilă; dacă apucase să fie urcată (eșec parțial la un
   * upload anterior), o ștergem și de pe server — altfel ar rămâne orfană acolo
   * și ar consuma degeaba din `max_photos`.
   */
  const handleRemovePhoto = (index: number) => {
    const photo = photos[index];
    removePhoto(index);
    if (!photo) return;

    const uploadedUrl = uploadedRef.current.get(photo.uri);
    if (!uploadedUrl) return;
    uploadedRef.current.delete(photo.uri);
    void deletePhoto(uploadedUrl).catch(() =>
      setPhotosError(t('errors.deletePhoto')),
    );
  };

  /**
   * Finalizarea: întâi SALVĂM anketa (backend-ul creează profilul), abia apoi
   * urcăm pozele — `/profiles/photos` întoarce 404 pentru un profil inexistent.
   * La eroare de rețea, o nouă apăsare reia exact de unde a rămas: nici anketa,
   * nici pozele deja urcate nu se retrimit.
   */
  const finishAnketa = async () => {
    const countError = validatePhotoCount(photos.length);
    setPhotosError(countError);
    if (countError) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      if (!anketaSavedRef.current) {
        await submitAnketa(draft as AnketaDraft);
        anketaSavedRef.current = true;
      }
    } catch {
      setSubmitError(t('errors.saveAnketa'));
      setSubmitting(false);
      return;
    }

    try {
      let serverUrls: string[] = [];

      for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        if (uploadedRef.current.has(photo.uri)) continue; // urcată deja

        setUploadingIndex(i);
        setUploadProgress(0);
        const urls = await uploadPhoto(photo, { onProgress: setUploadProgress });
        serverUrls = urls;
        // Backend-ul adaugă la sfârșitul listei → ultimul URL e poza tocmai urcată.
        const newUrl = urls[urls.length - 1];
        if (newUrl) uploadedRef.current.set(photo.uri, newUrl);
      }
      setUploadingIndex(null);

      // Ordinea de pe server = ordinea încărcării. Dacă utilizatorul a reordonat
      // grila între două încercări, o punem la punct cu un singur PUT.
      const desired = photos
        .map((p) => uploadedRef.current.get(p.uri))
        .filter((url): url is string => !!url);
      if (
        desired.length > 1 &&
        serverUrls.length > 0 &&
        desired.join(' ') !== serverUrls.join(' ')
      ) {
        await reorderPhotos(desired);
      }

      setProfileCompleted(true);
      reset();
      // NU în feed: testul de umor urmează imediat după anketă. Vectorul de umor
      // intră în scorul de compatibilitate, deci un user care intră direct în
      // feed ar primi (și ar da) potriviri slabe. Ordinea de mai sus rămâne
      // neatinsă — anketă, poze, abia apoi navigarea.
      router.replace('/humor');
    } catch (error) {
      setUploadingIndex(null);
      const reason =
        error instanceof Error && error.message
          ? error.message
          : t('errors.uploadPhotos');
      setPhotosError(t('errors.uploadRetry', { reason }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = async () => {
    if (step === PHOTOS_STEP) {
      await finishAnketa();
      return;
    }

    const stepErrors = validateStep(step, draft);
    setErrors(stepErrors);
    if (!isValid(stepErrors)) return;

    next();
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
          {t('loading')}
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
          {t('loadError')}
        </Text>
        <Button label={t('retry')} variant="outline" onPress={() => refetch()} />
      </ScreenContainer>
    );
  }

  const isLastStep = step === ANKETA_STEPS - 1;

  /** Celulele grilei — poza care se încarcă acum își arată progresul pe ea. */
  const photoTiles: PhotoTile[] = photos.map((photo, index) => ({
    key: photo.uri,
    uri: photo.uri,
    uploading: uploadingIndex === index,
    progress: uploadingIndex === index ? uploadProgress : undefined,
  }));

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
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('step0.title')}</Text>
            <Input
              label={t('step0.name')}
              placeholder={t('step0.namePlaceholder')}
              value={draft.name ?? ''}
              onChangeText={(text) => setField('name', text)}
              error={errors.name}
            />
            <DateOfBirthField
              label={t('step0.birthDate')}
              value={draft.birthDate}
              onChange={(iso) => setField('birthDate', iso)}
              error={errors.birthDate}
            />
            <ChipGroup
              label={t('step0.gender')}
              options={optionChips(reference.genders)}
              values={draft.gender ? [draft.gender] : []}
              onToggle={(key) => setField('gender', key)}
              error={errors.gender}
            />
            <Input
              label={t('step0.height')}
              placeholder={t('step0.heightPlaceholder')}
              keyboardType="number-pad"
              value={draft.heightCm != null ? String(draft.heightCm) : ''}
              onChangeText={(text) => {
                const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
                setField('heightCm', Number.isNaN(n) ? (undefined as never) : n);
              }}
              error={errors.heightCm}
            />
          </>
        )}

        {step === 1 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('step1.title')}</Text>
            <Input
              label={t('step1.city')}
              placeholder={t('step1.cityPlaceholder')}
              value={draft.city ?? ''}
              onChangeText={(text) => setField('city', text)}
              error={errors.city}
            />
            <Input
              label={t('step1.street')}
              placeholder={t('step1.streetPlaceholder')}
              value={draft.street ?? ''}
              onChangeText={(text) => setField('street', text)}
            />
            <CountryPickerField
              label={t('step1.nationality')}
              value={draft.nationality}
              onChange={(code) => setField('nationality', code)}
            />
            <ChipGroup
              label={t('step1.languages')}
              options={optionChips(reference.languages)}
              values={draft.languages ?? []}
              onToggle={(key) => toggleMulti('languages', key)}
              error={errors.languages}
            />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('step2.title')}</Text>
            <View style={{ gap: spacing.xs, width: '100%' }}>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>
                {t('step2.about', {
                  current: (draft.about ?? '').length,
                  max: MAX_ABOUT_LENGTH,
                })}
              </Text>
              <TextInput
                multiline
                textAlignVertical="top"
                maxLength={MAX_ABOUT_LENGTH}
                placeholder={t('step2.aboutPlaceholder')}
                placeholderTextColor={colors.textDisabled}
                value={draft.about ?? ''}
                onChangeText={(text) => setField('about', text)}
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
              label={t('step2.datingStatus')}
              options={optionChips(reference.datingStatuses)}
              values={draft.datingStatuses ?? []}
              onToggle={(key) => toggleMulti('datingStatuses', key)}
            />
          </>
        )}

        {step === 3 && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('step3.title')}</Text>
            <ChipGroup
              label={t('step3.pick')}
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

        {step === SEARCH_PREFS_STEP && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>
              {t('searchPrefs.title')}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('searchPrefs.hint')}
            </Text>
            <ChipGroup
              label={t('searchPrefs.gender')}
              options={optionChips(reference.genders)}
              values={draft.interestedIn ?? []}
              onToggle={(key) => toggleMulti('interestedIn', key)}
              error={errors.interestedIn}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, width: '100%' }}>
              <View style={styles.flex}>
                <Input
                  testID="search-age-min"
                  label={t('searchPrefs.ageMin')}
                  placeholder={String(SEARCH_AGE_MIN)}
                  keyboardType="number-pad"
                  value={draft.ageMin != null ? String(draft.ageMin) : ''}
                  onChangeText={(text) => setField('ageMin', parseAge(text))}
                  error={errors.ageMin}
                />
              </View>
              <View style={styles.flex}>
                <Input
                  testID="search-age-max"
                  label={t('searchPrefs.ageMax')}
                  placeholder="99"
                  keyboardType="number-pad"
                  value={draft.ageMax != null ? String(draft.ageMax) : ''}
                  onChangeText={(text) => setField('ageMax', parseAge(text))}
                  error={errors.ageMax}
                />
              </View>
            </View>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('searchPrefs.ageNote', { min: SEARCH_AGE_MIN })}
            </Text>
          </>
        )}

        {step === PHOTOS_STEP && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>{t('photos.title')}</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('photos.hint', { min: PHOTO_LIMITS.min })}
            </Text>
            <PhotoGrid
              photos={photoTiles}
              onAdd={handleAddPhoto}
              onRemove={handleRemovePhoto}
              onMove={movePhoto}
              busy={submitting || picker.picking}
              error={photosError ?? picker.error}
              permissionDenied={picker.permissionDenied}
              onOpenSettings={picker.openSettings}
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
            label={t('back')}
            variant="outline"
            onPress={prev}
            style={styles.flex}
          />
        ) : null}
        <Button
          label={isLastStep ? t('finish') : t('continue')}
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
