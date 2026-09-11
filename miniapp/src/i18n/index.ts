/**
 * i18n pentru Mini App.
 *
 * CATALOAGELE APLICAȚIEI MOBILE SUNT REUTILIZATE DIRECT: `resources` și
 * `config` se importă din `mobile/src/i18n/`, prin alias-ul `@mobile/`. Ambele
 * fișiere sunt pure (JSON + TypeScript, zero React Native), deci intră în
 * bundle-ul Vite fără adaptare. Traducerile rămân O SINGURĂ sursă de adevăr —
 * nu există copii de ținut în sincron.
 *
 * Singurul catalog propriu e namespace-ul `miniapp`: texte care există DOAR
 * aici (erorile Telegram, indiciile de swipe pentru DOM). Ele nu au ce căuta în
 * aplicația nativă, iar sarcina interzice modificarea cataloagelor mobile.
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
import uk from './locales/uk.json';

/** Namespace-ul propriu Mini App-ului. */
export const MINIAPP_NAMESPACE = 'miniapp' as const;

const miniappResources: Record<Language, Record<string, unknown>> = { ro, ru, uk, en };

/** Cataloagele mobile + namespace-ul local, per limbă. */
const resources = Object.fromEntries(
  (Object.keys(mobileResources) as Language[]).map((lang) => [
    lang,
    { ...mobileResources[lang], [MINIAPP_NAMESPACE]: miniappResources[lang] },
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
    ns: [...NAMESPACES, MINIAPP_NAMESPACE],
    defaultNS: DEFAULT_NAMESPACE,
    fallbackNS: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export { i18n };
export default i18n;
