import {
  age16plus,
  computeAge,
  firstError,
  heightCm,
  isEmail,
  isHttpsUrl,
  LIMITS,
  maxLen,
  minLen,
  noHtml,
  required,
  searchRadiusKm,
} from '../validation';

describe('required', () => {
  it('respinge gol / doar spații', () => {
    expect(required('')).not.toBeNull();
    expect(required('   ')).not.toBeNull();
    expect(required(undefined)).not.toBeNull();
    expect(required(null)).not.toBeNull();
  });
  it('acceptă text ne-gol', () => {
    expect(required('a')).toBeNull();
    expect(required('  x  ')).toBeNull();
  });
});

describe('maxLen', () => {
  it('respinge peste limită', () => {
    expect(maxLen('a'.repeat(11), 10)).not.toBeNull();
  });
  it('acceptă în limită sau gol', () => {
    expect(maxLen('a'.repeat(10), 10)).toBeNull();
    expect(maxLen('', 10)).toBeNull();
    expect(maxLen(undefined, 10)).toBeNull();
  });
});

describe('minLen', () => {
  it('respinge sub limită (după trim)', () => {
    expect(minLen('ab', 3)).not.toBeNull();
    expect(minLen('  a  ', 3)).not.toBeNull();
  });
  it('acceptă la sau peste limită', () => {
    expect(minLen('abc', 3)).toBeNull();
  });
});

describe('noHtml', () => {
  it('respinge marcaje HTML / script', () => {
    expect(noHtml('<script>alert(1)</script>')).not.toBeNull();
    expect(noHtml('salut <b>bold</b>')).not.toBeNull();
    expect(noHtml('<img src=x>')).not.toBeNull();
  });
  it('acceptă text simplu sau gol', () => {
    expect(noHtml('text normal 3 < 5')).toBeNull();
    expect(noHtml('')).toBeNull();
    expect(noHtml(undefined)).toBeNull();
  });
});

describe('isEmail', () => {
  it('acceptă un email valid (cu trim)', () => {
    expect(isEmail('nume@exemplu.com')).toBeNull();
    expect(isEmail('  test.user@domeniu.ro  ')).toBeNull();
  });
  it('respinge gol / doar spații', () => {
    expect(isEmail('')).not.toBeNull();
    expect(isEmail('   ')).not.toBeNull();
  });
  it('respinge format invalid', () => {
    expect(isEmail('fara-arond')).not.toBeNull();
    expect(isEmail('lipsa@domeniu')).not.toBeNull();
    expect(isEmail('@exemplu.com')).not.toBeNull();
  });
  it('respinge email cu marcaje HTML', () => {
    expect(isEmail('<script>@x.com')).not.toBeNull();
  });
});

describe('isHttpsUrl', () => {
  it('acceptă https valid', () => {
    expect(isHttpsUrl('https://exemplu.com/poza.jpg')).toBeNull();
    expect(isHttpsUrl('  https://x/1.png  ')).toBeNull();
  });
  it('respinge gol', () => {
    expect(isHttpsUrl('')).not.toBeNull();
    expect(isHttpsUrl('   ')).not.toBeNull();
  });
  it('respinge scheme non-https sau invalide', () => {
    expect(isHttpsUrl('http://exemplu.com')).not.toBeNull();
    expect(isHttpsUrl('ftp://exemplu.com')).not.toBeNull();
    expect(isHttpsUrl('exemplu.com')).not.toBeNull();
    expect(isHttpsUrl('https://cu spatiu')).not.toBeNull();
    expect(isHttpsUrl('https://<script>')).not.toBeNull();
  });
});

describe('heightCm', () => {
  it('respinge valori nerezonabile / lipsă', () => {
    expect(heightCm(50)).not.toBeNull();
    expect(heightCm(300)).not.toBeNull();
    expect(heightCm(undefined)).not.toBeNull();
    expect(heightCm(NaN)).not.toBeNull();
  });
  it('acceptă 100–250', () => {
    expect(heightCm(100)).toBeNull();
    expect(heightCm(175)).toBeNull();
    expect(heightCm(250)).toBeNull();
  });
});

describe('computeAge', () => {
  it('calculează corect vârsta', () => {
    const now = new Date(2026, 6, 7);
    expect(computeAge(new Date(2000, 6, 7), now)).toBe(26);
    expect(computeAge(new Date(2000, 11, 31), now)).toBe(25);
  });
});

describe('age16plus', () => {
  it('respinge gol / dată invalidă', () => {
    expect(age16plus('')).not.toBeNull();
    expect(age16plus('nu-e-data')).not.toBeNull();
  });
  it('respinge vârsta sub 16 ani', () => {
    const now = new Date();
    const under = new Date(now.getFullYear() - 15, now.getMonth(), now.getDate());
    expect(age16plus(under.toISOString().slice(0, 10))).not.toBeNull();
  });
  it('respinge o dată din viitor', () => {
    const now = new Date();
    const future = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
    expect(age16plus(future.toISOString().slice(0, 10))).not.toBeNull();
  });
  it('acceptă vârsta ≥ 16', () => {
    const now = new Date();
    const over = new Date(now.getFullYear() - 20, now.getMonth(), now.getDate());
    expect(age16plus(over.toISOString().slice(0, 10))).toBeNull();
  });
});

describe('searchRadiusKm', () => {
  it('respinge gol / zero / negativ / peste plafon / non-întreg', () => {
    expect(searchRadiusKm('')).not.toBeNull();
    expect(searchRadiusKm('0')).not.toBeNull();
    expect(searchRadiusKm('-5')).not.toBeNull();
    expect(searchRadiusKm('99999')).not.toBeNull();
    expect(searchRadiusKm('abc')).not.toBeNull();
    expect(searchRadiusKm('12.5')).not.toBeNull();
  });
  it('acceptă un număr pozitiv rezonabil', () => {
    expect(searchRadiusKm('1')).toBeNull();
    expect(searchRadiusKm('50')).toBeNull();
    expect(searchRadiusKm('1000')).toBeNull();
  });
});

describe('firstError', () => {
  it('întoarce prima eroare ne-nulă', () => {
    expect(firstError(null, null)).toBeNull();
    expect(firstError(null, 'a', 'b')).toBe('a');
  });
});

describe('LIMITS aliniate cu backend', () => {
  it('păstrează plafoanele așteptate', () => {
    expect(LIMITS.name).toBe(120);
    expect(LIMITS.city).toBe(120);
    expect(LIMITS.about).toBe(500);
    expect(LIMITS.message).toBe(2000);
    expect(LIMITS.note).toBe(500);
    expect(LIMITS.caption).toBe(500);
  });
});
