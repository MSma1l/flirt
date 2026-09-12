/**
 * Acces la API pentru Flirt Passport (TZ secț. 8) în Mini App.
 *
 * Ca și `features/social/socialApi.ts`, fișierul doar RE-EXPORTĂ funcțiile pure
 * din aplicația Expo: ele nu ating React Native, iar `@/services/api` din ele e
 * mapat pe clientul axios al Mini App-ului. Ecranul importă rețeaua DE AICI, ca
 * testele să aibă un singur modul de mockat, chiar dacă datele vin din două
 * module diferite pe mobil (evenimente + abonamente).
 *
 * Rutele backend acoperite:
 *   GET /events/passport      (`backend/app/api/v1/events.py`) → ștampilele
 *   GET /subscriptions/me     (`backend/app/api/v1/subscriptions.py`) → abonamentul
 */

export { fetchPassport } from '@mobile/features/events/eventsApi';

export type { PassportStamp } from '@mobile/features/events/types';

export { fetchMySubscription } from '@mobile/features/subscription/subscriptionApi';

export type { Subscription } from '@mobile/features/subscription/types';
