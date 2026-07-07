/** Acces la API pentru Stories (TZ secț. 11). Mapare snake_case → camelCase. */
import { api } from '@/services/api';

import { Story, UserStories } from './types';

/** Forma brută (snake_case) a unei povești din backend. */
interface StoryResponse {
  id: string;
  user_id: string;
  media_url: string;
  caption?: string | null;
  created_at: string;
  expires_at: string;
}

/** Forma brută (snake_case) a unui grup de povești pe utilizator. */
interface UserStoriesResponse {
  user_id: string;
  name: string;
  story_count: number;
  stories: StoryResponse[];
}

/** Mapează o poveste din snake_case → camelCase. */
function mapStory(s: StoryResponse): Story {
  return {
    id: s.id,
    userId: s.user_id,
    mediaUrl: s.media_url,
    caption: s.caption ?? undefined,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
  };
}

/** Mapează un grup de povești din snake_case → camelCase. */
function mapUserStories(u: UserStoriesResponse): UserStories {
  return {
    userId: u.user_id,
    name: u.name,
    storyCount: u.story_count,
    stories: (u.stories ?? []).map(mapStory),
  };
}

/** Aduce poveștile tuturor utilizatorilor, grupate. */
export async function fetchStories(): Promise<UserStories[]> {
  const { data } = await api.get<UserStoriesResponse[]>('/stories/');
  return (data ?? []).map(mapUserStories);
}

/** Aduce doar poveștile utilizatorului curent. */
export async function fetchMyStories(): Promise<Story[]> {
  const { data } = await api.get<StoryResponse[]>('/stories/mine');
  return (data ?? []).map(mapStory);
}

/** Publică o poveste nouă și întoarce povestea creată. */
export async function createStory(mediaUrl: string, caption?: string): Promise<Story> {
  const { data } = await api.post<StoryResponse>('/stories/', {
    media_url: mediaUrl,
    caption,
  });
  return mapStory(data);
}

/** Șterge o poveste după id. */
export async function deleteStory(id: string): Promise<void> {
  await api.delete(`/stories/${id}`);
}
