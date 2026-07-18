import {
  addFavorite,
  fetchFavorites,
  fetchFavoritesPage,
  fetchLikesSentPage,
  fetchPendingLikesPage,
  removeFavorite,
} from '../socialApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchFavoritesPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face GET /social/favorites cu limit și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        { target_user_id: 'u1', name: 'Ana', age: 25, city: 'Chișinău', photos: ['p1.jpg'] },
        { target_user_id: 'u2', name: 'Ion', age: 30, city: 'Bălți' },
      ],
      headers: {},
    });

    const page = await fetchFavoritesPage();

    // Prima pagină: `limit` da, `cursor` nu — n-avem de unde-l lua încă.
    expect(api.get).toHaveBeenCalledWith('/social/favorites', { params: { limit: 20 } });
    expect(page.items).toEqual([
      { targetUserId: 'u1', name: 'Ana', age: 25, city: 'Chișinău', photos: ['p1.jpg'] },
      // `photos` lipsă în răspuns → listă goală, nu undefined.
      { targetUserId: 'u2', name: 'Ion', age: 30, city: 'Bălți', photos: [] },
    ]);
  });

  it('citește cursorul paginii următoare din header-ul X-Next-Cursor', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ target_user_id: 'u1', name: 'Ana', age: 25, city: 'Chișinău' }],
      headers: { 'x-next-cursor': 'CURSOR2' },
    });

    expect((await fetchFavoritesPage()).nextCursor).toBe('CURSOR2');
  });

  it('fără header X-Next-Cursor → nextCursor null (ultima pagină)', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], headers: {} });
    expect((await fetchFavoritesPage()).nextCursor).toBeNull();
  });

  it('trimite cursorul primit înapoi la backend', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [], headers: {} });

    await fetchFavoritesPage({ cursor: 'CURSOR2', limit: 5 });

    expect(api.get).toHaveBeenCalledWith('/social/favorites', {
      params: { limit: 5, cursor: 'CURSOR2' },
    });
  });

  it('tolerează un răspuns gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: undefined, headers: {} });
    expect(await fetchFavoritesPage()).toEqual({ items: [], nextCursor: null });
  });
});

describe('fetchFavorites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('întoarce doar rândurile primei pagini (pentru useFavorite)', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ target_user_id: 'u1', name: 'Ana', age: 25, city: 'Chișinău' }],
      headers: { 'x-next-cursor': 'CURSOR2' },
    });

    expect(await fetchFavorites()).toEqual([
      { targetUserId: 'u1', name: 'Ana', age: 25, city: 'Chișinău', photos: [] },
    ]);
  });
});

describe('fetchLikesSentPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face GET /social/likes/sent cu limit și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ target_user_id: 'u9', name: 'Dan', age: 33, city: 'Orhei', photos: [] }],
      headers: {},
    });

    const page = await fetchLikesSentPage();

    expect(api.get).toHaveBeenCalledWith('/social/likes/sent', { params: { limit: 20 } });
    expect(page).toEqual({
      items: [{ targetUserId: 'u9', name: 'Dan', age: 33, city: 'Orhei', photos: [] }],
      nextCursor: null,
    });
  });

  it('citește X-Next-Cursor și trimite cursorul mai departe', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [],
      headers: { 'x-next-cursor': 'NEXT' },
    });

    expect((await fetchLikesSentPage({ cursor: 'PREV' })).nextCursor).toBe('NEXT');
    expect(api.get).toHaveBeenCalledWith('/social/likes/sent', {
      params: { limit: 20, cursor: 'PREV' },
    });
  });

  it('tolerează un răspuns gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: undefined, headers: {} });
    expect(await fetchLikesSentPage()).toEqual({ items: [], nextCursor: null });
  });
});

describe('fetchPendingLikesPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face GET /social/likes/pending și mapează câmpurile proprii', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        {
          target_user_id: 'u1',
          name: 'Ana',
          age: 25,
          city: 'Chișinău',
          photos: ['p1.jpg'],
          is_super: true,
          my_message: 'Salut',
        },
      ],
      headers: { 'x-next-cursor': 'NEXT' },
    });

    const page = await fetchPendingLikesPage();

    expect(api.get).toHaveBeenCalledWith('/social/likes/pending', { params: { limit: 20 } });
    expect(page).toEqual({
      items: [
        {
          targetUserId: 'u1',
          name: 'Ana',
          age: 25,
          city: 'Chișinău',
          photos: ['p1.jpg'],
          isSuper: true,
          myMessage: 'Salut',
        },
      ],
      nextCursor: 'NEXT',
    });
  });

  it('câmpurile proprii lipsă → valori sigure (isSuper false, myMessage null)', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ target_user_id: 'u2', name: 'Ion', age: 30, city: 'Bălți' }],
      headers: {},
    });

    const page = await fetchPendingLikesPage({ cursor: 'PREV' });

    expect(api.get).toHaveBeenCalledWith('/social/likes/pending', {
      params: { limit: 20, cursor: 'PREV' },
    });
    expect(page.items[0]).toEqual({
      targetUserId: 'u2',
      name: 'Ion',
      age: 30,
      city: 'Bălți',
      photos: [],
      isSuper: false,
      myMessage: null,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('tolerează un răspuns gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: undefined, headers: {} });
    expect(await fetchPendingLikesPage()).toEqual({ items: [], nextCursor: null });
  });
});

describe('addFavorite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face POST /social/favorites cu target_user_id în body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await addFavorite('u1');

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/social/favorites', { target_user_id: 'u1' });
  });
});

describe('removeFavorite', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face DELETE /social/favorites/{id}', async () => {
    (api.delete as jest.Mock).mockResolvedValue({ data: {} });

    await removeFavorite('u1');

    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledWith('/social/favorites/u1');
  });
});
