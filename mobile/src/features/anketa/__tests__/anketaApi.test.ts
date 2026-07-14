import { fetchReference, submitAnketa } from '../anketaApi';
import { AnketaDraft } from '../types';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchReference', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        genders: ['male', 'female', 'other'],
        dating_statuses: ['serious', 'friendship'],
        languages: ['ru', 'ro', 'en'],
        interests: [
          { slug: 'sport', label: 'Sport' },
          { slug: 'music', label: 'Muzică' },
        ],
      },
    });

    const ref = await fetchReference();

    expect(api.get).toHaveBeenCalledWith('/profiles/reference');
    expect(ref.genders).toEqual(['male', 'female', 'other']);
    expect(ref.datingStatuses).toEqual(['serious', 'friendship']);
    expect(ref.languages).toEqual(['ru', 'ro', 'en']);
    expect(ref.interests).toEqual([
      { slug: 'sport', label: 'Sport' },
      { slug: 'music', label: 'Muzică' },
    ]);
  });

  it('tolerează câmpuri lipsă', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: {} });
    const ref = await fetchReference();
    expect(ref).toEqual({
      genders: [],
      datingStatuses: [],
      languages: [],
      interests: [],
    });
  });
});

describe('submitAnketa', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite payload în snake_case corect', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: {} });

    const draft: AnketaDraft = {
      name: 'Ana',
      birthDate: '2000-05-20',
      gender: 'female',
      heightCm: 170,
      city: 'Chișinău',
      street: 'Str. Florilor',
      nationality: 'română',
      languages: ['ro', 'ru'],
      about: 'Salut!',
      datingStatuses: ['serious', 'friendship'],
      interests: ['sport', 'music'],
    };

    await submitAnketa(draft);

    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(url).toBe('/profiles/me');
    expect(payload).toEqual({
      name: 'Ana',
      birth_date: '2000-05-20',
      gender: 'female',
      height_cm: 170,
      city: 'Chișinău',
      street: 'Str. Florilor',
      nationality: 'română',
      languages: ['ro', 'ru'],
      about: 'Salut!',
      dating_statuses: ['serious', 'friendship'],
      interests: ['sport', 'music'],
      photos: [],
    });
    // câmpurile camelCase NU trebuie trimise
    expect(payload).not.toHaveProperty('birthDate');
    expect(payload).not.toHaveProperty('heightCm');
    expect(payload).not.toHaveProperty('datingStatuses');
  });

  it('trimite pozele existente — PUT /profiles/me REESCRIE lista, altfel s-ar șterge', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: {} });

    const draft: AnketaDraft = {
      name: 'Ana',
      birthDate: '2000-05-20',
      gender: 'female',
      heightCm: 170,
      city: 'Chișinău',
      languages: ['ro'],
      datingStatuses: [],
      interests: ['sport'],
      photos: ['https://cdn.flirt.local/photos/p1/a.jpg'],
    };

    await submitAnketa(draft);

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload.photos).toEqual(['https://cdn.flirt.local/photos/p1/a.jpg']);
  });
});
