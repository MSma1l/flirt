import { getAppleIdToken, getGoogleIdToken } from '../socialAuth';

describe('socialAuth (stub)', () => {
  it('getGoogleIdToken întoarce token-ul stub pentru Google', async () => {
    await expect(getGoogleIdToken()).resolves.toBe('stub:google@example.com');
  });

  it('getAppleIdToken întoarce token-ul stub pentru Apple', async () => {
    await expect(getAppleIdToken()).resolves.toBe('stub:apple@example.com');
  });
});
