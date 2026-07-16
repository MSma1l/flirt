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

  it('normalizează opțiunile backend {value,label_ru,label_ro} → {value,label} (ro)', async () => {
    // Forma REALĂ a backend-ului: obiecte cu etichete localizate, NU string-uri.
    // (Randarea directă a acestor obiecte crăpa cu „Objects are not valid as a
    // React child" — de aceea testul trebuie să oglindească contractul real.)
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        genders: [
          { value: 'male', label_ru: 'Мужчина', label_ro: 'Bărbat' },
          { value: 'female', label_ru: 'Женщина', label_ro: 'Femeie' },
        ],
        dating_statuses: [
          { value: 'serious', label_ru: 'Серьёзные', label_ro: 'Relație serioasă' },
        ],
        languages: [{ value: 'ru', label_ru: 'Русский', label_ro: 'Rusă' }],
        interests: [
          { slug: 'sport', label_ru: 'Спорт', label_ro: 'Sport' },
          { slug: 'music', label_ru: 'Музыка', label_ro: 'Muzică' },
        ],
      },
    });

    const ref = await fetchReference();

    expect(api.get).toHaveBeenCalledWith('/profiles/reference');
    // Fiecare opțiune are {value, label} — label-ul e cel românesc, gata de afișat.
    expect(ref.genders).toEqual([
      { value: 'male', label: 'Bărbat' },
      { value: 'female', label: 'Femeie' },
    ]);
    expect(ref.datingStatuses).toEqual([
      { value: 'serious', label: 'Relație serioasă' },
    ]);
    expect(ref.languages).toEqual([{ value: 'ru', label: 'Rusă' }]);
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

  it('trimite preferințele de căutare — fără ele feed-ul i-ar arăta pe toți', async () => {
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
      interestedIn: ['male', 'other'],
      ageMin: 25,
      ageMax: 40,
    };

    await submitAnketa(draft);

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload.interested_in).toEqual(['male', 'other']);
    expect(payload.age_min).toBe(25);
    expect(payload.age_max).toBe(40);
    // camelCase-ul NU pleacă spre backend.
    expect(payload).not.toHaveProperty('interestedIn');
    expect(payload).not.toHaveProperty('ageMin');
    expect(payload).not.toHaveProperty('ageMax');
  });

  it('fără preferințe în draft, câmpurile lipsesc din payload (backend: „nu le atinge")', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: {} });

    // Ecranul de editare a profilului nu culege preferințe; dacă le-ar trimite
    // goale, ar rescrie ce a ales utilizatorul în wizard / Setări.
    const draft: AnketaDraft = {
      name: 'Ana',
      birthDate: '2000-05-20',
      gender: 'female',
      heightCm: 170,
      city: 'Chișinău',
      languages: ['ro'],
      datingStatuses: [],
      interests: ['sport'],
    };

    await submitAnketa(draft);

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload).not.toHaveProperty('interested_in');
    expect(payload).not.toHaveProperty('age_min');
    expect(payload).not.toHaveProperty('age_max');
  });

  it('lista goală de genuri se trimite explicit (= fără restricție de gen)', async () => {
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
      interestedIn: [],
    };

    await submitAnketa(draft);

    const [, payload] = (api.put as jest.Mock).mock.calls[0];
    expect(payload.interested_in).toEqual([]);
  });
});
