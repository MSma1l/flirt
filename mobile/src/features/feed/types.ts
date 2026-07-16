/** Tipuri pentru feed-ul de swipe (TZ secț. 4). Toate câmpurile în camelCase. */

/** Un card de profil afișat în deck-ul de ankete. */
export interface FeedCard {
  userId: string;
  name: string;
  age: number;
  gender: string;
  city: string;
  /** Distanța în km până la utilizator (opțională). */
  distanceKm?: number;
  about: string;
  topInterests: string[];
  languages: string[];
  /** Scor de compatibilitate 0–100. */
  compatibility: number;
  photos: string[];
}

/** Rezultatul unui swipe: dacă a rezultat un match și id-ul lui. */
export interface SwipeResult {
  matched: boolean;
  matchId?: string;
  /** Id-ul chatului creat la match (poate lipsi). */
  chatId?: string | null;
}

/** Un element din lista de match-uri. */
export interface MatchItem {
  matchId: string;
  userId: string;
  name: string;
  age: number;
  city: string;
  compatibility: number;
}

/**
 * Acțiunea posibilă la swipe.
 * `super_like` (swipe în sus) e trimis pe ACELAȘI endpoint `/feed/swipe`.
 * Atenție: backendul încă nu îl acceptă — până aterizează, serverul răspunde cu
 * eroare, iar ecranul o tratează ca pe orice eroare de rețea (mesaj, fără crash).
 */
export type SwipeAction = 'like' | 'dislike' | 'super_like';

/** Rezultatul unui undo: dacă s-a anulat ultimul swipe și pe cine viza. */
export interface UndoResult {
  undone: boolean;
  /** Id-ul utilizatorului al cărui swipe a fost anulat (sau null). */
  targetUserId: string | null;
}
