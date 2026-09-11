/**
 * Validarea anketei pe client — aceleași praguri ca backendul.
 * Accentul cade pe poarta 18+: aplicația e „adults only", iar o greșeală aici
 * s-ar vedea abia în magazinele de aplicații.
 */
import { describe, expect, it } from 'vitest';

import { latestAllowedBirthDate } from '../ProfileFormScreen';
import {
  isValid,
  MIN_REGISTRATION_AGE,
  validateAbout,
  validateBirthDate,
  validateCity,
  validateDraft,
  validateHeight,
  validateInterests,
  validateLanguages,
  validateName,
} from '../validation';

const NOW = new Date('2026-06-15T12:00:00Z');

describe('vârsta minimă (18+)', () => {
  it('pragul e același cu `MIN_REGISTRATION_AGE` din backend', () => {
    expect(MIN_REGISTRATION_AGE).toBe(18);
  });

  it('acceptă pe cineva care împlinește 18 ani CHIAR azi', () => {
    expect(validateBirthDate('2008-06-15', NOW)).toBeNull();
  });

  it('respinge pe cineva căruia îi mai lipsește o zi', () => {
    expect(validateBirthDate('2008-06-16', NOW)).toEqual({
      key: 'onboarding.errors.tooYoung',
      params: { min: 18 },
    });
  });

  it('respinge un minor evident', () => {
    expect(validateBirthDate('2014-01-01', NOW)?.key).toBe('onboarding.errors.tooYoung');
  });

  it('respinge o dată din viitor', () => {
    expect(validateBirthDate('2030-01-01', NOW)?.key).toBe(
      'onboarding.errors.birthDateFuture',
    );
  });

  it('respinge o dată imposibilă', () => {
    expect(validateBirthDate('nu-i o dată', NOW)?.key).toBe(
      'onboarding.errors.birthDateInvalid',
    );
  });

  it('cere data nașterii când lipsește', () => {
    expect(validateBirthDate('', NOW)?.key).toBe('onboarding.errors.birthDateRequired');
    expect(validateBirthDate(undefined, NOW)?.key).toBe(
      'onboarding.errors.birthDateRequired',
    );
  });

  it('selectorul de dată nu lasă să se aleagă o zi sub 18 ani', () => {
    expect(latestAllowedBirthDate(NOW)).toBe('2008-06-15');
  });
});

describe('câmpurile obligatorii ale backendului', () => {
  it('numele: ne-gol, fără marcaje HTML', () => {
    expect(validateName('Ana')).toBeNull();
    expect(validateName('  ')?.key).toBe('onboarding.errors.nameRequired');
    expect(validateName('<script>x</script>')?.key).toBe('onboarding.errors.noHtml');
    expect(validateName('a'.repeat(121))?.key).toBe('onboarding.errors.tooLong');
  });

  it('orașul: ne-gol, fără marcaje HTML', () => {
    expect(validateCity('Chișinău')).toBeNull();
    expect(validateCity('')?.key).toBe('onboarding.errors.cityRequired');
    expect(validateCity('<b>Bălți</b>')?.key).toBe('onboarding.errors.noHtml');
  });

  it('înălțimea: între 100 și 250 cm', () => {
    expect(validateHeight(175)).toBeNull();
    expect(validateHeight(99)?.key).toBe('onboarding.errors.heightRange');
    expect(validateHeight(251)?.key).toBe('onboarding.errors.heightRange');
    expect(validateHeight(Number.NaN)?.key).toBe('onboarding.errors.heightRequired');
    expect(validateHeight(undefined)?.key).toBe('onboarding.errors.heightRequired');
  });

  it('cel puțin o limbă și cel puțin un interes — reguli de service, nu de schemă', () => {
    expect(validateLanguages([])?.key).toBe('onboarding.errors.languagesRequired');
    expect(validateLanguages(['ro'])).toBeNull();
    expect(validateInterests([])?.key).toBe('onboarding.errors.interestsRequired');
    expect(validateInterests(['sport'])).toBeNull();
  });

  it('„despre" e opțional, dar plafonat la 500 de caractere', () => {
    expect(validateAbout(undefined)).toBeNull();
    expect(validateAbout('salut')).toBeNull();
    expect(validateAbout('a'.repeat(501))?.key).toBe('onboarding.errors.tooLong');
  });
});

describe('validarea întregului draft', () => {
  const VALID = {
    name: 'Ana',
    birthDate: '1996-05-20',
    gender: 'female',
    heightCm: 170,
    city: 'Chișinău',
    languages: ['ro'],
    interests: ['sport'],
    datingStatuses: [],
  };

  it('un draft complet nu are erori', () => {
    expect(isValid(validateDraft(VALID, NOW))).toBe(true);
  });

  it('un draft gol raportează TOATE câmpurile lipsă deodată', () => {
    const errors = validateDraft({}, NOW);
    expect(Object.keys(errors).sort()).toEqual(
      ['birthDate', 'city', 'gender', 'heightCm', 'interests', 'languages', 'name'].sort(),
    );
  });

  it('un minor e prins chiar dacă restul e perfect', () => {
    const errors = validateDraft({ ...VALID, birthDate: '2015-01-01' }, NOW);
    expect(isValid(errors)).toBe(false);
    expect(errors.birthDate?.key).toBe('onboarding.errors.tooYoung');
  });
});
