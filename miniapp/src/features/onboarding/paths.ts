/**
 * Căile rutelor, într-un singur loc.
 *
 * Stau separat de `routes.tsx` ca ecranele să le poată importa fără să închidă
 * un ciclu (ruta importă ecranul, ecranul ar importa ruta).
 */
export const WELCOME_PATH = '/bun-venit';
export const ONBOARDING_PROFILE_PATH = '/inregistrare/profil';
export const ONBOARDING_PHOTOS_PATH = '/inregistrare/poze';
export const FEED_PATH = '/feed';
export const CHATS_PATH = '/mesaje';
export const PROFILE_PATH = '/profil';
export const SETTINGS_PATH = '/setari';
