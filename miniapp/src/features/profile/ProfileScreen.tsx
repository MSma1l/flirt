/**
 * Profilul propriu în Telegram Mini App: vizualizare + editare, într-un ecran.
 *
 * Portat din `mobile/src/features/profile/` și `mobile/app/profile/edit.tsx`,
 * rescris pentru DOM. Pe mobil sunt două ecrane (profilul stă în Setări, iar
 * editarea e o rută separată); aici sunt două MODURI ale aceluiași ecran,
 * fiindcă Mini App-ul nu are stivă de navigație proprie și un drum dus-întors
 * prin altă rută ar însemna încă o încărcare completă.
 *
 * REUTILIZAT prin import, nu copiat:
 *  - tipurile anketei (`AnketaDraft`, `Reference`) din `@mobile/features/anketa/types`;
 *  - tipul `MyProfile` din `@mobile/features/profile/profileApi`;
 *  - primitivele de validare din `@mobile/utils/validation` (via `./validation`).
 * Motivele pentru care restul a trebuit portat sunt scrise în fiecare modul.
 *
 * Câmpurile editabile sunt EXACT cele acceptate de `AnketaIn`
 * (`backend/app/schemas/profile.py`). Preferințele de căutare NU sunt aici:
 * backend-ul le persistă în `UserSettings`, iar ecranul lor e Setări.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_LANGUAGE, normalizeLanguage } from '@mobile/i18n/config';

import { StatusScreen } from '@/components/StatusScreen';

import { PhotoManager, type PhotoTile } from './PhotoManager';
import {
  fetchMyProfile,
  fetchReference,
  interestLabel,
  labelOf,
  saveProfile,
  type AnketaDraft,
  type MyProfileFull,
} from './profileApi';
import { PHOTO_LIMITS, preparePhoto, validateCanAddPhoto, validatePhotoCount } from './photoResize';
import { deletePhoto, moveItem, reorderPhotos, uploadPhoto } from './photosApi';
import { usePhotoErrorText } from './usePhotoErrorText';
import { isValid, MAX_ABOUT_LENGTH, validateProfile, type FieldErrors } from './validation';

import './profile.css';

/** Draftul pornit dintr-un profil existent (sau gol, la un cont nou). */
function draftFrom(profile: MyProfileFull | null): Partial<AnketaDraft> {
  if (!profile) return { languages: [], datingStatuses: [], interests: [] };
  return {
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
  };
}

/** Chip selectabil — echivalentul DOM al lui `Chip` din ecranul nativ. */
function Chip({
  label,
  selected,
  onToggle,
  testId,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`pf-chip pf-chip--selectable${selected ? ' pf-chip--on' : ''}`}
      aria-pressed={selected}
      onClick={onToggle}
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {label}
    </button>
  );
}

export function ProfileScreen() {
  const { t, i18n } = useTranslation(['profile', 'common', 'settings', 'verification']);
  const language = normalizeLanguage(i18n.language) ?? DEFAULT_LANGUAGE;
  const queryClient = useQueryClient();
  const photoErrorText = usePhotoErrorText();

  const profileQuery = useQuery({ queryKey: ['my-profile'], queryFn: fetchMyProfile });
  const referenceQuery = useQuery({
    // Limba intră în cheie: etichetele vin deja localizate de la server, deci un
    // cache comun tuturor limbilor ar servi etichetele vechi după comutare.
    queryKey: ['profile-reference', language],
    queryFn: () => fetchReference(language),
  });

  const profile = profileQuery.data ?? null;
  const reference = referenceQuery.data;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<AnketaDraft>>({});
  const [errors, setErrors] = useState<FieldErrors>({});

  const [photos, setPhotos] = useState<string[]>([]);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [pending, setPending] = useState<{ url: string; progress: number } | null>(null);

  // Pre-completează formularul și pozele când sosește profilul. Un cont fără
  // anketă (`null`, adică 404 de la server) deschide direct editarea: n-are ce
  // să vizualizeze, iar formularul gol e singurul lucru util pe ecran.
  useEffect(() => {
    if (profileQuery.isSuccess) {
      setDraft(draftFrom(profile));
      setPhotos(profile?.photos ?? []);
      if (!profile) setEditing(true);
    }
  }, [profileQuery.isSuccess, profile]);

  const setField = <K extends keyof AnketaDraft>(field: K, value: AnketaDraft[K]) => {
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const toggleMulti = (field: 'languages' | 'datingStatuses' | 'interests', key: string) => {
    const current = (draft[field] as string[] | undefined) ?? [];
    setField(field, current.includes(key) ? current.filter((v) => v !== key) : [...current, key]);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: AnketaDraft & { photos: string[] }) => saveProfile(payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(['my-profile'], saved);
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      // Profilul propriu decide ce văd ceilalți în feed; cache-ul feed-ului
      // altcuiva nu ne privește, dar al nostru (dacă există) da.
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      setEditing(false);
    },
  });

  const handleSave = () => {
    const allErrors = validateProfile(draft);
    setErrors(allErrors);

    const countError = validatePhotoCount(photos.length);
    setPhotosError(countError);

    if (!isValid(allErrors) || countError) return;

    // `photos` merge OBLIGATORIU în payload: `PUT /profiles/me` rescrie lista de
    // poze, deci fără ea backend-ul le-ar șterge pe toate la o simplă editare.
    saveMutation.mutate({ ...(draft as AnketaDraft), photos });
  };

  /* ------------------------------- Poze -------------------------------- */

  const handleAddPhoto = async (file: File) => {
    const fullError = validateCanAddPhoto(photos.length);
    if (fullError) {
      setPhotosError(fullError);
      return;
    }
    setPhotosError(null);

    // Redimensionare + recompresie ÎNAINTE de rețea: o poză de telefon are 5–12
    // MB, peste limita backend-ului (8 MB), și ar fi respinsă cu 413.
    const prepared = await preparePhoto(file);
    if (!prepared.ok) {
      setPhotosError(prepared.message);
      return;
    }

    setPending({ url: prepared.previewUrl, progress: 0 });
    setPhotosBusy(true);
    try {
      const urls = await uploadPhoto(prepared.blob, prepared.fileName, {
        onProgress: (ratio) => setPending((p) => (p ? { ...p, progress: ratio } : p)),
      });
      setPhotos(urls);
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch (error) {
      setPhotosError(photoErrorText(error));
    } finally {
      // `blob:` rămâne alocat până îl revocăm explicit.
      URL.revokeObjectURL(prepared.previewUrl);
      setPending(null);
      setPhotosBusy(false);
    }
  };

  const handleRemovePhoto = async (index: number) => {
    const url = photos[index];
    if (!url) return;

    setPhotosError(null);
    setPhotosBusy(true);
    try {
      const urls = await deletePhoto(url);
      setPhotos(urls);
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch {
      setPhotosError(t('edit.deleteError'));
    } finally {
      setPhotosBusy(false);
    }
  };

  const handleMovePhoto = async (from: number, to: number) => {
    const previous = photos;
    const next = moveItem(photos, from, to);

    setPhotosError(null);
    setPhotos(next); // optimist — reordonarea trebuie să pară instantanee
    setPhotosBusy(true);
    try {
      setPhotos(await reorderPhotos(next));
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
    } catch {
      setPhotos(previous); // înapoi la ordinea reală de pe server
      setPhotosError(t('edit.reorderError'));
    } finally {
      setPhotosBusy(false);
    }
  };

  const tiles = useMemo<PhotoTile[]>(
    () => [
      ...photos.map((url) => ({ key: url, url })),
      ...(pending ? [{ key: pending.url, url: pending.url, uploading: true, progress: pending.progress }] : []),
    ],
    [photos, pending],
  );

  /* ------------------------------ Stările ------------------------------ */

  if (profileQuery.isLoading || referenceQuery.isLoading) {
    return (
      <StatusScreen loading logo={false} testId="status-profile-loading" title={t('edit.loading')} />
    );
  }

  if (profileQuery.isError || referenceQuery.isError || !reference) {
    return (
      <StatusScreen
        logo={false}
        testId="status-profile-error"
        title={t('edit.loadError')}
        actions={[
          {
            label: t('edit.retry'),
            testId: 'profile-retry',
            onClick: () => {
              void profileQuery.refetch();
              void referenceQuery.refetch();
            },
          },
        ]}
      />
    );
  }

  const aboutLength = (draft.about ?? '').length;

  return (
    <div className="profile-screen">
      <header className="profile-screen__header">
        <h1 className="title">{editing ? t('edit.title') : profile?.name || t('edit.title')}</h1>
        {profile && !editing ? (
          <p className="caption">
            {profile.age ? `${profile.age} · ` : ''}
            {profile.city}
          </p>
        ) : null}
      </header>

      {/* Starea de verificare (TZ 2.2) — badge doar când serverul a confirmat-o. */}
      {profile ? (
        profile.verified ? (
          <p className="profile-verified" data-testid="verified-badge">
            {t('verification:verified')}
          </p>
        ) : (
          <p className="caption" data-testid="unverified-hint">
            {t('verification:intro')}
          </p>
        )
      ) : null}

      {!editing && profile ? (
        <>
          <div className="profile-gallery" data-testid="profile-gallery">
            {photos.length > 0 ? (
              photos.map((url, index) => (
                <img
                  key={url}
                  className="profile-gallery__img"
                  src={url}
                  alt={
                    index === 0
                      ? t('photos.a11y.mainPhoto')
                      : t('photos.a11y.photo', { number: index + 1 })
                  }
                />
              ))
            ) : (
              <p className="caption">
                {t('photos.counter', {
                  current: 0,
                  max: PHOTO_LIMITS.max,
                  min: PHOTO_LIMITS.min,
                })}
              </p>
            )}
          </div>

          <dl className="profile-facts">
            <dt className="caption">{t('edit.gender')}</dt>
            <dd className="body-text">{labelOf(reference.genders, profile.gender)}</dd>

            <dt className="caption">{t('edit.height')}</dt>
            <dd className="body-text">{profile.heightCm}</dd>

            <dt className="caption">{t('edit.city')}</dt>
            <dd className="body-text">
              {profile.city}
              {profile.street ? `, ${profile.street}` : ''}
            </dd>

            {profile.nationality ? (
              <>
                <dt className="caption">{t('edit.nationality')}</dt>
                <dd className="body-text">{profile.nationality}</dd>
              </>
            ) : null}

            <dt className="caption">{t('edit.languages')}</dt>
            <dd className="body-text">
              {profile.languages.map((v) => labelOf(reference.languages, v)).join(', ') || '—'}
            </dd>
          </dl>

          {profile.about ? <p className="body-text profile-about">{profile.about}</p> : null}

          {profile.datingStatuses.length > 0 ? (
            <section className="profile-section">
              <p className="caption">{t('edit.datingStatus')}</p>
              <div className="pf-chip-row">
                {profile.datingStatuses.map((v) => (
                  <span className="pf-chip" key={v}>
                    {labelOf(reference.datingStatuses, v)}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {profile.interests.length > 0 ? (
            <section className="profile-section">
              <p className="caption">{t('edit.interests')}</p>
              <div className="pf-chip-row">
                {profile.interests.map((slug) => (
                  <span className="pf-chip" key={slug}>
                    {interestLabel(reference.interests, slug)}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <button
            type="button"
            className="button profile-screen__cta"
            onClick={() => setEditing(true)}
            data-testid="start-edit"
          >
            {t('settings:links.profileEdit')}
          </button>
        </>
      ) : (
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSave();
          }}
        >
          <PhotoManager
            tiles={tiles}
            savedCount={photos.length}
            onAdd={(file) => void handleAddPhoto(file)}
            onRemove={(index) => void handleRemovePhoto(index)}
            onMove={(from, to) => void handleMovePhoto(from, to)}
            busy={photosBusy || saveMutation.isPending}
            error={photosError}
          />

          <label className="pf-field">
            <span className="caption">{t('edit.name')}</span>
            <input
              className="pf-field__input"
              value={draft.name ?? ''}
              placeholder={t('edit.namePlaceholder')}
              onChange={(e) => setField('name', e.target.value)}
              data-testid="field-name"
            />
            {errors.name ? <span className="pf-field__error">{errors.name}</span> : null}
          </label>

          <label className="pf-field">
            <span className="caption">{t('edit.birthDate')}</span>
            <input
              className="pf-field__input"
              type="date"
              value={draft.birthDate ?? ''}
              onChange={(e) => setField('birthDate', e.target.value)}
              data-testid="field-birth-date"
            />
            {errors.birthDate ? <span className="pf-field__error">{errors.birthDate}</span> : null}
          </label>

          <fieldset className="pf-field">
            <legend className="caption">{t('edit.gender')}</legend>
            <div className="pf-chip-row">
              {reference.genders.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={draft.gender === o.value}
                  onToggle={() => setField('gender', o.value)}
                  testId={`gender-${o.value}`}
                />
              ))}
            </div>
            {errors.gender ? <span className="pf-field__error">{errors.gender}</span> : null}
          </fieldset>

          <label className="pf-field">
            <span className="caption">{t('edit.height')}</span>
            <input
              className="pf-field__input"
              inputMode="numeric"
              value={draft.heightCm != null ? String(draft.heightCm) : ''}
              placeholder={t('edit.heightPlaceholder')}
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, '');
                // Câmp golit = „nimic ales", nu 0: validarea trebuie să ceară o
                // valoare, nu să reclame o înălțime absurdă.
                setDraft((d) => ({
                  ...d,
                  heightCm: digits ? parseInt(digits, 10) : undefined,
                }));
              }}
              data-testid="field-height"
            />
            {errors.heightCm ? <span className="pf-field__error">{errors.heightCm}</span> : null}
          </label>

          <label className="pf-field">
            <span className="caption">{t('edit.city')}</span>
            <input
              className="pf-field__input"
              value={draft.city ?? ''}
              placeholder={t('edit.cityPlaceholder')}
              onChange={(e) => setField('city', e.target.value)}
              data-testid="field-city"
            />
            {errors.city ? <span className="pf-field__error">{errors.city}</span> : null}
          </label>

          <label className="pf-field">
            <span className="caption">{t('edit.street')}</span>
            <input
              className="pf-field__input"
              value={draft.street ?? ''}
              placeholder={t('edit.streetPlaceholder')}
              onChange={(e) => setField('street', e.target.value)}
              data-testid="field-street"
            />
            {errors.street ? <span className="pf-field__error">{errors.street}</span> : null}
          </label>

          <label className="pf-field">
            <span className="caption">{t('edit.nationality')}</span>
            <input
              className="pf-field__input"
              value={draft.nationality ?? ''}
              onChange={(e) => setField('nationality', e.target.value)}
              data-testid="field-nationality"
            />
          </label>

          <fieldset className="pf-field">
            <legend className="caption">{t('edit.languages')}</legend>
            <div className="pf-chip-row">
              {reference.languages.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={(draft.languages ?? []).includes(o.value)}
                  onToggle={() => toggleMulti('languages', o.value)}
                  testId={`language-${o.value}`}
                />
              ))}
            </div>
            {errors.languages ? <span className="pf-field__error">{errors.languages}</span> : null}
          </fieldset>

          <label className="pf-field">
            <span className="caption">
              {t('edit.about', { current: aboutLength, max: MAX_ABOUT_LENGTH })}
            </span>
            <textarea
              className="pf-field__input pf-field__textarea"
              maxLength={MAX_ABOUT_LENGTH}
              value={draft.about ?? ''}
              placeholder={t('edit.aboutPlaceholder')}
              onChange={(e) => setField('about', e.target.value)}
              data-testid="field-about"
            />
            {errors.about ? <span className="pf-field__error">{errors.about}</span> : null}
          </label>

          <fieldset className="pf-field">
            <legend className="caption">{t('edit.datingStatus')}</legend>
            <div className="pf-chip-row">
              {reference.datingStatuses.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  selected={(draft.datingStatuses ?? []).includes(o.value)}
                  onToggle={() => toggleMulti('datingStatuses', o.value)}
                  testId={`status-${o.value}`}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="pf-field">
            <legend className="caption">{t('edit.interests')}</legend>
            <div className="pf-chip-row">
              {reference.interests.map((o) => (
                <Chip
                  key={o.slug}
                  label={o.label}
                  selected={(draft.interests ?? []).includes(o.slug)}
                  onToggle={() => toggleMulti('interests', o.slug)}
                  testId={`interest-${o.slug}`}
                />
              ))}
            </div>
            {errors.interests ? <span className="pf-field__error">{errors.interests}</span> : null}
          </fieldset>

          {saveMutation.isError ? (
            <p className="error-text" role="alert" data-testid="save-error">
              {t('edit.saveError')}
            </p>
          ) : null}

          <div className="profile-form__actions">
            {profile ? (
              <button
                type="button"
                className="button button--ghost"
                disabled={saveMutation.isPending}
                onClick={() => {
                  // Renunțare: revenim exact la ce e pe server, inclusiv pozele
                  // (ele se salvează imediat, deci lista lor e deja cea reală).
                  setDraft(draftFrom(profile));
                  setErrors({});
                  setPhotosError(null);
                  setEditing(false);
                }}
                data-testid="cancel-edit"
              >
                {t('common:actions.cancel')}
              </button>
            ) : null}
            <button
              type="submit"
              className="button"
              disabled={saveMutation.isPending}
              data-testid="save-profile"
            >
              {t('edit.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default ProfileScreen;
