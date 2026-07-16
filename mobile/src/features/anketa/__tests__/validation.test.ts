import {
  computeAge,
  MAX_ABOUT_LENGTH,
  validateAbout,
  validateBirthDate,
  validateCity,
  validateGender,
  validateHeight,
  validateInterests,
  validateLanguages,
  validateName,
  validateStep,
  isValid,
} from '../validation';

describe('validateName', () => {
  it('respinge numele gol', () => {
    expect(validateName('')).not.toBeNull();
    expect(validateName('   ')).not.toBeNull();
    expect(validateName(undefined)).not.toBeNull();
  });
  it('acceptă un nume valid', () => {
    expect(validateName('Ana')).toBeNull();
  });
});

describe('validateBirthDate', () => {
  it('respinge o dată invalidă', () => {
    expect(validateBirthDate('nu-e-data')).not.toBeNull();
    expect(validateBirthDate('')).not.toBeNull();
  });

  it('respinge vârsta sub 16 ani', () => {
    const now = new Date();
    const under16 = new Date(now.getFullYear() - 15, now.getMonth(), now.getDate());
    const iso = under16.toISOString().slice(0, 10);
    expect(validateBirthDate(iso)).not.toBeNull();
  });

  it('acceptă vârsta de 16 ani sau mai mult', () => {
    const now = new Date();
    const over16 = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());
    const iso = over16.toISOString().slice(0, 10);
    expect(validateBirthDate(iso)).toBeNull();
  });

  it('respinge o dată din viitor', () => {
    const now = new Date();
    const future = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    expect(validateBirthDate(future.toISOString().slice(0, 10))).not.toBeNull();
  });
});

describe('computeAge', () => {
  it('calculează corect vârsta', () => {
    const now = new Date(2026, 6, 7);
    expect(computeAge(new Date(2000, 6, 7), now)).toBe(26);
    // ziua de naștere nu a venit încă anul acesta
    expect(computeAge(new Date(2000, 11, 31), now)).toBe(25);
  });
});

describe('validateHeight', () => {
  it('respinge valori nerezonabile', () => {
    expect(validateHeight(50)).not.toBeNull();
    expect(validateHeight(300)).not.toBeNull();
    expect(validateHeight(undefined)).not.toBeNull();
  });
  it('acceptă o înălțime rezonabilă', () => {
    expect(validateHeight(175)).toBeNull();
  });
});

describe('validateAbout', () => {
  it('respinge textul peste 500 de caractere', () => {
    expect(validateAbout('a'.repeat(MAX_ABOUT_LENGTH + 1))).not.toBeNull();
  });
  it('acceptă textul gol sau în limită', () => {
    expect(validateAbout('')).toBeNull();
    expect(validateAbout(undefined)).toBeNull();
    expect(validateAbout('a'.repeat(MAX_ABOUT_LENGTH))).toBeNull();
  });
});

describe('validări multi-select și simple', () => {
  it('cere cel puțin o limbă', () => {
    expect(validateLanguages([])).not.toBeNull();
    expect(validateLanguages(['ro'])).toBeNull();
  });
  it('cere cel puțin un interes', () => {
    expect(validateInterests([])).not.toBeNull();
    expect(validateInterests(['sport'])).toBeNull();
  });
  it('cere oraș și gen', () => {
    expect(validateCity('')).not.toBeNull();
    expect(validateCity('Chișinău')).toBeNull();
    expect(validateGender(undefined)).not.toBeNull();
    expect(validateGender('male')).toBeNull();
  });
});

describe('validateStep', () => {
  it('întoarce erori pentru pasul 0 incomplet', () => {
    const errs = validateStep(0, {});
    expect(isValid(errs)).toBe(false);
    expect(errs.name).toBeDefined();
    expect(errs.gender).toBeDefined();
    expect(errs.heightCm).toBeDefined();
  });

  it('validează pasul 0 complet', () => {
    const errs = validateStep(0, {
      name: 'Ana',
      birthDate: '2000-01-01',
      gender: 'female',
      heightCm: 170,
    });
    expect(isValid(errs)).toBe(true);
  });

  it('validează pasul 3 (interese)', () => {
    expect(isValid(validateStep(3, { interests: [] }))).toBe(false);
    expect(isValid(validateStep(3, { interests: ['sport'] }))).toBe(true);
  });

  describe('pasul 4 — „Pe cine cauți" (preferințe de căutare)', () => {
    const ok = { interestedIn: ['female'], ageMin: 25, ageMax: 40 };

    it('acceptă un pas complet și corect', () => {
      expect(isValid(validateStep(4, ok))).toBe(true);
    });

    it('cere cel puțin un gen — altfel feed-ul i-ar arăta pe toți', () => {
      const errs = validateStep(4, { ...ok, interestedIn: [] });
      expect(isValid(errs)).toBe(false);
      expect(errs.interestedIn).toBe('Alege cel puțin un gen.');
    });

    it('respinge vârsta minimă sub 18 (aplicația este 18+ ONLY)', () => {
      const errs = validateStep(4, { ...ok, ageMin: 17 });
      expect(isValid(errs)).toBe(false);
      expect(errs.ageMin).toMatch(/nu poate fi sub 18 ani/);
      // 18 fix rămâne valid — e pragul, nu o valoare interzisă.
      expect(isValid(validateStep(4, { ...ok, ageMin: 18 }))).toBe(true);
    });

    it('respinge intervalul inversat (min > max)', () => {
      const errs = validateStep(4, { ...ok, ageMin: 40, ageMax: 25 });
      expect(isValid(errs)).toBe(false);
      expect(errs.ageMax).toBe('Vârsta maximă nu poate fi mai mică decât cea minimă.');
      // Interval degenerat, dar coerent (min === max) → acceptat.
      expect(isValid(validateStep(4, { ...ok, ageMin: 30, ageMax: 30 }))).toBe(true);
    });

    it('cere ambele capete ale intervalului', () => {
      const errs = validateStep(4, { interestedIn: ['female'] });
      expect(errs.ageMin).toBe('Introdu vârsta minimă.');
      expect(errs.ageMax).toBe('Introdu vârsta maximă.');
    });

    it('respinge vârste peste plafonul acceptat de backend', () => {
      expect(isValid(validateStep(4, { ...ok, ageMax: 121 }))).toBe(false);
    });
  });
});
