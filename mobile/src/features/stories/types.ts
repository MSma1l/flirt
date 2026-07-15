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

/** Poveștile grupate pe un utilizator, pentru bara de stories. */
export interface UserStories {
  userId: string;
  name: string;
  storyCount: number;
  stories: Story[];
}
