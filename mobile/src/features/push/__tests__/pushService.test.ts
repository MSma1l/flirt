import { Platform } from 'react-native';

import { registerDevice } from '../pushService';

jest.mock('@/services/api', () => ({
  api: {
    post: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api } = require('@/services/api');

describe('registerDevice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('trimite {token, platform} la /push/register', async () => {
    (api.post as jest.Mock).mockResolvedValue({ status: 204 });

    await registerDevice();

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, payload] = (api.post as jest.Mock).mock.calls[0];
    expect(url).toBe('/push/register');
    expect(payload).toEqual({
      token: `expo-dev-token-${Platform.OS}`,
      platform: Platform.OS,
    });
  });

  it('nu aruncă dacă cererea eșuează', async () => {
    (api.post as jest.Mock).mockRejectedValue(new Error('network'));

    await expect(registerDevice()).resolves.toBeUndefined();
  });
});
