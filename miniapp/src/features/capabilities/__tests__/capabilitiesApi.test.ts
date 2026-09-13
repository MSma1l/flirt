/**
 * Stratul de date al capabilităților: normalizarea răspunsului și regula
 * „absența înseamnă NU".
 *
 * Formele acceptate sunt mai multe pentru că ruta de backend nu era încă în
 * repo când s-a scris clientul (vezi comentariul din `capabilitiesApi.ts`).
 * Testul le fixează pe toate: dacă contractul real se dovedește a fi una dintre
 * ele, nimic nu se schimbă; dacă e alta, testul de aici e locul unde se vede.
 */
import { describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';

import {
  CAPABILITY,
  fetchCapabilities,
  isCapabilityEnabled,
  normalizeCapabilities,
  normalizeKey,
} from '../capabilitiesApi';

describe('normalizeCapabilities', () => {
  it('citește forma plată cu booleene', () => {
    const map = normalizeCapabilities({ face_verification: true, push: false });
    expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(true);
    expect(isCapabilityEnabled(map, CAPABILITY.push)).toBe(false);
  });

  it('desface containerul, oricum s-ar numi', () => {
    for (const container of ['capabilities', 'features', 'flags']) {
      const map = normalizeCapabilities({ [container]: { face_verification: true } });
      expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(true);
    }
  });

  it('citește steagul dintr-un obiect, nu doar dintr-un boolean', () => {
    const map = normalizeCapabilities({ features: { face_verification: { enabled: false } } });
    expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(false);
    expect(normalizeCapabilities({ push: { available: true } }).push).toBe(true);
  });

  it('tratează lista ca enumerare a funcțiilor ACTIVE', () => {
    const map = normalizeCapabilities({ capabilities: ['push'] });
    expect(isCapabilityEnabled(map, CAPABILITY.push)).toBe(true);
    // Ce nu e în listă nu e disponibil — nu „necunoscut, deci da".
    expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(false);
  });

  it('acceptă sinonimele numelui, dar numele canonic are ultimul cuvânt', () => {
    expect(isCapabilityEnabled(normalizeCapabilities({ verification: true }), CAPABILITY.faceVerification)).toBe(true);
    expect(isCapabilityEnabled(normalizeCapabilities({ faceVerify: true }), CAPABILITY.faceVerification)).toBe(true);

    // Serverul trimite ambele, iar ele se contrazic: hotărăște cel canonic.
    const both = normalizeCapabilities({ verification: true, face_verification: false });
    expect(isCapabilityEnabled(both, CAPABILITY.faceVerification)).toBe(false);
  });

  it('normalizează scrierea cheii', () => {
    expect(normalizeKey('faceVerification')).toBe('face_verification');
    expect(normalizeKey('Face-Verification')).toBe('face_verification');
    expect(normalizeKey('  FACE VERIFICATION ')).toBe('face_verification');
  });

  it('ignoră ce nu înțelege, în loc să presupună „disponibil"', () => {
    for (const raw of [null, undefined, 'da', 42, { face_verification: 'yes' }, {}]) {
      const map = normalizeCapabilities(raw);
      expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(false);
    }
  });

  it('o funcție necunoscută e implicit indisponibilă', () => {
    const map = normalizeCapabilities({ face_verification: true });
    expect(isCapabilityEnabled(map, 'ceva_ce_nu_exista')).toBe(false);
  });
});

describe('fetchCapabilities', () => {
  it('cere ruta serverului și întoarce harta normalizată', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { capabilities: { face_verification: false } } } as never);

    const map = await fetchCapabilities();

    expect(get).toHaveBeenCalledWith('/capabilities');
    expect(isCapabilityEnabled(map, CAPABILITY.faceVerification)).toBe(false);
  });

  it('lasă eroarea să iasă — decizia de fallback e a apelantului', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('404'));
    await expect(fetchCapabilities()).rejects.toThrow();
  });
});
