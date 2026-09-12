/**
 * Completarea profilului — al doilea și ultimul pas „de scris" al înregistrării.
 *
 * Contractul cu backendul (`PUT /profiles/me`, `AnketaIn` + validările din
 * `profile_service.upsert_anketa`):
 *   OBLIGATORII în schemă : name, birth_date, gender, height_cm, city
 *   OBLIGATORII în service: cel puțin o limbă ȘI cel puțin un interes din catalog
 *                           (schema le lasă liste goale, serverul le respinge cu 422)
 *   OPȚIONALE             : street, nationality, about, dating_statuses, photos,
 *                           interested_in, age_min, age_max
 * Toate cataloagele vin din `GET /profiles/reference` — nicio listă hardcodată.
 *
 * Un SINGUR ecran, nu cinci pași ca pe mobil: fiecare ecran în plus e un loc în
 * care utilizatorul se poate opri, iar problema de rezolvat e chiar aceea că
 * lumea rămâne fără profil.
 *
 * Pozele NU se încarcă aici: `POST /profiles/photos` răspunde 404 până există
 * anketa, deci ordinea e impusă de server — întâi salvăm, apoi urcăm pozele.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type { AnketaDraft } from '@mobile/features/anketa/types';
import { type Language } from '@mobile/i18n/config';

import { StatusScreen } from '@/components/StatusScreen';
import { useTelegramMainButton } from '@/telegram/useTelegram';

import { ChipGroup, Field } from './FormControls';
import {
  apiErrorMessage,
  fetchMyProfile,
  fetchReference,
  profileToDraft,
  submitAnketa,
  type ApiMessage,
} from './onboardingApi';
import { ONBOARDING_PHOTOS_PATH } from './paths';
import { prefillFromTelegram, telegramIdentity } from './telegramPrefill';
import {
  isValid,
  MAX_HEIGHT_CM,
  MIN_HEIGHT_CM,
  MIN_REGISTRATION_AGE,
  validateDraft,
  type DraftErrors,
} from './validation';

/** Ziua de naștere cea mai TÂRZIE acceptată: azi minus vârsta minimă. */
export function latestAllowedBirthDate(now: Date = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear() - MIN_REGISTRATION_AGE, now.getUTCMonth(), now.getUTCDate()),
  );
  return d.toISOString().slice(0, 10);
}

const EMPTY_DRAFT: Partial<AnketaDraft> = {
  name: '',
  birthDate: '',
  gender: '',
  city: '',
  languages: [],
  interests: [],
  datingStatuses: [],
};

export function ProfileFormScreen() {
  const { t, i18n } = useTranslation('miniapp');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const language = i18n.language as Language;

  const reference = useQuery({
    queryKey: ['profiles', 'reference', language],
    queryFn: () => fetchReference(language),
    staleTime: 5 * 60 * 1000,
  });

  // Anketa deja salvată (dacă utilizatorul a ajuns până aici și a ieșit).
  // `null` = cont nou. 404 e tratat în `fetchMyProfile`, nu e o eroare.
  const existing = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
    staleTime: 0,
  });

  const [draft, setDraft] = useState<Partial<AnketaDraft>>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [serverError, setServerError] = useState<ApiMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);

  // Valorile de start: ce e deja pe server, altfel ce ne dă Telegram.
  useEffect(() => {
    if (ready || existing.isLoading) return;
    const prefill = prefillFromTelegram(telegramIdentity(), language);
    const saved = existing.data ? profileToDraft(existing.data) : {};
    setDraft({ ...EMPTY_DRAFT, ...prefill, ...saved });
    setReady(true);
  }, [existing.data, existing.isLoading, language, ready]);

  const update = useCallback(<K extends keyof AnketaDraft>(key: K, value: AnketaDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggle = useCallback(
    (key: 'languages' | 'interests' | 'datingStatuses' | 'interestedIn', value: string) => {
      setDraft((prev) => {
        const current = prev[key] ?? [];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [key]: next };
      });
    },
    [],
  );

  const fieldError = useCallback(
    (field: keyof AnketaDraft): string | null => {
      const error = errors[field];
      return error ? t(error.key, error.params ?? {}) : null;
    },
    [errors, t],
  );

  const submit = useCallback(async () => {
    if (saving) return;
    const found = validateDraft(draft);
    setErrors(found);
    setServerError(null);
    if (!isValid(found)) return;

    setSaving(true);
    try {
      await submitAnketa({
        name: draft.name ?? '',
        birthDate: draft.birthDate ?? '',
        gender: draft.gender ?? '',
        heightCm: draft.heightCm ?? 0,
        city: draft.city ?? '',
        languages: draft.languages ?? [],
        about: draft.about,
        datingStatuses: draft.datingStatuses ?? [],
        interests: draft.interests ?? [],
        // Pozele deja urcate se retrimit OBLIGATORIU: ruta rescrie lista, iar o
        // listă goală ar șterge tot ce a încărcat utilizatorul până acum.
        photos: existing.data?.photos ?? [],
        // Preferințele de căutare doar dacă utilizatorul a ales ceva: pentru
        // backend, câmpul absent înseamnă „nu le atinge" (păstrează default-urile).
        ...(draft.interestedIn && draft.interestedIn.length > 0
          ? { interestedIn: draft.interestedIn }
          : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'me'] });
      void navigate(ONBOARDING_PHOTOS_PATH);
    } catch (error) {
      setServerError(apiErrorMessage(error, 'onboarding.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [draft, existing.data, navigate, queryClient, saving]);

  const onMainButton = useCallback(() => {
    void submit();
  }, [submit]);

  useTelegramMainButton({
    text: t('onboarding.save'),
    onClick: onMainButton,
    enabled: !saving,
    loading: saving,
  });

  const genderOptions = useMemo(
    () => reference.data?.genders ?? [],
    [reference.data],
  );
  const interestOptions = useMemo(
    () => (reference.data?.interests ?? []).map((i) => ({ value: i.slug, label: i.label })),
    [reference.data],
  );

  // Stările „nu e nimic de arătat" trec toate prin acelasi component, ca să
  // arate identic cu cele din `App.tsx` (logo, culori, acțiune) — vezi
  // `components/StatusScreen.tsx`.
  if (reference.isLoading || existing.isLoading || !ready) {
    return (
      <StatusScreen
        loading
        logo={false}
        testId="status-form-loading"
        title={t('onboarding.loading')}
      />
    );
  }

  if (reference.isError) {
    return (
      <StatusScreen
        logo={false}
        testId="status-form-error"
        title={t('errors.network.title')}
        body={t('onboarding.errors.referenceFailed')}
        actions={[
          {
            label: t('actions.retry', { ns: 'common' }),
            onClick: () => void reference.refetch(),
            testId: 'form-retry',
          },
        ]}
      />
    );
  }

  const serverErrorText = serverError
    ? 'text' in serverError
      ? serverError.text
      : t(serverError.key, serverError.params ?? {})
    : null;

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h1 className="title">{t('onboarding.title')}</h1>
      <p className="body-text">{t('onboarding.subtitle')}</p>

      <Field label={t('onboarding.fields.name')} error={fieldError('name')} required>
        {(props) => (
          <input
            {...props}
            className="input"
            type="text"
            value={draft.name ?? ''}
            onChange={(e) => update('name', e.target.value)}
            autoComplete="name"
          />
        )}
      </Field>

      <Field
        label={t('onboarding.fields.birthDate')}
        error={fieldError('birthDate')}
        hint={t('onboarding.hints.adultsOnly', { min: MIN_REGISTRATION_AGE })}
        required
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="date"
            max={latestAllowedBirthDate()}
            value={draft.birthDate ?? ''}
            onChange={(e) => update('birthDate', e.target.value)}
          />
        )}
      </Field>

      <ChipGroup
        label={t('onboarding.fields.gender')}
        options={genderOptions}
        selected={draft.gender ? [draft.gender] : []}
        onToggle={(value) => update('gender', draft.gender === value ? '' : value)}
        error={fieldError('gender')}
        required
      />

      <Field
        label={t('onboarding.fields.height')}
        error={fieldError('heightCm')}
        required
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="number"
            inputMode="numeric"
            min={MIN_HEIGHT_CM}
            max={MAX_HEIGHT_CM}
            value={draft.heightCm ?? ''}
            onChange={(e) =>
              update('heightCm', e.target.value === '' ? Number.NaN : Number(e.target.value))
            }
          />
        )}
      </Field>

      <Field label={t('onboarding.fields.city')} error={fieldError('city')} required>
        {(props) => (
          <input
            {...props}
            className="input"
            type="text"
            value={draft.city ?? ''}
            onChange={(e) => update('city', e.target.value)}
            autoComplete="address-level2"
          />
        )}
      </Field>

      <ChipGroup
        label={t('onboarding.fields.languages')}
        options={reference.data?.languages ?? []}
        selected={draft.languages ?? []}
        onToggle={(value) => toggle('languages', value)}
        error={fieldError('languages')}
        required
      />

      <ChipGroup
        label={t('onboarding.fields.interests')}
        options={interestOptions}
        selected={draft.interests ?? []}
        onToggle={(value) => toggle('interests', value)}
        error={fieldError('interests')}
        required
      />

      <ChipGroup
        label={t('onboarding.fields.datingStatuses')}
        options={reference.data?.datingStatuses ?? []}
        selected={draft.datingStatuses ?? []}
        onToggle={(value) => toggle('datingStatuses', value)}
        hint={t('onboarding.hints.optional')}
      />

      <ChipGroup
        label={t('onboarding.fields.interestedIn')}
        options={genderOptions}
        selected={draft.interestedIn ?? []}
        onToggle={(value) => toggle('interestedIn', value)}
        hint={t('onboarding.hints.interestedIn')}
      />

      <Field
        label={t('onboarding.fields.about')}
        error={fieldError('about')}
        hint={t('onboarding.hints.optional')}
      >
        {(props) => (
          <textarea
            {...props}
            className="input input--multiline"
            rows={3}
            value={draft.about ?? ''}
            onChange={(e) => update('about', e.target.value)}
          />
        )}
      </Field>

      {serverErrorText ? (
        <p className="error-text" data-testid="form-error">
          {serverErrorText}
        </p>
      ) : null}

      <button type="submit" className="button button--wide" disabled={saving} data-testid="form-submit">
        {saving ? t('onboarding.saving') : t('onboarding.save')}
      </button>
    </form>
  );
}

export default ProfileFormScreen;
