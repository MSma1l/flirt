/**
 * Limba panoului: română (implicită) + rusă.
 *
 * Fără bibliotecă: textele stau în dicționare tipate, câte unul pe zonă
 * (`i18n/messages/<zonă>.ts`), definite cu `defineMessages`. Tipul obligă
 * varianta rusă să aibă EXACT aceleași chei ca cea română, deci o cheie uitată
 * pică la `tsc`, nu în fața administratorului.
 *
 * Fără provider (ex. în teste) limba e `ro` — testele afirmă texte românești.
 * Preferința e o setare de UI, nu un secret → `localStorage` e potrivit aici.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { setFormatLocale } from '../lib/format';

export type Language = 'ro' | 'ru';

export const LANGUAGES: readonly Language[] = ['ro', 'ru'];

export const LANGUAGE_LABELS: Record<Language, string> = { ro: 'Română', ru: 'Русский' };

const STORAGE_KEY = 'flirt_admin_language';

/** Locale-ul `Intl` pentru fiecare limbă (date, numere, monedă). */
export const INTL_LOCALE: Record<Language, string> = { ro: 'ro-RO', ru: 'ru-RU' };

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

// Limba activă pentru codul din afara React (ex. `lib/errors.ts`), apelat din
// callback-uri unde un hook nu e disponibil. O setează `LanguageProvider`.
let activeLanguage: Language = 'ro';

export function currentLanguage(): Language {
  return activeLanguage;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'ro',
  setLanguage: () => undefined,
});

function readInitialLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ro' || stored === 'ru') return stored;
  } catch {
    // Persistența limbii e opțională.
  }
  return 'ro';
}

export function LanguageProvider({ children }: { children: ReactNode }): JSX.Element {
  const [language, setLanguageState] = useState<Language>(readInitialLanguage);

  // Sincron, înainte de randarea copiilor: formatările de dată/număr citesc locale-ul.
  activeLanguage = language;
  setFormatLocale(INTL_LOCALE[language]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', language);
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Persistența limbii e opțională.
    }
  }, [language]);

  const setLanguage = useCallback((next: Language) => setLanguageState(next), []);

  const value = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/**
 * Definește un dicționar bilingv. `ru` trebuie să aibă aceeași formă ca `ro`;
 * valorile pot fi șiruri sau funcții (pentru texte cu parametri).
 */
export function defineMessages<T extends Record<string, unknown>>(messages: {
  ro: T;
  ru: NoInfer<T>;
}): Record<Language, T> {
  return messages;
}

/** Textele dicționarului în limba activă. */
export function useMessages<T>(messages: Record<Language, T>): T {
  const { language } = useLanguage();
  return messages[language];
}
