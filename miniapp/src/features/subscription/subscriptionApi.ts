/**
 * Acces la API pentru Abonamente, în Mini App.
 *
 * REUTILIZAT din aplicația Expo, fără copiere
 * (`mobile/src/features/subscription/subscriptionApi.ts`, prin alias-ul
 * `@mobile/`): maparea snake_case ↔ camelCase e deja scrisă acolo, iar
 * `@/services/api` din acel fișier e mapat pe clientul axios de aici.
 *
 * NU se re-exportă `purchase`. Plata nu intră în scopul Mini App-ului: ecranul
 * doar arată catalogul și starea abonamentului, iar achiziția se face din
 * aplicația mobilă, prin magazinul platformei. O funcție de cumpărare exportată
 * de aici ar fi o invitație să se construiască, mâine, un flux de plată care
 * ocolește magazinul — mai bine lipsește.
 *
 * Rutele confirmate în `backend/app/api/v1/subscriptions.py`:
 *   GET /subscriptions/plans        → list[PlanOut]
 *   GET /subscriptions/me           → SubscriptionOut | null
 *   GET /subscriptions/entitlements → EntitlementsOut
 */
export {
  fetchEntitlements,
  fetchMySubscription,
  fetchPlans,
} from '@mobile/features/subscription/subscriptionApi';

export type {
  Entitlements,
  Plan,
  Subscription,
} from '@mobile/features/subscription/types';
