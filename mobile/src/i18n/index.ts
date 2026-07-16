/**
 * Inițializarea i18n. Se importă O SINGURĂ DATĂ (din `app/_layout.tsx` pentru
 * aplicație, din `jest.setup.js` pentru teste).
 *
 * DE CE în doi timpi (sincron pe `ro`, apoi async pe limba reală):
 * citirea limbii salvate e asincronă (SecureStore), dar `useTranslation()` are
 * nevoie de o instanță GATA chiar la primul render. Dacă am aștepta I/O-ul,
 * primul cadru ar arăta chei brute („auth:login.title"), iar testele existente —
 * care randează ecrane direct, fără să aștepte nimic — ar cădea.
 *
 * Deci: `init()` sincron pe limba implicită `ro` (fără I/O, resurse inline),
 * apoi `initI18n()` rezolvă limba reală și comută dacă e cazul. Consecință
 * intenționată: limba implicită e `ro` în orice contest neinițializat — exact
 * ce cere baza de teste în română.
 */
import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  DEFAULT_NAMESPACE,
  NAMESPACES,
  normalizeLanguage,
  type Language,
} from './config';
import { languageStore } from './languageStore';
import { resources } from './resources';

// Instanța globală: `initReactI18next` o înregistrează ca instanță implicită a
// lui react-i18next, deci `useTranslation()` merge FĂRĂ `<I18nextProvider>`.
// Ecranele și testele nu au nevoie de niciun wrapper suplimentar.
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    ns: NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    // Cheia lipsă dintr-o limbă cade pe română, nu pe cheia brută.
    fallbackNS: false,
    interpolation: {
      // React scapă deja valorile la randare; dubla scăpare ar strica
      // diacriticele și apostrofurile din interpolări.
      escapeValue: false,
    },
    returnNull: false,
    // Fără `backend` și cu resursele inline, i18next v26 inițializează sincron
    // de la sine — instanța e gata imediat după apelul ăsta.
  });
}

/** Limba dispozitivului, dacă e una dintre cele suportate. */
function getDeviceLanguage(): Language | null {
  try {
    for (const locale of Localization.getLocales()) {
      const lang = normalizeLanguage(locale.languageTag) ?? normalizeLanguage(locale.languageCode);
      if (lang) return lang;
    }
  } catch {
    /* modulul nativ poate lipsi (ex. în teste) — cădem pe implicit */
  }
  return null;
}

/**
 * Limba de pornire, în ordinea priorității:
 *  1. alegerea explicită a userului (persistată),
 *  2. limba dispozitivului, dacă o suportăm,
 *  3. `ro`.
 */
export async function resolveInitialLanguage(): Promise<Language> {
  const saved = await languageStore.get();
  if (saved) return saved;

  return getDeviceLanguage() ?? DEFAULT_LANGUAGE;
}

/**
 * Aduce i18n pe limba reală. De chemat o dată, la pornirea aplicației.
 * Nu aruncă niciodată: o preferință de limbă nu are voie să blocheze boot-ul.
 */
export async function initI18n(): Promise<Language> {
  try {
    const language = await resolveInitialLanguage();
    if (i18n.language !== language) {
      await i18n.changeLanguage(language);
    }
    return language;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export { i18n };
export default i18n;
