/**
 * Ultimul pas: pozele. Fără ele backendul NU marchează profilul drept complet.
 *
 * `profile_service._sync_profile_completed`:
 *   users.profile_completed = profile.completed ȘI len(photos) >= min_photos
 * Deci anketa salvată nu e de ajuns — de aceea pasul ăsta nu e opțional și de
 * aceea butonul de final RECITEȘTE `/auth/me` în loc să numere el pozele: dacă
 * pragul din configurația serverului diferă, serverul are dreptate, nu noi.
 *
 * Pe web, poza vine dintr-un `<input type="file">`. Înainte de trimitere trece
 * OBLIGATORIU prin redimensionare + recompresie (`imageCompress.ts`): un fișier
 * de 5–12 MB direct de pe telefon ar lua 413 de la backend.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { haptic } from '@/telegram/bridge';
import { useTelegramMainButton } from '@/telegram/useTelegram';

import { browserIo, compressImage } from './imageCompress';
import {
  apiErrorMessage,
  deletePhoto,
  fetchMyProfile,
  uploadPhoto,
  type ApiMessage,
} from './onboardingApi';
import { FEED_PATH } from './paths';
import { formatMb, PHOTO_LIMITS } from './photoLimits';
import { useRefreshCurrentUser } from './useCurrentUser';

export function PhotosScreen() {
  const { t } = useTranslation('miniapp');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshUser = useRefreshCurrentUser();
  const fileInput = useRef<HTMLInputElement>(null);

  const profile = useQuery({
    queryKey: ['profiles', 'me'],
    queryFn: fetchMyProfile,
    staleTime: 0,
  });

  const [photos, setPhotos] = useState<string[] | null>(null);
  const [message, setMessage] = useState<ApiMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  // Lista locală câștigă odată ce am urcat ceva; până atunci, cea de pe server.
  const current = photos ?? profile.data?.photos ?? [];
  const missing = Math.max(0, PHOTO_LIMITS.min - current.length);

  const handleFile = useCallback(async (file: File) => {
    setMessage(null);
    setBusy(true);
    setProgress(0);
    try {
      const prepared = await compressImage(file, browserIo);
      if (!prepared.ok) {
        setMessage(
          prepared.reason === 'tooLarge'
            ? {
                key: 'onboarding.errors.photoStillTooLarge',
                params: {
                  size: formatMb(prepared.sizeBytes),
                  limit: formatMb(PHOTO_LIMITS.maxUploadBytes),
                },
              }
            : { key: `onboarding.errors.photo${prepared.reason === 'type' ? 'Type' : 'Decode'}` },
        );
        return;
      }
      const updated = await uploadPhoto(prepared.blob, prepared.fileName, setProgress);
      setPhotos(updated);
      haptic('light');
      await queryClient.invalidateQueries({ queryKey: ['profiles', 'me'] });
    } catch (error) {
      setMessage(apiErrorMessage(error, 'onboarding.errors.uploadFailed'));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }, [queryClient]);

  const onPick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Golim câmpul: altfel, alegerea ACELUIAȘI fișier a doua oară nu ar mai
      // declanșa `change` și ecranul ar părea blocat.
      event.target.value = '';
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onDelete = useCallback(
    async (url: string) => {
      setBusy(true);
      setMessage(null);
      try {
        const updated = await deletePhoto(url);
        setPhotos(updated);
        await queryClient.invalidateQueries({ queryKey: ['profiles', 'me'] });
      } catch (error) {
        setMessage(apiErrorMessage(error, 'onboarding.errors.deleteFailed'));
      } finally {
        setBusy(false);
      }
    },
    [queryClient],
  );

  const finish = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const user = await refreshUser();
      if (user?.profile_completed) {
        void navigate(FEED_PATH, { replace: true });
        return;
      }
      // Serverul spune că profilul încă nu e complet. Nu îl contrazicem și nu
      // aruncăm utilizatorul într-un feed gol — îi spunem ce mai lipsește.
      setMessage({ key: 'onboarding.errors.notCompleteYet', params: { min: PHOTO_LIMITS.min } });
    } catch (error) {
      setMessage(apiErrorMessage(error, 'onboarding.errors.saveFailed'));
    } finally {
      setBusy(false);
    }
  }, [navigate, refreshUser]);

  const onMainButton = useCallback(() => {
    void finish();
  }, [finish]);

  useTelegramMainButton({
    text: t('photos.finish'),
    onClick: onMainButton,
    enabled: !busy && missing === 0,
    loading: busy,
  });

  const messageText = message
    ? 'text' in message
      ? message.text
      : t(message.key, message.params ?? {})
    : null;

  return (
    <div className="form">
      <h1 className="title">{t('photos.title')}</h1>
      <p className="body-text">
        {missing > 0
          ? t('photos.needMore', { n: missing, min: PHOTO_LIMITS.min })
          : t('photos.enough')}
      </p>

      <div className="photo-grid">
        {current.map((url) => (
          <div className="photo-tile" key={url}>
            <img className="photo-tile__image" src={url} alt="" />
            <button
              type="button"
              className="photo-tile__remove"
              aria-label={t('photos.remove')}
              disabled={busy}
              onClick={() => void onDelete(url)}
            >
              ×
            </button>
          </div>
        ))}

        {current.length < PHOTO_LIMITS.max ? (
          <button
            type="button"
            className="photo-tile photo-tile--add"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            data-testid="photos-add"
          >
            {busy ? `${Math.round(progress * 100)}%` : '+'}
          </button>
        ) : null}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="visually-hidden"
        onChange={onPick}
        data-testid="photos-input"
        aria-label={t('photos.add')}
      />

      {messageText ? (
        <p className="error-text" data-testid="photos-error">
          {messageText}
        </p>
      ) : null}

      <p className="caption">
        {t('photos.limits', {
          max: PHOTO_LIMITS.max,
          size: formatMb(PHOTO_LIMITS.maxUploadBytes),
        })}
      </p>

      <button
        type="button"
        className="button button--wide"
        disabled={busy || missing > 0}
        onClick={() => void finish()}
        data-testid="photos-finish"
      >
        {t('photos.finish')}
      </button>
    </div>
  );
}

export default PhotosScreen;
