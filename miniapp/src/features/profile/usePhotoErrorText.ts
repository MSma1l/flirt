/**
 * Traduce la afișare motivul unui eșec de poză.
 *
 * `photosApi.ts` întoarce CHEI (`PhotoErrorReason`), nu propoziții: e cod pur,
 * chemat în afara randării, unde `t` nu există. Hook-ul ăsta e locul unde cheia
 * devine text — port al lui `mobile/src/features/photos/usePhotoErrorText.ts`,
 * care nu se poate importa fiindcă atârnă de `photosApi`-ul nativ.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { isPhotoUploadError, uploadErrorReason } from './photosApi';

export function usePhotoErrorText(): (error: unknown) => string {
  const { t } = useTranslation('profile');

  return useCallback(
    (error: unknown): string => {
      const reason = isPhotoUploadError(error) ? error.reason : uploadErrorReason(error);
      if ('text' in reason) return reason.text;
      return t(reason.key, reason.params ?? {});
    },
    [t],
  );
}
