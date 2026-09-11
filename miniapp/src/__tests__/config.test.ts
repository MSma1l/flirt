import { describe, expect, it } from 'vitest';

import { DEV_FALLBACK_API_URL, resolveApiUrl } from '@/config';

describe('resolveApiUrl', () => {
  it('folosește variabila de mediu când există', () => {
    expect(resolveApiUrl({ VITE_API_URL: 'https://api.flrt.md/api/v1' })).toBe(
      'https://api.flrt.md/api/v1',
    );
  });

  it('taie spațiile din jur', () => {
    expect(resolveApiUrl({ VITE_API_URL: '  https://api.flrt.md/api/v1  ' })).toBe(
      'https://api.flrt.md/api/v1',
    );
  });

  it('în dezvoltare cade pe localhost dacă variabila lipsește', () => {
    expect(resolveApiUrl({ DEV: true })).toBe(DEV_FALLBACK_API_URL);
  });

  it('în dezvoltare acceptă HTTP (tunel local, backend pe localhost)', () => {
    expect(resolveApiUrl({ VITE_API_URL: 'http://localhost:8000/api/v1', DEV: true })).toBe(
      'http://localhost:8000/api/v1',
    );
  });

  it('în producție, lipsa variabilei oprește pornirea', () => {
    expect(() => resolveApiUrl({})).toThrow(/VITE_API_URL lipsește/);
  });

  it('în producție, o adresă necriptată oprește pornirea', () => {
    expect(() => resolveApiUrl({ VITE_API_URL: 'http://api.flrt.md/api/v1' })).toThrow(
      /HTTPS/,
    );
  });
});
