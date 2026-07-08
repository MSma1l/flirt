import { verifyFace } from '../faceApi';

jest.mock('@/services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('verifyFace', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cheamă /profiles/verify-face și mapează răspunsul', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: true, similarity: 0.92 },
    });

    const result = await verifyFace();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/profiles/verify-face');
    expect(result).toEqual({ verified: true, similarity: 0.92 });
  });

  it('normalizează câmpul verified la boolean', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { verified: 0, similarity: 0.1 },
    });

    const result = await verifyFace();

    expect(result).toEqual({ verified: false, similarity: 0.1 });
  });
});
