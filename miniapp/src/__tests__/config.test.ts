import { describe, expect, it } from 'vitest';

import { DEV_FALLBACK_API_URL, resolveApiUrl, resolveLegalUrls } from '@/config';

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

/* —————————————————————— adresele paginilor legale —————————————————————— */

describe('resolveLegalUrls', () => {
  const API = 'https://api.flrt.md/api/v1';

  it('derivă termenii, confidențialitatea și suportul din adresa API', () => {
    // Backendul le servește la RĂDĂCINĂ (`backend/app/api/legal.py`, router cu
    // prefix `/legal`, montat în afara lui `api_v1_prefix`).
    expect(resolveLegalUrls(API, {})).toEqual({
      termsUrl: 'https://api.flrt.md/legal/terms',
      privacyUrl: 'https://api.flrt.md/legal/privacy',
      supportUrl: 'https://api.flrt.md/legal/support',
    });
  });

  it('acceptă suprascrieri din mediu, ca pe mobil', () => {
    const urls = resolveLegalUrls(API, {
      VITE_TERMS_URL: 'https://flrt.md/termeni',
      VITE_PRIVACY_URL: ' https://flrt.md/confidentialitate ',
    });
    expect(urls.termsUrl).toBe('https://flrt.md/termeni');
    expect(urls.privacyUrl).toBe('https://flrt.md/confidentialitate');
    // Ce nu e suprascris rămâne derivat.
    expect(urls.supportUrl).toBe('https://api.flrt.md/legal/support');
  });

  it('ignoră o suprascriere care nu e o adresă web', () => {
    const urls = resolveLegalUrls(API, { VITE_TERMS_URL: 'javascript:alert(1)' });
    expect(urls.termsUrl).toBe('https://api.flrt.md/legal/terms');
  });

  it('fără o adresă API validă întoarce `null` — mai bine niciun link decât unul rupt', () => {
    expect(resolveLegalUrls('/api/v1', {})).toEqual({
      termsUrl: null,
      privacyUrl: null,
      supportUrl: null,
    });
  });

  it('merge și pe adresa de dezvoltare', () => {
    expect(resolveLegalUrls(DEV_FALLBACK_API_URL, {}).privacyUrl).toBe(
      'http://localhost:8000/legal/privacy',
    );
  });
});
