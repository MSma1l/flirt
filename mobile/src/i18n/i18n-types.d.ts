/**
 * Tipizarea cheilor de traducere.
 *
 * Cataloagele ROMÂNEȘTI sunt sursa de adevăr: `ro` e limba implicită și singura
 * garantat completă (restul cad pe ea prin `fallbackLng`). Astfel `t()` acceptă
 * doar chei care există cu adevărat, iar o cheie greșită sau ștearsă pică la
 * `tsc --noEmit`, nu în producție ca text brut pe ecran.
 *
 * Pentru agenții care migrează ecrane: adaugi cheia în `locales/ro/<ns>.json`
 * și tipul apare automat — nu trebuie să editezi fișierul ăsta.
 */
import 'i18next';

import type { DEFAULT_NAMESPACE } from './config';
import type { roResources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: typeof roResources;
    // Oglindește `returnNull: false` din init: `t()` întoarce `string`, nu
    // `string | null`, deci nu trebuie verificat la fiecare apel.
    returnNull: false;
  }
}
