/**
 * Calea ecranului de verificare prin selfie.
 *
 * Stă separat de `routes.tsx` din același motiv ca `features/passport/passportRoutes.ts`:
 * ecranul de profil are nevoie de cale ca să trimită acolo, iar `routes.tsx` are
 * nevoie de ecran — un import direct între ele ar închide un ciclu.
 */
export const VERIFICATION_PATH = '/verificare';
