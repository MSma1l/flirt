/** Tipuri pentru reclamele interstițiale afișate periodic în feed. Camel-case. */

/** Config-ul de reclame venit de la backend (`GET /ads/config`). */
export interface AdConfig {
  /** Reclamele sunt active pe acest cont / build. */
  enabled: boolean;
  /** După câte swipe-uri se afișează o reclamă (implicit 15). */
  swipesBeforeAd: number;
  /** Limita de secunde până când userul poate închide reclama (implicit 10). */
  maxVideoSeconds: number;
}

/** O reclamă concretă de afișat (`GET /ads/next`). */
export interface Ad {
  id: number;
  title: string;
  /** URL video (redat în WebView). Null => folosim imaginea. */
  videoUrl: string | null;
  /** URL imagine (fallback când nu există video). Null => doar titlul. */
  imageUrl: string | null;
  /** Durata declarată a reclamei, în secunde. */
  durationSeconds: number;
}
