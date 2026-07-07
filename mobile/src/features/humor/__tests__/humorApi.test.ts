import { fetchHumor, fetchQuiz, submitQuiz } from '../humorApi';

jest.mock('@/services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

const RAW_CARDS = [
  { id: 'c1', text: 'De ce a trecut puiul strada?', type: 'absurd' },
  { id: 'c2', text: 'Un cuvânt: cartof.', type: 'pun' },
];

describe('fetchQuiz', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /humor/quiz și întoarce cardurile', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: RAW_CARDS });

    const cards = await fetchQuiz();

    expect(api.get).toHaveBeenCalledWith('/humor/quiz');
    expect(cards).toEqual(RAW_CARDS);
  });

  it('întoarce listă goală când data lipsește', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: null });
    const cards = await fetchQuiz();
    expect(cards).toEqual([]);
  });
});

describe('submitQuiz', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mapează camelCase → snake_case (card_id) în payload și întoarce vectorul', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { vector: { absurd: 0.7, pun: 0.3 } },
    });

    const profile = await submitQuiz([
      { cardId: 'c1', funny: true },
      { cardId: 'c2', funny: false },
    ]);

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/humor/submit');
    expect(payload).toEqual({
      answers: [
        { card_id: 'c1', funny: true },
        { card_id: 'c2', funny: false },
      ],
    });
    expect(profile).toEqual({ vector: { absurd: 0.7, pun: 0.3 } });
  });
});

describe('fetchHumor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cere /humor/me și întoarce profilul salvat', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { vector: { sarcastic: 1 } },
    });

    const profile = await fetchHumor();

    expect(api.get).toHaveBeenCalledWith('/humor/me');
    expect(profile).toEqual({ vector: { sarcastic: 1 } });
  });
});
