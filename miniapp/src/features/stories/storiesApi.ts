/**
 * Acces la API pentru Stories, în Mini App (rutele confirmate în
 * `backend/app/api/v1/stories.py`):
 *   GET    /stories/            → list[UserStories]  (+ header `X-Next-Cursor`)
 *   GET    /stories/mine        → list[StoryOut]     (+ header `X-Next-Cursor`)
 *   POST   /stories/media       multipart, câmp `file` → {media_url, media_type}
 *   POST   /stories/            body {media_url, media_type, caption?} → StoryOut (201)
 *   POST   /stories/{id}/reply  body {body} → {chat_id, message}
 *   DELETE /stories/{id}        → 204
 *
 * PORT pentru DOM al lui `mobile/src/features/stories/storiesApi.ts`. Acela NU
 * se poate reutiliza prin `@mobile/`: importă `Platform` din `react-native`, iar
 * bundle-ul web ar trage tot React Native după el. TIPURILE, în schimb, se
 * reutilizează (`@mobile/features/stories/types` e TypeScript pur), ca forma
 * datelor să rămână o singură sursă de adevăr pentru ambele aplicații.
 *
 * Maparea snake_case → camelCase e păstrată IDENTIC cu mobilul, inclusiv
 * `media_type ?? 'image'`: poveștile create înainte de câmpul `media_type` vin
 * fără el, iar vizualizatorul trebuie să le arate ca imagini, nu să crape.
 *
 * Uploadul respectă aceleași reguli ca `features/profile/photosApi.ts`:
 *  - `FormData` cu un `Blob` REAL + numele fișierului ca al treilea argument
 *    (obiectul `{uri,name,type}` de pe nativ ar ajunge „[object Object]");
 *  - `Content-Type` NEsetat manual — altfel lipsește `boundary=…` și parsarea
 *    multipart din FastAPI pică. Clientul axios de aici e creat special fără
 *    `Content-Type` implicit (vezi comentariul din `api/client.ts`).
 */
import type {
  Story,
  StoryMediaType,
  StoryReply,
  UserStories,
} from '@mobile/features/stories/types';

import { api } from '@/api/client';

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
    // Poveștile vechi (dinainte de câmpul `media_type`) sunt tratate ca imagine.
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

/** Aduce poveștile active (proprii + ale match-urilor), grupate pe utilizator. */
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
 * Încarcă media unei povești și întoarce URL-ul + tipul confirmat de server.
 *
 * Primește un `Blob` deja pregătit (redimensionat și recomprimat de
 * `imageResize.ts`), nu un `File` brut: backendul respinge cu 413 orice trece de
 * `max_upload_bytes` (8 MB), iar o poză de telefon depășește ușor pragul.
 *
 * NU există ramură pentru video: `stories.py::_reject_video` ridică 422 pentru
 * orice `video/*` declarat SAU pentru orice conținut ISO-BMFF, indiferent de
 * extensie (nu există moderare automată de video — Apple Guideline 1.2).
 */
export async function uploadStoryMedia(
  file: Blob,
  fileName: string,
  onProgress?: (ratio: number) => void,
): Promise<StoryMediaResult> {
  const form = new FormData();
  form.append('file', file, fileName);

  const { data } = await api.post<{ media_url: string; media_type: StoryMediaType }>(
    '/stories/media',
    form,
    {
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

/**
 * Răspunde la o poveste (text liber sau un emoji) → mesaj în chatul match-ului.
 *
 * Backendul prefixează mesajul cu contextul poveștii și aplică regulile
 * obișnuite de chat (mascare contacte, blocări), deci răspunsul NU e o mesagerie
 * paralelă: e un mesaj normal, iar lista de dialoguri devine învechită.
 */
export async function replyToStory(storyId: string, body: string): Promise<StoryReply> {
  const { data } = await api.post<{
    chat_id: string;
    message: { id: string; body: string };
  }>(`/stories/${storyId}/reply`, { body });
  return { chatId: data.chat_id, messageId: data.message.id, body: data.message.body };
}

/** Șterge o poveste proprie. */
export async function deleteStory(id: string): Promise<void> {
  await api.delete(`/stories/${id}`);
}
