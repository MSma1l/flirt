/** Store de auth: ieșirea forțată la sesiune expirată. */
import { tokenStore } from '@/services/tokenStore';

jest.mock('@/services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  setUnauthorizedHandler: jest.fn(),
}));

jest.mock('@/features/push/pushService', () => ({
  unregisterDevice: jest.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setUnauthorizedHandler } = require('@/services/api');
// Importat DUPĂ mock-uri: la încărcare, store-ul își înregistrează handlerul.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useAuthStore } = require('../authStore');

describe('authStore.forceLogout', () => {
  beforeEach(async () => {
    await tokenStore.setTokens('access', 'refresh');
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u1', email: 'nume@exemplu.com', profile_completed: true },
    });
  });

  it('golește tokenurile și trece store-ul pe unauthenticated', async () => {
    await useAuthStore.getState().forceLogout();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
    expect(tokenStore.getAccess()).toBeNull();
    await expect(tokenStore.getRefresh()).resolves.toBeNull();
  });

  it('este înregistrat ca handler de sesiune expirată în clientul HTTP', async () => {
    expect(setUnauthorizedHandler).toHaveBeenCalledTimes(1);

    // Exact ce cheamă interceptorul de 401 când refresh-ul eșuează.
    const handler = setUnauthorizedHandler.mock.calls[0][0];
    await handler();

    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().user).toBeNull();
  });
});
