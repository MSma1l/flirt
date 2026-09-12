/**
 * Acces la API pentru modulul social din Mini App (favorite, like-uri trimise,
 * listă de blocare).
 *
 * NU conține logică proprie: doar RE-EXPORTĂ funcțiile pure scrise pentru
 * aplicația Expo. Ele nu ating nimic din React Native, iar singurul lor import,
 * `@/services/api`, e mapat pe clientul axios al Mini App-ului (vezi
 * `vite.config.ts` + `tsconfig.json`), deci rutele și maparea snake_case ↔
 * camelCase rămân O SINGURĂ sursă de adevăr cu aplicația nativă.
 *
 * DE CE EXISTĂ TOTUȘI ACEST FIȘIER, dacă doar re-exportă: ecranele importă
 * rețeaua DE AICI, dintr-un singur loc. Astfel testele mockează UN SINGUR modul
 * (`vi.mock('../socialApi')`) și verifică deciziile ecranului, nu axios. Dacă
 * fiecare ecran ar importa direct din `@mobile/...`, fiecare test ar trebui să
 * mockeze două module diferite (social + settings), iar o schimbare de cale
 * din Expo ar rupe toate testele deodată.
 *
 * Rutele backend acoperite (`backend/app/api/v1/social.py`):
 *   GET    /social/favorites?limit&cursor   → list + X-Next-Cursor
 *   POST   /social/favorites                → {target_user_id}
 *   DELETE /social/favorites/{id}
 *   GET    /social/likes/sent?limit&cursor  → list + X-Next-Cursor
 *   GET    /social/blocks?limit&cursor      → list + X-Next-Cursor
 *   DELETE /social/blocks/{id}
 */

export {
  addFavorite,
  fetchFavoritesPage,
  fetchLikesSentPage,
  removeFavorite,
} from '@mobile/features/social/socialApi';

export type {
  FavoriteItem,
  Page,
  PageParams,
} from '@mobile/features/social/socialApi';

/**
 * Lista de blocare stă în `settingsApi` pe mobil (acolo e ecranul „Setări"),
 * dar în Mini App ecranul ei aparține modulului social. O aducem aici ca
 * ecranele social să aibă un singur modul de rețea.
 */
export { fetchBlocks, unblock } from '@mobile/features/settings/settingsApi';

export type { BlockedUser, BlocksPage } from '@mobile/features/settings/settingsApi';
