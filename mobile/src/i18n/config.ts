/**
 * Configurația i18n: limbile, namespace-urile și normalizarea etichetelor.
 *
 * Fișier PARTAJAT — se schimbă rar (doar la adăugarea unei limbi sau a unui
 * namespace nou). Namespace-urile de mai jos sunt DEJA create pentru toate cele
 * 4 limbi, tocmai ca agenții care migrează ecrane să NU aibă nevoie să atingă
 * acest fișier: fiecare lucrează exclusiv în JSON-ul namespace-ului lui.
 */

/** Limbile suportate de interfață. `ro` este implicită și fallback. */
export const SUPPORTED_LANGUAGES = ['ro', 'ru', 'uk', 'en'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Limba implicită: tot ce nu se poate rezolva cade aici. */
export const DEFAULT_LANGUAGE: Language = 'ro';

/**
 * Namespace-uri = felii disjuncte de traduceri, una per zonă funcțională.
 * Un agent migrează o zonă ⇒ atinge DOAR `locales/<lang>/<namespace>.json`.
 * Ținem lista completă de la început ca fișierele partajate să rămână stabile.
 */
export const NAMESPACES = [
  'common', // butoane, acțiuni, erori generice, unități — folosit de toți
  'auth', // welcome, login, register, phone
  'onboarding', // (onboarding)/*
  'feed', // (tabs)/ankete, features/feed, features/anketa
  'chat', // (tabs)/mesaje, chat/[id], features/chat
  'profile', // profile/edit, passport, features/profile
  'settings', // (tabs)/setari, blocklist, features/settings
  'events', // events/*, features/events
  'stories', // stories/*, features/stories
  'billing', // paywall, features/billing, features/subscription
  'moderation', // raportare, blocare, features/moderation
  'verification', // verify-face, features/verification
  'humor', // humor, features/humor
  'social', // favorites, ticket, features/social
] as const;

export type Namespace = (typeof NAMESPACES)[number];

/** Namespace-ul implicit când `useTranslation()` e chemat fără argument. */
export const DEFAULT_NAMESPACE: Namespace = 'common';

/**
 * Numele limbilor, fiecare SCRIS ÎN LIMBA EI (endonim) — nu se traduc.
 * Într-un selector de limbă, un vorbitor de ucraineană caută „Українська", nu
 * „Ucraineană"; de asta lista arată la fel indiferent de limba activă și stă
 * aici, ca o constantă, nu duplicată în cele 4 cataloage.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  ro: 'Română',
  ru: 'Русский',
  uk: 'Українська',
  en: 'English',
};

/** Type guard: eticheta e una dintre limbile suportate? */
export function isSupportedLanguage(value: unknown): value is Language {
  return (
    typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  );
}

/**
 * Aduce o etichetă BCP-47 de dispozitiv la una dintre limbile noastre.
 *
 * Acceptă `ro-MD`, `ru_RU`, `uk-UA`, `en-GB` etc. — luăm doar subeticheta de
 * limbă. `mo` (cod ISO învechit pentru „moldovenească") îl tratăm ca `ro`:
 * e aceeași limbă, iar dispozitivele vechi din RM încă îl pot raporta.
 * Întoarce `null` dacă limba nu e suportată — apelantul decide fallback-ul.
 */
export function normalizeLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;

  const base = tag.replace('_', '-').split('-')[0]?.toLowerCase();
  if (!base) return null;

  if (base === 'mo') return 'ro';

  return isSupportedLanguage(base) ? base : null;
}
