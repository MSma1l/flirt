import { fetchMyProfile } from '../profileApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('fetchMyProfile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('face GET /profiles/me și mapează snake_case → camelCase', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
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
        photos: ['p1.jpg', 'p2.jpg'],
      },
    });

    const profile = await fetchMyProfile();

    expect(api.get).toHaveBeenCalledWith('/profiles/me');
    expect(profile).toEqual({
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
      photos: ['p1.jpg', 'p2.jpg'],
    });
    // câmpurile snake_case NU trebuie păstrate
    expect(profile).not.toHaveProperty('birth_date');
    expect(profile).not.toHaveProperty('height_cm');
    expect(profile).not.toHaveProperty('dating_statuses');
  });

  it('tolerează câmpuri lipsă cu valori implicite', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: {} });

    const profile = await fetchMyProfile();

    expect(profile).toEqual({
      name: '',
      birthDate: '',
      gender: '',
      heightCm: 0,
      city: '',
      street: undefined,
      nationality: undefined,
      languages: [],
      about: undefined,
      datingStatuses: [],
      interests: [],
      photos: [],
    });
  });
});
