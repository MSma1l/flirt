/** Tipuri pentru Stories (TZ secț. 11): conținut foto de profil, valabil 24h. Câmpuri în camelCase. */

/** O poveste (story) individuală. */
export interface Story {
  id: string;
  userId: string;
  /** URL-ul media (imagine). Uploadul nativ vine curând — momentan prin URL. */
  mediaUrl: string;
  /** Text opțional afișat peste/ sub media. */
  caption?: string;
  /** Momentul creării în format ISO 8601. */
  createdAt: string;
  /** Momentul expirării (24h după creare) în format ISO 8601. */
  expiresAt: string;
}

/** Poveștile grupate pe un utilizator, pentru bara de stories. */
export interface UserStories {
  userId: string;
  name: string;
  storyCount: number;
  stories: Story[];
}
