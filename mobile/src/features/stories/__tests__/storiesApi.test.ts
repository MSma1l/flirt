import {
  createStory,
  deleteStory,
  fetchMyStories,
  fetchStories,
  uploadStoryMedia,
} from '../storiesApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

const RAW_STORY = {
  id: 's1',
  user_id: 'u1',
  media_url: 'https://x/media.jpg',
  media_type: 'image',
  caption: 'Salut!',
  created_at: '2026-07-06T10:00:00Z',
  expires_at: '2026-07-07T10:00:00Z',
};

const RAW_GROUP = {
  user_id: 'u1',
  name: 'Ana',
  story_count: 1,
  stories: [RAW_STORY],
};

describe('fetchStories', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [RAW_GROUP] });

    const groups = await fetchStories();

    expect(api.get).toHaveBeenCalledWith('/stories/');
    expect(groups).toEqual([
      {
        userId: 'u1',
        name: 'Ana',
        storyCount: 1,
        stories: [
          {
            id: 's1',
            userId: 'u1',
            mediaUrl: 'https://x/media.jpg',
            mediaType: 'image',
            caption: 'Salut!',
            createdAt: '2026-07-06T10:00:00Z',
            expiresAt: '2026-07-07T10:00:00Z',
          },
        ],
      },
    ]);
  });

  it('poveștile fără media_type sunt tratate ca imagine', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ ...RAW_GROUP, stories: [{ ...RAW_STORY, media_type: undefined }] }],
    });

    const groups = await fetchStories();
    expect(groups[0].stories[0].mediaType).toBe('image');
  });

  it('tolerează caption lipsă și listă goală', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ ...RAW_GROUP, stories: [{ ...RAW_STORY, caption: null }] }],
    });

    const groups = await fetchStories();
    expect(groups[0].stories[0].caption).toBeUndefined();
  });

  it('întoarce listă goală când data lipsește', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    expect(await fetchStories()).toEqual([]);
  });
});

describe('fetchMyStories', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /stories/mine și mapează rezultatul', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [RAW_STORY] });

    const stories = await fetchMyStories();

    expect(api.get).toHaveBeenCalledWith('/stories/mine');
    expect(stories[0].mediaUrl).toBe('https://x/media.jpg');
    expect(stories[0].userId).toBe('u1');
  });
});

describe('createStory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite {media_url, media_type, caption} și mapează povestea creată', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: RAW_STORY });

    const story = await createStory('https://x/media.jpg', 'image', 'Salut!');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/stories/');
    expect(payload).toEqual({
      media_url: 'https://x/media.jpg',
      media_type: 'image',
      caption: 'Salut!',
    });
    expect(story.id).toBe('s1');
  });

  it('trimite caption undefined când lipsește și păstrează media_type', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { ...RAW_STORY, media_type: 'video' } });

    await createStory('https://x/clip.mp4', 'video');

    const [, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(payload).toEqual({
      media_url: 'https://x/clip.mp4',
      media_type: 'video',
      caption: undefined,
    });
  });
});

describe('uploadStoryMedia', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite multipart la /stories/media și mapează răspunsul', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { media_url: 'https://cdn/stories/u1/abc.mp4', media_type: 'video' },
    });

    const result = await uploadStoryMedia({
      uri: 'file:///clip.mp4',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      mediaType: 'video',
    });

    const [url, body] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/stories/media');
    expect(body).toBeInstanceOf(FormData);
    expect(result).toEqual({
      mediaUrl: 'https://cdn/stories/u1/abc.mp4',
      mediaType: 'video',
    });
  });
});

describe('deleteStory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lovește endpointul corect', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ status: 204 });

    await deleteStory('s1');

    expect(api.delete).toHaveBeenCalledWith('/stories/s1');
  });
});
