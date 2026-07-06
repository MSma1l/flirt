import {
  validateEmail,
  validatePassword,
  validatePasswordMatch,
} from '@/features/auth/validation';

describe('validateEmail', () => {
  it('acceptă un email valid', () => {
    expect(validateEmail('nume@exemplu.com')).toBeNull();
    expect(validateEmail('  test.user@domeniu.ro  ')).toBeNull();
  });

  it('respinge un email gol', () => {
    expect(validateEmail('')).not.toBeNull();
    expect(validateEmail('   ')).not.toBeNull();
  });

  it('respinge un email fără format valid', () => {
    expect(validateEmail('fara-arond')).not.toBeNull();
    expect(validateEmail('lipsa@domeniu')).not.toBeNull();
    expect(validateEmail('@exemplu.com')).not.toBeNull();
  });
});

describe('validatePassword', () => {
  it('acceptă o parolă de minim 8 caractere', () => {
    expect(validatePassword('parola12')).toBeNull();
    expect(validatePassword('unaLungaSecreta')).toBeNull();
  });

  it('respinge o parolă goală', () => {
    expect(validatePassword('')).not.toBeNull();
  });

  it('respinge o parolă prea scurtă', () => {
    expect(validatePassword('scurt')).not.toBeNull();
    expect(validatePassword('1234567')).not.toBeNull();
  });
});

describe('validatePasswordMatch', () => {
  it('acceptă când parolele coincid', () => {
    expect(validatePasswordMatch('parola12', 'parola12')).toBeNull();
  });

  it('respinge confirmarea goală', () => {
    expect(validatePasswordMatch('parola12', '')).not.toBeNull();
  });

  it('respinge când parolele diferă', () => {
    expect(validatePasswordMatch('parola12', 'parola13')).not.toBeNull();
  });
});
