/**
 * i18n pentru Mini App.
 *
 * CATALOAGELE APLICAȚIEI MOBILE SUNT REUTILIZATE DIRECT: `resources` și
 * `config` se importă din `mobile/src/i18n/`, prin alias-ul `@mobile/`. Ambele
 * fișiere sunt pure (JSON + TypeScript, zero React Native), deci intră în
 * bundle-ul Vite fără adaptare. Traducerile rămân O SINGURĂ sursă de adevăr —
 * nu există copii de ținut în sincron.
 *
 * Cataloage proprii sunt DOUĂ namespace-uri, ținute separat ca doi agenți să
 * poată lucra în paralel fără conflicte pe același fișier:
 *   - `miniapp` (`locales/<lang>.json`): cadrul aplicației — erorile Telegram,
 *     navigarea, indiciile de swipe pentru DOM;
 *   - `screens` (`screens/<lang>.json`): textele ecranelor portate care NU au
 *     corespondent în cataloagele mobile (evenimente, stories, abonament,
 *     bilete, social). Tot ce EXISTĂ deja în `events`/`stories`/`billing`/
 *     `social`/`settings`/`profile`/`common` se folosește de acolo, nu se
 *     copiază aici: o a doua sursă pentru același text se desincronizează.
 * Niciunul nu are ce căuta în aplicația nativă, iar sarcina interzice
 * modificarea cataloagelor mobile.
 *
 * Limba implicită vine din codul de limbă oferit de Telegram; dacă lipsește sau
 * nu e suportat, cădem pe `ro`, ca pe mobil.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  NAMESPACES,
  normalizeLanguage,
  type Language,
} from '@mobile/i18n/config';
import { resources as mobileResources } from '@mobile/i18n/resources';
import { getLanguageCode } from '@/telegram/bridge';

import en from './locales/en.json';
import ro from './locales/ro.json';
import ru from './locales/ru.json';
import screensEn from './screens/en.json';
import screensRo from './screens/ro.json';
import screensRu from './screens/ru.json';

/** Namespace-ul propriu Mini App-ului (cadrul aplicației). */
export const MINIAPP_NAMESPACE = 'miniapp' as const;

/** Namespace-ul ecranelor portate, pentru textele fără corespondent pe mobil. */
export const SCREENS_NAMESPACE = 'screens' as const;

const miniappResources: Record<Language, Record<string, unknown>> = { ro, ru, en };

/** Cataloagele `screens`, exportate ca testul de paritate să le poată citi. */
export const screensResources: Record<Language, Record<string, unknown>> = {
  ro: screensRo,
  ru: screensRu,
  en: screensEn,
};

/** Cataloagele mobile + namespace-urile locale, per limbă. */
const resources = Object.fromEntries(
  (Object.keys(mobileResources) as Language[]).map((lang) => [
    lang,
    {
      ...mobileResources[lang],
      [MINIAPP_NAMESPACE]: miniappResources[lang],
      [SCREENS_NAMESPACE]: screensResources[lang],
    },
  ]),
);

/**
 * Limba de pornire: codul de la Telegram („ru-RU" → „ru"), altfel `ro`.
 * Nu persistăm alegerea: `initDataUnsafe` e disponibil la fiecare pornire, iar
 * stocarea din WebView-ul Telegram nu e de încredere (vezi `api/tokenStore.ts`).
 */
export function resolveInitialLanguage(): Language {
  return normalizeLanguage(getLanguageCode()) ?? DEFAULT_LANGUAGE;
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    ns: [...NAMESPACES, MINIAPP_NAMESPACE, SCREENS_NAMESPACE],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export { i18n };
export default i18n;
