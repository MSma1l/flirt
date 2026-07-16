/**
 * Setări (hub) — TZ secț. 6.2–6.3: temă, rază de căutare, notificări,
 * ascundere profil, linkuri, deconectare și ștergere cont.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Button, Input, ScreenContainer } from '@/components/ui';
import { config } from '@/config';
import { fetchReference } from '@/features/anketa/anketaApi';
import { OptionItem } from '@/features/anketa/types';
import {
  SEARCH_AGE_MIN,
  validateInterestedIn,
  validateSearchAgeMax,
  validateSearchAgeMin,
} from '@/features/anketa/validation';
import {
  AccountDeletion,
  cancelAccountDeletion,
  fetchSettings,
  NotificationSettings,
  requestAccountDeletion,
  Settings,
  SettingsUpdate,
  ThemeMode,
  updateSettings,
} from '@/features/settings/settingsApi';
import { useAuthStore } from '@/store/authStore';
import { alertMessage, confirmAsync } from '@/utils/dialog';
import { searchRadiusKm } from '@/utils/validation';
import { useTheme } from '@theme/index';

const MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Luminos' },
  { value: 'dark', label: 'Întunecat' },
  { value: 'system', label: 'Sistem' },
];

/** Erorile de validare ale secțiunii „Pe cine cauți". */
type PrefErrors = {
  interestedIn?: string | null;
  ageMin?: string | null;
  ageMax?: string | null;
};

/**
 * Citește o vârstă dintr-un câmp text: doar cifre; câmpul golit = „nimic ales"
 * (`undefined`), ca validarea să ceară o valoare, nu să reclame un 0 absurd.
 * Același comportament ca în wizardul de anketă.
 */
function parseAge(text: string): number | undefined {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  return Number.isNaN(n) ? undefined : n;
}

const NOTIFICATION_OPTIONS: { key: keyof NotificationSettings; label: string }[] = [
  { key: 'match', label: 'Potriviri (match)' },
  { key: 'messages', label: 'Mesaje' },
  { key: 'aiHints', label: 'Sugestii AI' },
  { key: 'events', label: 'Evenimente' },
  { key: 'promos', label: 'Promoții' },
];

export default function SetariScreen() {
  const { colors, typography, spacing, radius, mode, setMode } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [radiusText, setRadiusText] = useState('');
  const [radiusError, setRadiusError] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);

  /* --- „Pe cine cauți" (preferințe de căutare) --- */
  const [interestedIn, setInterestedIn] = useState<string[]>([]);
  const [ageMinText, setAgeMinText] = useState('');
  const [ageMaxText, setAgeMaxText] = useState('');
  const [prefErrors, setPrefErrors] = useState<PrefErrors>({});

  const { data, isLoading, isError, refetch } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  /**
   * Opțiunile de gen vin din referința backendului — aceeași sursă ca wizardul de
   * anketă (`['anketa-reference']`, deci cache-ul e partajat, fără cerere în plus).
   * Dacă referința nu se încarcă, ascundem doar chips-urile, nu tot ecranul de setări.
   */
  const { data: reference } = useQuery({
    queryKey: ['anketa-reference'],
    queryFn: fetchReference,
  });

  const settingsMutation = useMutation({
    mutationFn: (patch: SettingsUpdate) => updateSettings(patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: () => {
      // Resincronizează cu serverul ca UI-ul să reflecte valorile reale.
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  // Deconectare: guard-ul din _layout redirecționează la starea unauthenticated.
  const onLogout = async () => {
    await logout();
  };

  const deleteMutation = useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: (res) => setDeletion(res),
    onError: () => {
      alertMessage(
        'Nu am putut șterge contul',
        'Cererea nu a ajuns la server. Contul tău a rămas neschimbat — încearcă din nou.',
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAccountDeletion,
    onSuccess: () => setDeletion(null),
    // Important: dacă anularea pică, ștergerea rămâne programată. Userul trebuie
    // să afle, altfel crede că a salvat contul și îl pierde la finalul grației.
    onError: () => {
      alertMessage(
        'Nu am putut anula ștergerea',
        'Ștergerea contului rămâne programată. Încearcă din nou.',
      );
    },
  });

  /**
   * Ultima rază TRIMISĂ deja la server (sau primită de la el). Garda pe `data`
   * nu era suficientă: `data` se reîmprospătează abia după ce răspunde PUT-ul,
   * deci al doilea handler (vezi `commitRadius`) o vedea încă pe cea veche.
   * Ref-ul se actualizează SINCRON, înainte de `mutate`.
   */
  const lastRadiusRef = useRef<number | null>(null);

  // Sincronizează tema persistată și câmpul de rază la prima încărcare.
  useEffect(() => {
    if (data) {
      setMode(data.theme);
      setRadiusText(String(data.searchRadiusKm));
      lastRadiusRef.current = data.searchRadiusKm;
    }
    // Rulează doar când sosesc datele din backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.theme, data?.searchRadiusKm]);

  // Sincronizează preferințele de căutare când sosesc setările din backend.
  useEffect(() => {
    if (data) {
      setInterestedIn(data.interestedIn);
      setAgeMinText(String(data.ageMin));
      setAgeMaxText(String(data.ageMax));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.interestedIn, data?.ageMin, data?.ageMax]);

  const onSelectTheme = (value: ThemeMode) => {
    setMode(value);
    settingsMutation.mutate({ theme: value });
  };

  const commitRadius = () => {
    // Rază de căutare: număr întreg pozitiv rezonabil (1–1000 km).
    const err = searchRadiusKm(radiusText);
    if (err) {
      setRadiusError(err);
      return;
    }
    setRadiusError(null);
    const parsed = parseInt(radiusText, 10);
    // Garda reală contra dublului PUT: comparăm cu ultima valoare trimisă, nu cu
    // `data` (care încă n-a apucat să se reîmprospăteze).
    if (parsed === lastRadiusRef.current) return;
    lastRadiusRef.current = parsed;
    settingsMutation.mutate(
      { searchRadiusKm: parsed },
      {
        // Dacă PUT-ul pică, valoarea de pe server rămâne cea veche, deci efectul de
        // sincronizare NU se re-declanșează (`data.searchRadiusKm` e neschimbat) și
        // ref-ul ar rămâne blocat pe valoarea eșuată — a doua încercare a userului
        // ar fi înghițită de gardă. Îl eliberăm ca reîncercarea să treacă.
        onError: () => {
          lastRadiusRef.current = null;
        },
      },
    );
  };

  /** Comută un gen căutat (multi-select, ca în wizardul de anketă). */
  const toggleInterestedIn = (value: string) => {
    setInterestedIn((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  /**
   * Validează și salvează preferințele de căutare într-un singur PUT.
   * Validăm în UI (18+, `age_min <= age_max`) ca userul să vadă un mesaj clar în
   * română, nu un 422 de la backend. Refolosim validatoarele anketei.
   */
  const commitPreferences = () => {
    const ageMin = parseAge(ageMinText);
    const ageMax = parseAge(ageMaxText);
    const errs: PrefErrors = {
      interestedIn: validateInterestedIn(interestedIn),
      ageMin: validateSearchAgeMin(ageMin),
      ageMax: validateSearchAgeMax(ageMax, ageMin),
    };
    if (errs.interestedIn || errs.ageMin || errs.ageMax) {
      setPrefErrors(errs);
      return;
    }
    setPrefErrors({});
    settingsMutation.mutate({
      interestedIn,
      ageMin: ageMin as number,
      ageMax: ageMax as number,
    });
  };

  const onToggleNotification = (key: keyof NotificationSettings, value: boolean) => {
    settingsMutation.mutate({ notifications: { [key]: value } });
  };

  const onToggleHidden = (value: boolean) => {
    settingsMutation.mutate({ profileHidden: value });
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync(
      'Ștergere cont',
      'Ești sigur? Contul și datele tale vor fi șterse definitiv după perioada de grație.',
      { confirmText: 'Șterge contul', destructive: true },
    );
    if (ok) {
      deleteMutation.mutate();
    }
  };

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
        <Text style={[typography.body, styles.center, { color: colors.danger }]}>
          Nu am putut încărca setările.
        </Text>
        <Text
          accessibilityRole="button"
          onPress={() => refetch()}
          style={[
            typography.bodyStrong,
            styles.center,
            { color: colors.accent, marginTop: spacing.md },
          ]}
        >
          Reîncearcă
        </Text>
        {/* Deconectarea rămâne la îndemână și aici: dacă setările nu se încarcă
            din cauza sesiunii, ăsta e singurul drum de ieșire al userului. */}
        <View style={{ alignSelf: 'stretch', marginTop: spacing.xl }}>
          <Button
            label="Deconectare"
            variant="outline"
            onPress={onLogout}
            testID="logout"
          />
        </View>
      </ScreenContainer>
    );
  }

  const sectionLabel = (text: string) => (
    <Text
      style={[
        typography.caption,
        { color: colors.textSecondary, marginBottom: spacing.sm },
      ]}
    >
      {text}
    </Text>
  );

  const rowShell = (label: string, testID: string, onPress: () => void, trailing: string) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.lg,
        },
      ]}
    >
      <Text style={[typography.body, styles.rowLabel, { color: colors.textPrimary }]}>
        {label}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{trailing}</Text>
    </Pressable>
  );

  /** Rând care navighează într-un ecran din aplicație. */
  const linkRow = (label: string, target: string, testID: string) =>
    rowShell(label, testID, () => router.push(target), '›');

  /**
   * Rând care deschide un document public în browser (termeni, confidențialitate,
   * suport). URL-urile vin din config (app.json → extra), nu sunt hardcodate aici.
   */
  const externalRow = (label: string, url: string, testID: string) =>
    rowShell(
      label,
      testID,
      () => {
        Linking.openURL(url).catch(() =>
          alertMessage('Ceva n-a mers', 'Nu am putut deschide pagina. Încearcă din nou.'),
        );
      },
      '↗',
    );

  return (
    <ScreenContainer>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[typography.h1, { color: colors.textPrimary, marginBottom: spacing.xl }]}>
          Setări
        </Text>

        {settingsMutation.isError ? (
          <Text
            testID="settings-error"
            style={[typography.caption, { color: colors.danger, marginBottom: spacing.lg }]}
          >
            Nu am putut salva setarea. Am resincronizat cu serverul — reîncearcă.
          </Text>
        ) : null}

        {/* Cont */}
        <View style={{ marginBottom: spacing.xl }}>
          {sectionLabel('Cont')}
          <Text style={[typography.caption, { color: colors.textSecondary }]}>Email</Text>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {user?.email ?? '—'}
          </Text>
        </View>

        {/* Temă */}
        <View style={{ marginBottom: spacing.xl }}>
          {sectionLabel('Temă')}
          <View style={styles.modes}>
            {MODE_OPTIONS.map((opt) => {
              const active = mode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  testID={`theme-${opt.value}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onSelectTheme(opt.value)}
                  style={[
                    styles.modeBtn,
                    {
                      borderRadius: radius.pill,
                      paddingVertical: spacing.sm,
                      backgroundColor: active ? colors.accent : colors.surface,
                      borderColor: active ? colors.accent : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      typography.caption,
                      { color: active ? colors.onAccent : colors.textPrimary },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Pe cine cauți — filtre DURE în feed (gen + interval de vârstă) */}
        <View style={{ marginBottom: spacing.xl, gap: spacing.md }}>
          {sectionLabel('Pe cine cauți')}
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            Așa știm pe cine să-ți arătăm în feed.
          </Text>

          {/* Genurile vin din referința backendului, nu sunt hardcodate aici. */}
          {reference ? (
            <View style={{ gap: spacing.sm }}>
              <Text style={[typography.caption, { color: colors.textSecondary }]}>Gen</Text>
              <View style={styles.chips}>
                {reference.genders.map((opt: OptionItem) => {
                  const active = interestedIn.includes(opt.value);
                  return (
                    <Pressable
                      key={opt.value}
                      testID={`interested-in-${opt.value}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => toggleInterestedIn(opt.value)}
                      style={[
                        styles.chip,
                        {
                          borderRadius: radius.pill,
                          paddingVertical: spacing.sm,
                          paddingHorizontal: spacing.lg,
                          backgroundColor: active ? colors.tagBg : colors.surface,
                          borderColor: active ? colors.accent : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          typography.caption,
                          { color: active ? colors.accent : colors.textSecondary },
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {prefErrors.interestedIn ? (
                <Text
                  testID="interested-in-error"
                  style={[typography.caption, { color: colors.danger }]}
                >
                  {prefErrors.interestedIn}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.ageRow}>
            <View style={styles.flex}>
              <Input
                testID="search-age-min"
                label="Vârsta minimă"
                placeholder={String(SEARCH_AGE_MIN)}
                keyboardType="number-pad"
                value={ageMinText}
                error={prefErrors.ageMin}
                onChangeText={setAgeMinText}
              />
            </View>
            <View style={styles.flex}>
              <Input
                testID="search-age-max"
                label="Vârsta maximă"
                placeholder="99"
                keyboardType="number-pad"
                value={ageMaxText}
                error={prefErrors.ageMax}
                onChangeText={setAgeMaxText}
              />
            </View>
          </View>

          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            FLIRT este o aplicație 18+, deci vârsta minimă nu poate coborî sub{' '}
            {SEARCH_AGE_MIN} ani.
          </Text>

          <Button
            label="Salvează preferințele"
            variant="outline"
            loading={settingsMutation.isPending}
            onPress={commitPreferences}
            testID="save-search-prefs"
          />
        </View>

        {/* Rază de căutare */}
        <View style={{ marginBottom: spacing.xl }}>
          {sectionLabel('Rază de căutare')}
          <Input
            testID="search-radius"
            label="Distanță maximă (km)"
            keyboardType="number-pad"
            value={radiusText}
            error={radiusError}
            onChangeText={setRadiusText}
            onEndEditing={commitRadius}
            onBlur={commitRadius}
            returnKeyType="done"
          />
        </View>

        {/* Notificări */}
        <View style={{ marginBottom: spacing.xl }}>
          {sectionLabel('Notificări')}
          {NOTIFICATION_OPTIONS.map((opt) => (
            <View
              key={opt.key}
              style={[styles.toggleRow, { paddingVertical: spacing.sm }]}
            >
              <Text style={[typography.body, styles.rowLabel, { color: colors.textPrimary }]}>
                {opt.label}
              </Text>
              <Switch
                testID={`notif-${opt.key}`}
                value={data.notifications[opt.key]}
                onValueChange={(v) => onToggleNotification(opt.key, v)}
                trackColor={{ true: colors.accent, false: colors.border }}
                thumbColor={colors.onAccent}
              />
            </View>
          ))}
        </View>

        {/* Confidențialitate */}
        <View style={{ marginBottom: spacing.xl }}>
          {sectionLabel('Confidențialitate')}
          <View style={[styles.toggleRow, { paddingVertical: spacing.sm }]}>
            <Text style={[typography.body, styles.rowLabel, { color: colors.textPrimary }]}>
              Ascunde profilul
            </Text>
            <Switch
              testID="profile-hidden"
              value={data.profileHidden}
              onValueChange={onToggleHidden}
              trackColor={{ true: colors.accent, false: colors.border }}
              thumbColor={colors.onAccent}
            />
          </View>
        </View>

        {/* Linkuri */}
        <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
          {sectionLabel('Mai multe')}
          {linkRow('Editează profilul', '/profile/edit', 'link-profile-edit')}
          {linkRow('Verificare (selfie)', '/verify-face', 'link-verify-face')}
          {linkRow('Abonamente Premium', '/paywall', 'link-paywall')}
          {linkRow('Test de umor', '/humor', 'link-humor')}
          {linkRow('Favorite', '/favorites', 'link-favorites')}
          {linkRow('Evenimente', '/events', 'link-events')}
          {linkRow('Flirt Passport', '/passport', 'link-passport')}
          {linkRow('Biletul meu Flirt Party', '/ticket', 'link-ticket')}
          {linkRow('Utilizatori blocați', '/blocklist', 'link-blocklist')}
        </View>

        {/* Legal & suport — obligatorii în aplicație (Guideline 1.2 / 5.1.1). */}
        <View style={{ marginBottom: spacing.xl, gap: spacing.sm }}>
          {sectionLabel('Legal și suport')}
          {externalRow('Termeni și condiții', config.legal.termsUrl, 'link-terms')}
          {externalRow(
            'Politica de confidențialitate',
            config.legal.privacyUrl,
            'link-privacy',
          )}
          {externalRow('Suport', config.legal.supportUrl, 'link-support')}
        </View>

        {/* Ștergere programată */}
        {deletion ? (
          <View
            testID="deletion-banner"
            style={[
              styles.banner,
              {
                backgroundColor: colors.tagBg,
                borderColor: colors.danger,
                borderRadius: radius.md,
                padding: spacing.lg,
                gap: spacing.md,
                marginBottom: spacing.xl,
              },
            ]}
          >
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>
              Ștergere programată
            </Text>
            <Text style={[typography.caption, { color: colors.textPrimary }]}>
              Contul va fi șters definitiv pe{' '}
              {new Date(deletion.purgeAfter).toLocaleDateString('ro-RO')}. Poți anula până
              atunci.
            </Text>
            <Button
              label="Anulează ștergerea"
              variant="outline"
              loading={cancelMutation.isPending}
              onPress={() => cancelMutation.mutate()}
              testID="cancel-deletion"
            />
          </View>
        ) : null}

        {/* Acțiuni */}
        <View style={{ gap: spacing.md, marginBottom: spacing.xl }}>
          <Button
            label="Deconectare"
            variant="outline"
            onPress={onLogout}
            testID="logout"
          />
          <Pressable
            testID="delete-account"
            accessibilityRole="button"
            disabled={!!deletion || deleteMutation.isPending}
            onPress={confirmDelete}
            style={({ pressed }) => [
              styles.dangerBtn,
              {
                borderColor: colors.danger,
                borderRadius: radius.pill,
                backgroundColor: pressed ? colors.tagBg : 'transparent',
                opacity: deletion ? 0.5 : 1,
              },
            ]}
          >
            {deleteMutation.isPending ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={[typography.bodyStrong, { color: colors.danger }]}>
                Șterge contul
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  modes: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, alignItems: 'center', borderWidth: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5 },
  ageRow: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  rowLabel: { flex: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  banner: { borderWidth: 1 },
  dangerBtn: {
    borderWidth: 1.5,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
