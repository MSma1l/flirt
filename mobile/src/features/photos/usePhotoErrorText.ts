/**
 * Traduce un eșec de upload în textul văzut de utilizator.
 *
 * `photosApi` e cod pur: întoarce CHEI (`PhotoErrorReason`), nu propoziții.
 * Hook-ul ăsta e capătul celălalt al tiparului — se cheamă în componentă, unde
 * `t` există, și e singurul loc în care motivul devine text.
 *
 * Recunoașterea erorii e STRUCTURALĂ (proprietatea `isPhotoUploadError`), iar
 * tipurile se importă cu `import type`: ambele dispar la runtime, deci hook-ul
 * NU depinde de modulul `photosApi`. Contează — ecranele care îl folosesc au
 * teste care înlocuiesc `photosApi` cu un mock parțial; un import obișnuit ar
 * face `isPhotoUploadError` să fie `undefined` acolo și hook-ul ar crăpa.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { PhotoErrorReason } from './photosApi';

/** Motivul, dacă eroarea vine de la `photosApi`; altfel `null`. */
function reasonOf(error: unknown): PhotoErrorReason | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as {
    isPhotoUploadError?: boolean;
    reason?: PhotoErrorReason;
  };
  return candidate.isPhotoUploadError === true && candidate.reason
    ? candidate.reason
    : null;
}

/** Întoarce o funcție care transformă orice eroare de poze în text afișabil. */
export function usePhotoErrorText(): (error: unknown) => string {
  const { t } = useTranslation('profile');

  return useCallback(
    (error: unknown) => {
      const reason = reasonOf(error);
      if (reason) {
        return 'key' in reason ? t(reason.key, reason.params) : reason.text;
      }
      // `uploadPhoto` împachetează TOT în `PhotoUploadError`, deci aici ajung
      // doar erori din afara lui. Le păstrăm mesajul dacă au unul (exact ce
      // făceau ecranele înainte de i18n), altfel dăm textul standard.
      if (error instanceof Error && error.message) return error.message;
      return t('photos.errors.uploadFailed');
    },
    [t],
  );
}
