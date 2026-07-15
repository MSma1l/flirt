/** Acces la API pentru Stories (TZ secț. 11). Mapare snake_case → camelCase. */
import { Platform } from 'react-native';

import { api } from '@/services/api';

import { Story, StoryMediaType, UserStories } from './types';

/** Forma brută (snake_case) a unei povești din backend. */
interface StoryResponse {
  id: string;
  user_id: string;
  media_url: string;
  media_type?: StoryMediaType | null;
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

/** Fișierul de media pregătit pentru upload (imagine comprimată sau video). */
export interface StoryMediaFile {
  /** URI local (fișierul comprimat pentru imagini / clipul pentru video). */
  uri: string;
  /** Tipul MIME (ex. `image/jpeg`, `video/mp4`). */
  mimeType: string;
  /** Numele trimis în multipart (backend-ul își generează oricum cheia). */
  fileName: string;
  /** Imagine sau video — trimis mai departe la crearea poveștii. */
  mediaType: StoryMediaType;
}

/** Rezultatul upload-ului de media: URL-ul salvat + tipul confirmat de server. */
export interface StoryMediaResult {
  mediaUrl: string;
  mediaType: StoryMediaType;
}

/** Mapează o poveste din snake_case → camelCase. */
function mapStory(s: StoryResponse): Story {
  return {
    id: s.id,
    userId: s.user_id,
    mediaUrl: s.media_url,
    // Poveștile vechi (dinainte de suportul video) nu au câmpul → tratate ca imagine.
    mediaType: s.media_type ?? 'image',
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

/**
 * Încarcă media (imagine sau video) și întoarce URL-ul + tipul confirmat de server.
 *
 * Multipart cu câmpul `file`. Ca la pozele de profil (`photosApi.postPhoto`):
 * pe web trimitem un `Blob` REAL (obiectul {uri,name,type} ar fi serializat ca
 * `[object Object]`) și NU setăm manual `Content-Type` (browserul pune boundary-ul);
 * pe nativ trimitem {uri,name,type} și forțăm `multipart/form-data`.
 */
export async function uploadStoryMedia(
  file: StoryMediaFile,
  onProgress?: (ratio: number) => void,
): Promise<StoryMediaResult> {
  const form = new FormData();
  let headers: Record<string, string> | undefined;

  if (Platform.OS === 'web') {
    const blob = await (await fetch(file.uri)).blob();
    form.append('file', blob, file.fileName);
  } else {
    const part = { uri: file.uri, name: file.fileName, type: file.mimeType };
    form.append('file', part as unknown as Blob);
    headers = { 'Content-Type': 'multipart/form-data' };
  }

  const { data } = await api.post<{ media_url: string; media_type: StoryMediaType }>(
    '/stories/media',
    form,
    {
      headers,
      onUploadProgress: (event) => {
        if (!onProgress) return;
        const total = event.total ?? 0;
        if (total > 0) onProgress(Math.min(1, event.loaded / total));
      },
    },
  );
  return { mediaUrl: data.media_url, mediaType: data.media_type };
}

/** Publică o poveste nouă și întoarce povestea creată. */
export async function createStory(
  mediaUrl: string,
  mediaType: StoryMediaType,
  caption?: string,
): Promise<Story> {
  const { data } = await api.post<StoryResponse>('/stories/', {
    media_url: mediaUrl,
    media_type: mediaType,
    caption,
  });
  return mapStory(data);
}

/** Șterge o poveste după id. */
export async function deleteStory(id: string): Promise<void> {
  await api.delete(`/stories/${id}`);
}
