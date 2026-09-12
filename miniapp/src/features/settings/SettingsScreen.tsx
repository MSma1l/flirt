/**
 * Setările contului în Telegram Mini App (TZ secț. 6.2–6.3).
 *
 * Portat din `mobile/app/(tabs)/setari.tsx` + `mobile/src/features/settings/`,
 * rescris pentru DOM. Stratul de rețea e REUTILIZAT INTEGRAL prin import din
 * `mobile/src/features/settings/settingsApi.ts` (fișier care nu atinge nimic din
 * React Native și al cărui singur import, `@/services/api`, e mapat pe clientul
 * HTTP al Mini App-ului) — deci maparea snake_case ↔ camelCase și rutele rămân
 * o singură sursă de adevăr cu aplicația nativă.
 *
 * Ce NU s-a portat din ecranul nativ, cu motiv:
 *  - SELECTORUL DE TEMĂ. În Mini App paleta vine de la clientul Telegram
 *    (`theme/applyTheme.ts` ascultă `themeChanged`); un buton „Luminos/Întunecat"
 *    care nu schimbă nimic pe ecran ar fi o minciună în interfață.
 *  - DECONECTAREA. Identitatea e contul Telegram: nu există altul cu care să te
 *    reconectezi, iar `signOut()` ar lăsa aplicația într-o stare din care doar
 *    reîncărcarea o scoate.
 *  - Rândurile care duc la ecrane încă neportate (blocklist, abonamente, umor,
 *    favorite, evenimente, pașaport, bilet) și linkurile legale (URL-urile lor
 *    stau în configul Expo, care nu există aici).
 *
 * Acțiunile distructive au confirmare PROPRIE (`ConfirmDialog`), niciodată
 * `confirm()`/`alert()` — dialogurile native blochează WebView-ul Telegram.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  normalizeLanguage,
  SUPPORTED_LANGUAGES,
  type Language,
} from '@mobile/i18n/config';
import {
  cancelAccountDeletion,
  fetchSettings,
  requestAccountDeletion,
  updateSettings,
  type AccountDeletion,
  type NotificationSettings,
  type Settings,
  type SettingsUpdate,
} from '@mobile/features/settings/settingsApi';

import { StatusScreen } from '@/components/StatusScreen';
import { AiSettingsSection } from '@/features/ai';

import { ConfirmDialog } from '../profile/ConfirmDialog';
import { fetchReference } from '../profile/profileApi';

import {
  parseAge,
  SEARCH_AGE_MAX_LIMIT,
  SEARCH_AGE_MIN,
  searchRadiusKm,
  validateInterestedIn,
  validateSearchAgeMax,
  validateSearchAgeMin,
} from './validation';

import './settings.css';

/** Cheile de notificări; eticheta afișată vine din catalog (`notifications.<key>`). */
const NOTIFICATION_KEYS: (keyof NotificationSettings)[] = [
  'match',
  'messages',
  'aiHints',
  'events',
  'promos',
];

/** Erorile de validare ale secțiunii „Pe cine cauți". */
interface PrefErrors {
  interestedIn?: string | null;
  ageMin?: string | null;
  ageMax?: string | null;
}

/** Comutator accesibil: un checkbox marcat `role="switch"`. */
function Toggle({
  label,
  checked,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <label className="settings-toggle">
      <span className="body-text settings-toggle__label">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
      />
    </label>
  );
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const language = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
  const queryClient = useQueryClient();

  const [radiusText, setRadiusText] = useState('');
  const [radiusError, setRadiusError] = useState<string | null>(null);

  const [interestedIn, setInterestedIn] = useState<string[]>([]);
  const [ageMinText, setAgeMinText] = useState('');
  const [ageMaxText, setAgeMaxText] = useState('');
  // „Fără interval de vârstă": userul vrea orice vârstă (18+). Când e activ,
  // trimitem 18..MAX și ascundem câmpurile de vârstă.
  const [anyAge, setAnyAge] = useState(false);
  const [prefErrors, setPrefErrors] = useState<PrefErrors>({});

  const [deletion, setDeletion] = useState<AccountDeletion | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const settingsQuery = useQuery<Settings>({ queryKey: ['settings'], queryFn: fetchSettings });
  const data = settingsQuery.data;

  /**
   * Genurile vin din referința backendului — aceeași cheie de cache ca ecranul
   * de profil, deci fără cerere în plus. Dacă referința nu se încarcă, ascundem
   * doar chips-urile, nu tot ecranul de setări.
   */
  const referenceQuery = useQuery({
    queryKey: ['profile-reference', language],
    queryFn: () => fetchReference(language),
  });
  const reference = referenceQuery.data;

  const settingsMutation = useMutation({
    mutationFn: (patch: SettingsUpdate) => updateSettings(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      // Preferințele (gen, interval de vârstă, rază) sunt FILTRE DURE în feed:
      // fără invalidare, cache-ul vechi ar continua să arate profiluri în afara
      // intervalului tocmai salvat.
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
    // Resincronizăm cu serverul ca interfața să reflecte valorile reale.
    onError: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: requestAccountDeletion,
    onSuccess: (res) => setDeletion(res),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAccountDeletion,
    onSuccess: () => setDeletion(null),
  });

  /**
   * Ultima rază TRIMISĂ deja la server. O gardă pe `data` nu ar fi de ajuns:
   * `data` se reîmprospătează abia după ce răspunde PUT-ul, deci al doilea
   * handler (blur + change) ar vedea-o încă pe cea veche și ar trimite de două
   * ori. Ref-ul se actualizează SINCRON, înainte de `mutate`.
   */
  const lastRadiusRef = useRef<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setRadiusText(String(data.searchRadiusKm));
    lastRadiusRef.current = data.searchRadiusKm;
  }, [data?.searchRadiusKm]);

  useEffect(() => {
    if (!data) return;
    setInterestedIn(data.interestedIn);
    // Aplicația este 18+ ONLY: date vechi de pe server pot avea `age_min` sub 18.
    // Le afișăm urcate la 18, iar `age_max` rămâne cel puțin egal cu minimul.
    const min = Math.max(data.ageMin, SEARCH_AGE_MIN);
    const max = Math.max(data.ageMax, min);
    setAgeMinText(String(min));
    setAgeMaxText(String(max));
    setAnyAge(max >= SEARCH_AGE_MAX_LIMIT);
  }, [data?.interestedIn, data?.ageMin, data?.ageMax]);

  const commitRadius = () => {
    const err = searchRadiusKm(radiusText);
    if (err) {
      setRadiusError(err);
      return;
    }
    setRadiusError(null);
    const parsed = parseInt(radiusText, 10);
    if (parsed === lastRadiusRef.current) return;
    lastRadiusRef.current = parsed;
    settingsMutation.mutate(
      { searchRadiusKm: parsed },
      {
        // Dacă PUT-ul pică, valoarea de pe server rămâne cea veche, deci efectul
        // de sincronizare NU se re-declanșează și ref-ul ar rămâne blocat pe
        // valoarea eșuată — a doua încercare a userului ar fi înghițită de gardă.
        onError: () => {
          lastRadiusRef.current = null;
        },
      },
    );
  };

  const toggleInterestedIn = (value: string) => {
    setInterestedIn((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  const commitPreferences = () => {
    const errInterested = validateInterestedIn(interestedIn);

    if (anyAge) {
      if (errInterested) {
        setPrefErrors({ interestedIn: errInterested });
        return;
      }
      setPrefErrors({});
      settingsMutation.mutate({
        interestedIn,
        ageMin: SEARCH_AGE_MIN,
        ageMax: SEARCH_AGE_MAX_LIMIT,
      });
      return;
    }

    const ageMin = parseAge(ageMinText);
    const ageMax = parseAge(ageMaxText);
    const errs: PrefErrors = {
      interestedIn: errInterested,
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

  /** Ridică vârsta minimă la 18 dacă userul a coborât sub prag (18+ ONLY). */
  const clampAgeMin = () => {
    const min = parseAge(ageMinText);
    if (min != null && min < SEARCH_AGE_MIN) {
      setAgeMinText(String(SEARCH_AGE_MIN));
      setPrefErrors((e) => ({ ...e, ageMin: null }));
    }
  };

  const changeLanguage = (code: Language) => {
    // Nu re-selecta limba activă — evită un `changeLanguage` inutil.
    if (code !== language) void i18n.changeLanguage(code);
  };

  /* ------------------------------- Stările ------------------------------ */

  if (settingsQuery.isLoading) {
    return (
      <StatusScreen loading logo={false} testId="status-settings-loading" title={t('title')} />
    );
  }

  if (settingsQuery.isError || !data) {
    return (
      <StatusScreen
        logo={false}
        testId="status-settings-error"
        title={t('loadError')}
        actions={[
          {
            label: t('retry'),
            testId: 'settings-retry',
            onClick: () => void settingsQuery.refetch(),
          },
        ]}
      />
    );
  }

  return (
    <div className="settings-screen">
      <h1 className="title settings-screen__title">{t('title')}</h1>

      {settingsMutation.isError ? (
        <p className="error-text" role="alert" data-testid="settings-error">
          {t('saveError')}
        </p>
      ) : null}

      {/* ── Profil & căutare ───────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('sections.profileSearch')}</h2>

        <p className="body-text settings-label">{t('preferences.label')}</p>
        <p className="caption">{t('preferences.hint')}</p>

        {reference ? (
          <div className="settings-field">
            <p className="caption">{t('preferences.gender')}</p>
            <div className="pf-chip-row">
              {reference.genders.map((opt) => {
                const active = interestedIn.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    className={`pf-chip pf-chip--selectable${active ? ' pf-chip--on' : ''}`}
                    aria-pressed={active}
                    onClick={() => toggleInterestedIn(opt.value)}
                    data-testid={`interested-in-${opt.value}`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {prefErrors.interestedIn ? (
              <span className="pf-field__error" data-testid="interested-in-error">
                {prefErrors.interestedIn}
              </span>
            ) : null}
          </div>
        ) : null}

        <Toggle
          label={t('preferences.anyAgeLabel')}
          checked={anyAge}
          testId="search-any-age"
          onChange={(v) => {
            setAnyAge(v);
            if (v) setPrefErrors((e) => ({ ...e, ageMin: null, ageMax: null }));
          }}
        />

        {anyAge ? (
          <p className="caption">{t('preferences.anyAgeHint')}</p>
        ) : (
          <>
            <div className="settings-row">
              <label className="settings-field">
                <span className="caption">{t('preferences.ageMin')}</span>
                <input
                  className="pf-field__input"
                  inputMode="numeric"
                  value={ageMinText}
                  onChange={(e) => setAgeMinText(e.target.value)}
                  onBlur={clampAgeMin}
                  data-testid="search-age-min"
                />
                {prefErrors.ageMin ? (
                  <span className="pf-field__error">{prefErrors.ageMin}</span>
                ) : null}
              </label>
              <label className="settings-field">
                <span className="caption">{t('preferences.ageMax')}</span>
                <input
                  className="pf-field__input"
                  inputMode="numeric"
                  value={ageMaxText}
                  onChange={(e) => setAgeMaxText(e.target.value)}
                  data-testid="search-age-max"
                />
                {prefErrors.ageMax ? (
                  <span className="pf-field__error">{prefErrors.ageMax}</span>
                ) : null}
              </label>
            </div>
            <p className="caption">{t('preferences.ageNote', { min: SEARCH_AGE_MIN })}</p>
          </>
        )}

        <button
          type="button"
          className="button button--ghost"
          disabled={settingsMutation.isPending}
          onClick={commitPreferences}
          data-testid="save-search-prefs"
        >
          {t('preferences.save')}
        </button>

        <label className="settings-field">
          <span className="caption">{t('radius.input')}</span>
          <input
            className="pf-field__input"
            inputMode="numeric"
            value={radiusText}
            onChange={(e) => setRadiusText(e.target.value)}
            onBlur={commitRadius}
            data-testid="search-radius"
          />
          {radiusError ? (
            <span className="pf-field__error" data-testid="radius-error">
              {radiusError}
            </span>
          ) : null}
        </label>

        <Toggle
          label={t('privacy.hideProfile')}
          checked={data.profileHidden}
          testId="profile-hidden"
          onChange={(v) => settingsMutation.mutate({ profileHidden: v })}
        />
      </section>

      {/* ── Aspect (doar limba: tema o dă clientul Telegram) ───────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('sections.appearance')}</h2>
        <p className="caption">{t('language.label')}</p>
        <div className="pf-chip-row">
          {SUPPORTED_LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className={`pf-chip pf-chip--selectable${code === language ? ' pf-chip--on' : ''}`}
              aria-pressed={code === language}
              onClick={() => changeLanguage(code)}
              data-testid={`language-${code}`}
            >
              {LANGUAGE_LABELS[code]}
            </button>
          ))}
        </div>
      </section>

      {/* ── Notificări ─────────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('sections.notifications')}</h2>
        {NOTIFICATION_KEYS.map((key) => (
          <Toggle
            key={key}
            label={t(`notifications.${key}`)}
            checked={data.notifications[key]}
            testId={`notif-${key}`}
            onChange={(v) => settingsMutation.mutate({ notifications: { [key]: v } })}
          />
        ))}
      </section>

      {/* ── Asistent AI ────────────────────────────────────────────────
          Secțiunea se randează integral din `features/ai/`: rețeaua, stările și
          textul de consimțământ stau acolo. Comutatorul folosește tot ruta de
          setări (`PUT /settings/` cu `ai_enabled`), dar prin mapperul propriu —
          `mobile/src/features/settings/settingsApi.ts`, reutilizat de restul
          ecranului, nu cunoaște câmpul, iar acel fișier e sursă comună cu
          aplicația nativă și nu se modifică de aici. */}
      <AiSettingsSection />

      {/* ── Cont ───────────────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section__title">{t('sections.account')}</h2>

        {deletion ? (
          <div className="settings-banner" data-testid="deletion-banner">
            <p className="settings-banner__title">{t('deletion.bannerTitle')}</p>
            <p className="caption">
              {t('deletion.bannerBody', {
                date: new Date(deletion.purgeAfter).toLocaleDateString(language),
              })}
            </p>
            {cancelMutation.isError ? (
              <p className="error-text" role="alert" data-testid="cancel-deletion-error">
                {t('deletion.cancelErrorBody')}
              </p>
            ) : null}
            <button
              type="button"
              className="button button--ghost"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
              data-testid="cancel-deletion"
            >
              {t('deletion.cancel')}
            </button>
          </div>
        ) : null}

        {deleteMutation.isError ? (
          <p className="error-text" role="alert" data-testid="delete-account-error">
            {t('deletion.errorBody')}
          </p>
        ) : null}

        <button
          type="button"
          className="button pf-button--danger"
          disabled={!!deletion || deleteMutation.isPending}
          onClick={() => setConfirmingDelete(true)}
          data-testid="delete-account"
        >
          {t('account.deleteAccount')}
        </button>
      </section>

      <ConfirmDialog
        open={confirmingDelete}
        title={t('deletion.confirmTitle')}
        body={t('deletion.confirmBody')}
        confirmLabel={t('deletion.confirmButton')}
        destructive
        busy={deleteMutation.isPending}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteMutation.mutate();
        }}
      />
    </div>
  );
}

export default SettingsScreen;
