/**
 * Registrul cataloagelor: leagă fiecare (limbă × namespace) de JSON-ul lui.
 *
 * Fișier PARTAJAT și DELIBERAT COMPLET: toate cele 14 namespace-uri × 4 limbi
 * sunt deja importate, chiar dacă unele JSON-uri sunt încă goale (`{}`).
 * Așa, un agent care migrează un ecran nu atinge NICIODATĂ fișierul ăsta —
 * doar scrie în `locales/<limbă>/<namespace>.json`. Zero conflicte pe merge.
 *
 * Importurile sunt STATICE (nu `require` dinamic): Metro trebuie să vadă
 * fiecare cale la build, altfel cataloagele nu ajung în bundle.
 */
import type { Language, Namespace } from './config';

import enAuth from './locales/en/auth.json';
import enBilling from './locales/en/billing.json';
import enChat from './locales/en/chat.json';
import enCommon from './locales/en/common.json';
import enEvents from './locales/en/events.json';
import enFeed from './locales/en/feed.json';
import enHumor from './locales/en/humor.json';
import enModeration from './locales/en/moderation.json';
import enOnboarding from './locales/en/onboarding.json';
import enProfile from './locales/en/profile.json';
import enSettings from './locales/en/settings.json';
import enSocial from './locales/en/social.json';
import enStories from './locales/en/stories.json';
import enVerification from './locales/en/verification.json';

import roAuth from './locales/ro/auth.json';
import roBilling from './locales/ro/billing.json';
import roChat from './locales/ro/chat.json';
import roCommon from './locales/ro/common.json';
import roEvents from './locales/ro/events.json';
import roFeed from './locales/ro/feed.json';
import roHumor from './locales/ro/humor.json';
import roModeration from './locales/ro/moderation.json';
import roOnboarding from './locales/ro/onboarding.json';
import roProfile from './locales/ro/profile.json';
import roSettings from './locales/ro/settings.json';
import roSocial from './locales/ro/social.json';
import roStories from './locales/ro/stories.json';
import roVerification from './locales/ro/verification.json';

import ruAuth from './locales/ru/auth.json';
import ruBilling from './locales/ru/billing.json';
import ruChat from './locales/ru/chat.json';
import ruCommon from './locales/ru/common.json';
import ruEvents from './locales/ru/events.json';
import ruFeed from './locales/ru/feed.json';
import ruHumor from './locales/ru/humor.json';
import ruModeration from './locales/ru/moderation.json';
import ruOnboarding from './locales/ru/onboarding.json';
import ruProfile from './locales/ru/profile.json';
import ruSettings from './locales/ru/settings.json';
import ruSocial from './locales/ru/social.json';
import ruStories from './locales/ru/stories.json';
import ruVerification from './locales/ru/verification.json';

import ukAuth from './locales/uk/auth.json';
import ukBilling from './locales/uk/billing.json';
import ukChat from './locales/uk/chat.json';
import ukCommon from './locales/uk/common.json';
import ukEvents from './locales/uk/events.json';
import ukFeed from './locales/uk/feed.json';
import ukHumor from './locales/uk/humor.json';
import ukModeration from './locales/uk/moderation.json';
import ukOnboarding from './locales/uk/onboarding.json';
import ukProfile from './locales/uk/profile.json';
import ukSettings from './locales/uk/settings.json';
import ukSocial from './locales/uk/social.json';
import ukStories from './locales/uk/stories.json';
import ukVerification from './locales/uk/verification.json';

/** Cataloagele româneşti — SURSA DE ADEVĂR pentru tipuri şi pentru fallback. */
export const roResources = {
  common: roCommon,
  auth: roAuth,
  onboarding: roOnboarding,
  feed: roFeed,
  chat: roChat,
  profile: roProfile,
  settings: roSettings,
  events: roEvents,
  stories: roStories,
  billing: roBilling,
  moderation: roModeration,
  verification: roVerification,
  humor: roHumor,
  social: roSocial,
} as const;

/**
 * `Record<Namespace, ...>` pe fiecare limbă: dacă cineva adaugă un namespace în
 * `NAMESPACES` şi uită să-l importe aici, TypeScript se plânge la compilare —
 * nu descoperim lipsa abia în runtime, printr-o cheie neafişată.
 */
type LanguageResources = Record<Namespace, Record<string, unknown>>;

export const resources: Record<Language, LanguageResources> = {
  ro: roResources,
  ru: {
    common: ruCommon,
    auth: ruAuth,
    onboarding: ruOnboarding,
    feed: ruFeed,
    chat: ruChat,
    profile: ruProfile,
    settings: ruSettings,
    events: ruEvents,
    stories: ruStories,
    billing: ruBilling,
    moderation: ruModeration,
    verification: ruVerification,
    humor: ruHumor,
    social: ruSocial,
  },
  uk: {
    common: ukCommon,
    auth: ukAuth,
    onboarding: ukOnboarding,
    feed: ukFeed,
    chat: ukChat,
    profile: ukProfile,
    settings: ukSettings,
    events: ukEvents,
    stories: ukStories,
    billing: ukBilling,
    moderation: ukModeration,
    verification: ukVerification,
    humor: ukHumor,
    social: ukSocial,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    onboarding: enOnboarding,
    feed: enFeed,
    chat: enChat,
    profile: enProfile,
    settings: enSettings,
    events: enEvents,
    stories: enStories,
    billing: enBilling,
    moderation: enModeration,
    verification: enVerification,
    humor: enHumor,
    social: enSocial,
  },
};
