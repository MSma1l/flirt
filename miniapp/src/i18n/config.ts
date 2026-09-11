/**
 * Punte către configurația i18n PARTAJATĂ (`mobile/src/i18n/config.ts`).
 *
 * DE CE EXISTĂ: fișierele pure reutilizate din aplicația Expo — de pildă
 * `mobile/src/features/anketa/anketaApi.ts`, folosit de onboarding — importă
 * `@/i18n/config`. În tsconfig/vite, `@/` e rădăcina Mini App-ului, deci acel
 * import ajunge AICI, nu înapoi la mobil. Fișierul re-exportă sursa unică,
 * exact cum `@/services/api` duce la clientul HTTP de aici (vezi comentariul
 * din tsconfig.json).
 *
 * ZERO logică proprie, intenționat: o copie a listei de limbi s-ar desincroniza
 * în tăcere de aplicația nativă.
 */
export * from '@mobile/i18n/config';
