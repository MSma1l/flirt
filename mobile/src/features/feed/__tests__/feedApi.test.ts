import { fetchFeed, swipe, undoSwipe } from '../feedApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchFeed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          user_id: 'u1',
          name: 'Ana',
          age: 24,
          gender: 'female',
          city: 'Chișinău',
          distance_km: 3,
          about: 'Salut!',
          top_interests: ['sport', 'music'],
          languages: ['ro', 'ru'],
          compatibility: 82,
          photos: ['https://x/1.jpg'],
        },
      ],
    });

    const feed = await fetchFeed();

    expect(api.get).toHaveBeenCalledWith('/feed/');
    expect(feed).toEqual([
      {
        userId: 'u1',
        name: 'Ana',
        age: 24,
        gender: 'female',
        city: 'Chișinău',
        distanceKm: 3,
        about: 'Salut!',
        topInterests: ['sport', 'music'],
        languages: ['ro', 'ru'],
        compatibility: 82,
        photos: ['https://x/1.jpg'],
      },
    ]);
  });

  it('tolerează câmpuri lipsă și listă goală', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          user_id: 'u2',
          name: 'Ion',
          age: 30,
          gender: 'male',
          city: 'Bălți',
          about: '',
          compatibility: 40,
        },
      ],
    });

    const feed = await fetchFeed();
    expect(feed[0].distanceKm).toBeUndefined();
    expect(feed[0].topInterests).toEqual([]);
    expect(feed[0].languages).toEqual([]);
    expect(feed[0].photos).toEqual([]);
  });
});

describe('swipe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload corect și mapează rezultatul (inclusiv chatId)', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { matched: true, match_id: 'm1', chat_id: 'c1' },
    });

    const result = await swipe('u1', 'like');

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/feed/swipe');
    expect(payload).toEqual({ target_user_id: 'u1', action: 'like' });
    expect(result).toEqual({ matched: true, matchId: 'm1', chatId: 'c1' });
  });

  it('întoarce matchId și chatId undefined când nu e match', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { matched: false } });
    const result = await swipe('u2', 'dislike');
    expect(result).toEqual({ matched: false, matchId: undefined, chatId: undefined });
  });

  it('mapează chat_id null la chatId undefined', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { matched: true, match_id: 'm2', chat_id: null },
    });
    const result = await swipe('u3', 'like');
    expect(result).toEqual({ matched: true, matchId: 'm2', chatId: undefined });
  });

  it('include `message` în payload doar când e dat', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { matched: false } });

    await swipe('u1', 'like', 'Salut 👋');

    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/feed/swipe');
    expect(payload).toEqual({
      target_user_id: 'u1',
      action: 'like',
      message: 'Salut 👋',
    });
  });

  it('nu trimite cheia `message` când lipsește', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { matched: false } });

    await swipe('u1', 'like');

    const [, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(payload).toEqual({ target_user_id: 'u1', action: 'like' });
    expect('message' in payload).toBe(false);
  });
});

describe('undoSwipe', () => {
  beforeEach(() => jest.clearAllMocks());

  it('apelează POST /feed/undo și mapează target_user_id → targetUserId', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { undone: true, target_user_id: 'u9' },
    });

    const result = await undoSwipe();

    expect(api.post).toHaveBeenCalledWith('/feed/undo', {});
    expect(result).toEqual({ undone: true, targetUserId: 'u9' });
  });

  it('mapează target_user_id lipsă/null la targetUserId null', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { undone: false, target_user_id: null },
    });

    const result = await undoSwipe();
    expect(result).toEqual({ undone: false, targetUserId: null });
  });
});
