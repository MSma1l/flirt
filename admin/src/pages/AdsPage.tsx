/**
 * Reclame: SETĂRI globale (după câte swipe-uri apare reclama, limita de secunde
 * video, on/off) + listă de reclame cu CREARE / EDITARE / ȘTERGERE.
 *
 * Aplicația mobilă servește aceste reclame între swipe-uri; ecranul ăsta e
 * singura cale de a le administra. Ștergerea unei reclame o scoate imediat din
 * rotație, deci cere confirmare.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import {
  createAd,
  deleteAd,
  fetchAdSettings,
  fetchAds,
  updateAd,
  updateAdSettings,
} from '../api/admin';
import type { Ad, AdInput, AdSettings, AdTargetGender } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  Select,
  TextInput,
} from '../components/ui';
import { errorMessage } from '../lib/errors';
import {
  formatDateTime,
  formatNumber,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from '../lib/format';

/* --------------------------------- Reclame --------------------------------- */

interface FormState {
  title: string;
  video_url: string;
  image_url: string;
  duration_seconds: string;
  weight: string;
  active: boolean;
  /** '' = Oricine (null), altfel 'male' | 'female'. */
  target_gender: '' | AdTargetGender;
  target_age_min: string;
  target_age_max: string;
  starts_at: string; // valoare `datetime-local`
  ends_at: string; // valoare `datetime-local`
}

const EMPTY_FORM: FormState = {
  title: '',
  video_url: '',
  image_url: '',
  duration_seconds: '15',
  weight: '1',
  active: true,
  target_gender: '',
  target_age_min: '',
  target_age_max: '',
  starts_at: '',
  ends_at: '',
};

function toForm(ad: Ad): FormState {
  return {
    title: ad.title,
    video_url: ad.video_url ?? '',
    image_url: ad.image_url ?? '',
    duration_seconds: String(ad.duration_seconds),
    weight: String(ad.weight),
    active: ad.active,
    target_gender: ad.target_gender ?? '',
    target_age_min: ad.target_age_min == null ? '' : String(ad.target_age_min),
    target_age_max: ad.target_age_max == null ? '' : String(ad.target_age_max),
    starts_at: ad.starts_at ? toDateTimeLocalValue(ad.starts_at) : '',
    ends_at: ad.ends_at ? toDateTimeLocalValue(ad.ends_at) : '',
  };
}

/** Câmp numeric opțional din formular → `number | null` (gol/invalid = null). */
function optionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** `datetime-local` opțional → ISO UTC sau `null` când e gol. */
function optionalIso(value: string): string | null {
  if (value.trim() === '') return null;
  const iso = fromDateTimeLocalValue(value);
  return iso === '' ? null : iso;
}

function toPayload(form: FormState): AdInput {
  return {
    title: form.title.trim(),
    video_url: form.video_url.trim() === '' ? null : form.video_url.trim(),
    image_url: form.image_url.trim() === '' ? null : form.image_url.trim(),
    duration_seconds: Math.trunc(Number(form.duration_seconds)),
    weight: Math.trunc(Number(form.weight)),
    active: form.active,
    target_gender: form.target_gender === '' ? null : form.target_gender,
    target_age_min: optionalInt(form.target_age_min),
    target_age_max: optionalInt(form.target_age_max),
    starts_at: optionalIso(form.starts_at),
    ends_at: optionalIso(form.ends_at),
  };
}

/** Eticheta scurtă de targetare pentru tabel: „♀ 18–30", „♂ 18+", „Toți". */
function targetLabel(ad: Ad): string {
  const genderIcon =
    ad.target_gender === 'female' ? '♀' : ad.target_gender === 'male' ? '♂' : null;
  let ageLabel: string | null = null;
  if (ad.target_age_min != null && ad.target_age_max != null) {
    ageLabel = `${ad.target_age_min}–${ad.target_age_max}`;
  } else if (ad.target_age_min != null) {
    ageLabel = `${ad.target_age_min}+`;
  } else if (ad.target_age_max != null) {
    ageLabel = `≤${ad.target_age_max}`;
  }
  const parts = [genderIcon, ageLabel].filter(Boolean);
  return parts.length === 0 ? 'Toți' : parts.join(' ');
}

/** CTR ca procent formatat, sau „—" când nu există afișări. */
function ctrLabel(impressions: number, clicks: number): string {
  if (!impressions || impressions <= 0) return '—';
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

/** Eticheta de programare pentru tabel: „Mereu", „din …", „până …", „… – …". */
function scheduleLabel(ad: Ad): string {
  const start = ad.starts_at ? formatDateTime(ad.starts_at) : null;
  const end = ad.ends_at ? formatDateTime(ad.ends_at) : null;
  if (start && end) return `${start} – ${end}`;
  if (start) return `din ${start}`;
  if (end) return `până ${end}`;
  return 'Mereu';
}

export function AdsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ ad: Ad | null } | null>(null);
  const [toDelete, setToDelete] = useState<Ad | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['ads'], queryFn: fetchAds });

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['ads'] }).then(() => undefined);

  const save = useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: AdInput }) =>
      id === null ? createAd(input) : updateAd(id, input),
    onSuccess: async () => {
      setEditing(null);
      setFormError(null);
      await invalidate();
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteAd(id),
    onSuccess: async () => {
      setToDelete(null);
      setFormError(null);
      await invalidate();
    },
    onError: (error: unknown) => setFormError(errorMessage(error)),
  });

  const ads = query.data ?? [];

  return (
    <>
      <AdSettingsCard />

      <Card
        title="Reclame"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setFormError(null);
              setEditing({ ad: null });
            }}
          >
            Reclamă nouă
          </Button>
        }
      >
        {query.isPending ? (
          <LoadingState label="Se încarcă reclamele…" />
        ) : query.isError ? (
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        ) : ads.length === 0 ? (
          <EmptyState
            title="Nicio reclamă"
            hint="Adaugă prima reclamă — apare în rotația din aplicația mobilă."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Titlu</th>
                  <th>Durată</th>
                  <th>Weight</th>
                  <th>Targetare</th>
                  <th>Programare</th>
                  <th>Afișări</th>
                  <th>Click-uri</th>
                  <th>CTR</th>
                  <th>Stare</th>
                  <th>Actualizat</th>
                  <th aria-label="Acțiuni" />
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => (
                  <tr key={ad.id}>
                    <td>{ad.title}</td>
                    <td className="mono">{ad.duration_seconds}s</td>
                    <td className="mono">{ad.weight}</td>
                    <td>{targetLabel(ad)}</td>
                    <td className="muted mono">{scheduleLabel(ad)}</td>
                    <td className="mono">{formatNumber(ad.impressions)}</td>
                    <td className="mono">{formatNumber(ad.clicks)}</td>
                    <td className="mono">{ctrLabel(ad.impressions, ad.clicks)}</td>
                    <td>
                      <Badge tone={ad.active ? 'success' : 'neutral'}>
                        {ad.active ? 'activă' : 'inactivă'}
                      </Badge>
                    </td>
                    <td className="muted mono">{formatDateTime(ad.updated_at)}</td>
                    <td>
                      <div className="table__actions">
                        <Button
                          small
                          onClick={() => {
                            setFormError(null);
                            setEditing({ ad });
                          }}
                        >
                          Editează
                        </Button>
                        <Button
                          small
                          variant="danger"
                          onClick={() => {
                            setFormError(null);
                            setToDelete(ad);
                          }}
                        >
                          Șterge
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <AdFormModal
          ad={editing.ad}
          busy={save.isPending}
          errorMessage={formError}
          onCancel={() => {
            setEditing(null);
            setFormError(null);
          }}
          onSubmit={(input) => save.mutate({ id: editing.ad?.id ?? null, input })}
        />
      ) : null}

      {toDelete ? (
        <ConfirmDialog
          title="Șterge reclama"
          message={`„${toDelete.title}" iese imediat din rotația din aplicație.`}
          confirmLabel="Șterge reclama"
          busy={remove.isPending}
          errorMessage={formError}
          onCancel={() => {
            setToDelete(null);
            setFormError(null);
          }}
          onConfirm={() => remove.mutate(toDelete.id)}
        />
      ) : null}
    </>
  );
}

function AdFormModal({
  ad,
  busy,
  errorMessage: error,
  onCancel,
  onSubmit,
}: {
  ad: Ad | null;
  busy: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onSubmit: (input: AdInput) => void;
}): JSX.Element {
  const [form, setForm] = useState<FormState>(ad ? toForm(ad) : EMPTY_FORM);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((current) => ({ ...current, [key]: value }));

  const duration = Number(form.duration_seconds);
  const weight = Number(form.weight);

  const ageMin = optionalInt(form.target_age_min);
  const ageMax = optionalInt(form.target_age_max);
  const startIso = optionalIso(form.starts_at);
  const endIso = optionalIso(form.ends_at);

  // Reguli încrucișate: vârsta min ≤ max (când ambele sunt setate) și
  // starts_at ≤ ends_at (când ambele sunt setate).
  const ageRangeError =
    ageMin != null && ageMax != null && ageMin > ageMax
      ? 'Vârsta minimă nu poate depăși vârsta maximă.'
      : null;
  const dateRangeError =
    startIso != null && endIso != null && startIso > endIso
      ? 'Data de început trebuie să fie înaintea datei de sfârșit.'
      : null;
  const rangeError = ageRangeError ?? dateRangeError;

  const valid =
    form.title.trim().length > 0 &&
    Number.isFinite(duration) &&
    duration > 0 &&
    Number.isFinite(weight) &&
    weight >= 0 &&
    rangeError === null;

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!valid || busy) return;
    onSubmit(toPayload(form));
  };

  return (
    <Modal title={ad ? 'Editează reclama' : 'Reclamă nouă'} onClose={onCancel} wide>
      <form className="modal__body" onSubmit={submit}>
        <Field label="Titlu *" htmlFor="ad-title">
          <TextInput
            id="ad-title"
            value={form.title}
            maxLength={200}
            required
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>

        <Field label="URL video" htmlFor="ad-video">
          <TextInput
            id="ad-video"
            type="url"
            value={form.video_url}
            onChange={(e) => set('video_url', e.target.value)}
          />
        </Field>

        <Field label="URL imagine (opțional)" htmlFor="ad-image">
          <TextInput
            id="ad-image"
            type="url"
            value={form.image_url}
            onChange={(e) => set('image_url', e.target.value)}
          />
        </Field>

        <div className="form-grid">
          <Field label="Durată (secunde) *" htmlFor="ad-duration">
            <TextInput
              id="ad-duration"
              type="number"
              min={1}
              value={form.duration_seconds}
              required
              onChange={(e) => set('duration_seconds', e.target.value)}
            />
          </Field>
          <Field label="Weight" htmlFor="ad-weight">
            <TextInput
              id="ad-weight"
              type="number"
              min={0}
              value={form.weight}
              onChange={(e) => set('weight', e.target.value)}
            />
          </Field>
        </div>

        <h3 className="card__title" style={{ margin: 0, fontSize: 'var(--text-sm, 0.9rem)' }}>
          Targetare
        </h3>
        <div className="form-grid">
          <Field label="Gen" htmlFor="ad-gender">
            <Select
              id="ad-gender"
              value={form.target_gender}
              onChange={(e) => set('target_gender', e.target.value as FormState['target_gender'])}
            >
              <option value="">Oricine</option>
              <option value="male">Bărbați</option>
              <option value="female">Femei</option>
            </Select>
          </Field>
          <Field label="Vârstă min." htmlFor="ad-age-min">
            <TextInput
              id="ad-age-min"
              type="number"
              min={0}
              max={120}
              placeholder="fără limită"
              value={form.target_age_min}
              onChange={(e) => set('target_age_min', e.target.value)}
            />
          </Field>
          <Field label="Vârstă max." htmlFor="ad-age-max">
            <TextInput
              id="ad-age-max"
              type="number"
              min={0}
              max={120}
              placeholder="fără limită"
              value={form.target_age_max}
              onChange={(e) => set('target_age_max', e.target.value)}
            />
          </Field>
        </div>

        <h3 className="card__title" style={{ margin: 0, fontSize: 'var(--text-sm, 0.9rem)' }}>
          Programare
        </h3>
        <div className="form-grid">
          <Field label="Începe la (opțional)" htmlFor="ad-starts">
            <TextInput
              id="ad-starts"
              type="datetime-local"
              value={form.starts_at}
              onChange={(e) => set('starts_at', e.target.value)}
            />
          </Field>
          <Field label="Se termină la (opțional)" htmlFor="ad-ends">
            <TextInput
              id="ad-ends"
              type="datetime-local"
              value={form.ends_at}
              onChange={(e) => set('ends_at', e.target.value)}
            />
          </Field>
        </div>

        <label className="field field--check" htmlFor="ad-active">
          <input
            id="ad-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
          <span className="field__label" style={{ margin: 0 }}>
            Activă (intră în rotație)
          </span>
        </label>

        {rangeError ? <div className="alert">{rangeError}</div> : null}
        {error ? <div className="alert">{error}</div> : null}

        <div className="modal__actions">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Anulează
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || busy}>
            {busy ? 'Se salvează…' : ad ? 'Salvează' : 'Creează reclama'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------- Setări ---------------------------------- */

interface SettingsForm {
  swipes_before_ad: string;
  max_video_seconds: string;
  enabled: boolean;
}

function toSettingsForm(settings: AdSettings): SettingsForm {
  return {
    swipes_before_ad: String(settings.swipes_before_ad),
    max_video_seconds: String(settings.max_video_seconds),
    enabled: settings.enabled,
  };
}

function AdSettingsCard(): JSX.Element {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['ad-settings'], queryFn: fetchAdSettings });

  // Sincronizează formularul cu datele venite de la backend (o singură dată,
  // când sosesc), fără a suprascrie ce editează adminul între timp.
  useEffect(() => {
    if (query.data && form === null) setForm(toSettingsForm(query.data));
  }, [query.data, form]);

  const save = useMutation({
    mutationFn: (body: AdSettings) => updateAdSettings(body),
    onSuccess: async (settings) => {
      setError(null);
      setNotice('Setările reclamelor au fost salvate.');
      setForm(toSettingsForm(settings));
      await queryClient.invalidateQueries({ queryKey: ['ad-settings'] });
    },
    onError: (mutationError: unknown) => setError(errorMessage(mutationError)),
  });

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]): void =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const swipes = form ? Number(form.swipes_before_ad) : NaN;
  const maxSeconds = form ? Number(form.max_video_seconds) : NaN;
  const valid =
    form !== null &&
    Number.isFinite(swipes) &&
    swipes >= 1 &&
    Number.isFinite(maxSeconds) &&
    maxSeconds >= 1;

  const submit = (submitEvent: FormEvent): void => {
    submitEvent.preventDefault();
    if (!form || !valid || save.isPending) return;
    setNotice(null);
    save.mutate({
      swipes_before_ad: Math.trunc(swipes),
      max_video_seconds: Math.trunc(maxSeconds),
      enabled: form.enabled,
    });
  };

  return (
    <Card title="Setări reclame">
      {query.isPending || form === null ? (
        <LoadingState label="Se încarcă setările…" />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <form className="modal__body" onSubmit={submit}>
          {notice ? <div className="alert alert--success">{notice}</div> : null}

          <div className="form-grid">
            <Field label="Swipe-uri până la reclamă *" htmlFor="settings-swipes">
              <TextInput
                id="settings-swipes"
                type="number"
                min={1}
                value={form.swipes_before_ad}
                required
                onChange={(e) => set('swipes_before_ad', e.target.value)}
              />
            </Field>
            <Field label="Limită video (secunde) *" htmlFor="settings-max-seconds">
              <TextInput
                id="settings-max-seconds"
                type="number"
                min={1}
                value={form.max_video_seconds}
                required
                onChange={(e) => set('max_video_seconds', e.target.value)}
              />
            </Field>
          </div>

          <label className="field field--check" htmlFor="settings-enabled">
            <input
              id="settings-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => set('enabled', e.target.checked)}
            />
            <span className="field__label" style={{ margin: 0 }}>
              Reclame activate
            </span>
          </label>

          {error ? <div className="alert">{error}</div> : null}

          <div className="modal__actions">
            <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
              {save.isPending ? 'Se salvează…' : 'Salvează setările'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
