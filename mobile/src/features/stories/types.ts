/** Tipuri pentru Stories (TZ secț. 11): conținut foto de profil, valabil 24h. Câmpuri în camelCase. */

/** Tipul de media al unei povești: imagine sau video (TZ secț. 11). */
export type StoryMediaType = 'image' | 'video';

/** O poveste (story) individuală. */
export interface Story {
  id: string;
  userId: string;
  /** URL-ul media (imagine sau video), încărcat prin `POST /stories/media`. */
  mediaUrl: string;
  /** Tipul de media: decide între `<Image>` și player-ul video în vizualizator. */
  mediaType: StoryMediaType;
  /** Text opțional afișat peste/ sub media. */
  caption?: string;
  /** Momentul creării în format ISO 8601. */
  createdAt: string;
  /** Momentul expirării (24h după creare) în format ISO 8601. */
  expiresAt: string;
}

/** Rezultatul unui răspuns la o poveste.
 *
 * Răspunsul NU e o mesagerie paralelă: backendul îl livrează ca mesaj obișnuit
 * în chatul match-ului (poveștile se văd doar între match-uri). `chatId` permite
 * deschiderea conversației, dacă vrem asta mai târziu.
 */
export interface StoryReply {
  chatId: string;
  messageId: string;
  /** Corpul mesajului AȘA CUM a fost persistat (prefixat cu contextul poveștii). */
  body: string;
}

/** Poveștile grupate pe un utilizator, pentru bara de stories. */
export interface UserStories {
  userId: string;
  name: string;
  storyCount: number;
  stories: Story[];
}
