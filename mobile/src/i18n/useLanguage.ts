/**
 * API-ul public pentru citirea și schimbarea limbii.
 *
 * NU adăugăm un store zustand pentru limbă: i18next ține deja starea și emite
 * `languageChanged`, iar `useTranslation()` din react-i18next se re-randează la
 * evenimentul ăsta. Un store paralel ar fi a doua sursă de adevăr, care s-ar
 * putea desincroniza de instanța i18n. Ne abonăm direct la ea.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  type Language,
} from './config';
import { languageStore } from './languageStore';

export interface UseLanguage {
  /** Limba activă acum. */
  current: Language;
  /** Toate limbile suportate, în ordinea de afișare. */
  available: readonly Language[];
  /** Numele limbilor, fiecare în limba ei (ro → „Română", uk → „Українська"). */
  labels: Record<Language, string>;
  /** Schimbă limba ȘI persistă alegerea. */
  setLanguage: (language: Language) => Promise<void>;
}

/**
 * Hook pentru selectorul de limbă.
 *
 * ```tsx
 * const { current, available, labels, setLanguage } = useLanguage();
 * ```
 */
export function useLanguage(): UseLanguage {
  const { i18n } = useTranslation();

  // `i18n.language` poate fi „ro-MD" (după o comutare) sau nedefinit înainte de
  // init; îl aducem mereu la una dintre cele 4 limbi.
  const current: Language = isSupportedLanguage(i18n.language)
    ? i18n.language
    : DEFAULT_LANGUAGE;

  const setLanguage = useCallback(
    async (language: Language) => {
      // Întâi comutăm (UI-ul reacționează imediat), apoi persistăm. Dacă
      // stocarea eșuează, userul vede totuși limba cerută în sesiunea curentă.
      await i18n.changeLanguage(language);
      await languageStore.set(language);
    },
    [i18n],
  );

  return { current, available: SUPPORTED_LANGUAGES, labels: LANGUAGE_LABELS, setLanguage };
}
