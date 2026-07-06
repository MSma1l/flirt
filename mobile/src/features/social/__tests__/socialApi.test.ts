import { fetchFavorites, removeFavorite } from '../socialApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchFavorites', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face GET /social/favorites și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        { target_user_id: 'u1', name: 'Ana', age: 25, city: 'Chișinău' },
        { target_user_id: 'u2', name: 'Ion', age: 30, city: 'Bălți' },
      ],
    });

    const favorites = await fetchFavorites();

    expect(api.get).toHaveBeenCalledWith('/social/favorites');
    expect(favorites).toEqual([
      { targetUserId: 'u1', name: 'Ana', age: 25, city: 'Chișinău' },
      { targetUserId: 'u2', name: 'Ion', age: 30, city: 'Bălți' },
    ]);
  });

  it('tolerează un răspuns gol', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: undefined });
    const favorites = await fetchFavorites();
    expect(favorites).toEqual([]);
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
