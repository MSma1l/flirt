/** Wizard de anketă (multi-pas într-un ecran) — chestionarul de înregistrare. */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
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
  } = useQuery({ queryKey: ['anketa-reference'], queryFn: fetchReference });

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
      setPhotosError('Poza a fost scoasă din listă, dar nu am putut-o șterge de pe server.'),
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
      setSubmitError('Nu am putut salva anketa. Încearcă din nou.');
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
          : 'Nu am putut încărca pozele.';
      setPhotosError(`${reason} Apasă din nou pe „Finalizează" ca să reiei încărcarea.`);
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
              options={optionChips(reference.languages)}
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
              options={optionChips(reference.datingStatuses)}
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

        {step === SEARCH_PREFS_STEP && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>
              Pe cine cauți?
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Așa știm pe cine să-ți arătăm în feed. Poți schimba oricând din Setări.
            </Text>
            <ChipGroup
              label="Gen"
              options={optionChips(reference.genders)}
              values={draft.interestedIn ?? []}
              onToggle={(key) => toggleMulti('interestedIn', key)}
              error={errors.interestedIn}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md, width: '100%' }}>
              <View style={styles.flex}>
                <Input
                  testID="search-age-min"
                  label="Vârsta minimă"
                  placeholder={String(SEARCH_AGE_MIN)}
                  keyboardType="number-pad"
                  value={draft.ageMin != null ? String(draft.ageMin) : ''}
                  onChangeText={(t) => setField('ageMin', parseAge(t))}
                  error={errors.ageMin}
                />
              </View>
              <View style={styles.flex}>
                <Input
                  testID="search-age-max"
                  label="Vârsta maximă"
                  placeholder="99"
                  keyboardType="number-pad"
                  value={draft.ageMax != null ? String(draft.ageMax) : ''}
                  onChangeText={(t) => setField('ageMax', parseAge(t))}
                  error={errors.ageMax}
                />
              </View>
            </View>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              FLIRT este o aplicație 18+, deci vârsta minimă nu poate coborî sub{' '}
              {SEARCH_AGE_MIN} ani.
            </Text>
          </>
        )}

        {step === PHOTOS_STEP && (
          <>
            <Text style={[typography.h1, { color: colors.textPrimary }]}>Pozele tale</Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              Ai nevoie de cel puțin {PHOTO_LIMITS.min} poze ca să-ți publicăm anketa.
              Le redimensionăm și le comprimăm automat înainte de încărcare.
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
