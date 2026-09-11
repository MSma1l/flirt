/**
 * Validatoarele întorc CHEI de traducere, nu propoziții. Testele verifică cheia
 * exactă: altfel „respinge" ar trece și cu cheia greșită, iar userul ar vedea
 * mesajul altei erori. Că fiecare cheie chiar există în cataloage e treaba lui
 * `tsc` (uniunea `AuthValidationKey`) și a gardianului din `i18n/__tests__`.
 */
import i18n from '@/i18n';
import {
  MIN_PASSWORD_LENGTH,
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
    expect(validateEmail('')).toBe('validation.emailRequired');
    expect(validateEmail('   ')).toBe('validation.emailRequired');
  });

  it('respinge un email fără format valid', () => {
    expect(validateEmail('fara-arond')).toBe('validation.emailInvalid');
    expect(validateEmail('lipsa@domeniu')).toBe('validation.emailInvalid');
    expect(validateEmail('@exemplu.com')).toBe('validation.emailInvalid');
  });
});

describe('validatePassword', () => {
  it('acceptă o parolă de minim 8 caractere', () => {
    expect(validatePassword('parola12')).toBeNull();
    expect(validatePassword('unaLungaSecreta')).toBeNull();
  });

  it('respinge o parolă goală', () => {
    expect(validatePassword('')).toBe('validation.passwordRequired');
  });

  it('respinge o parolă prea scurtă', () => {
    expect(validatePassword('scurt')).toBe('validation.passwordTooShort');
    expect(validatePassword('1234567')).toBe('validation.passwordTooShort');
  });

  it('respinge marcajele HTML (anti-XSS, simetric cu backend-ul)', () => {
    expect(validatePassword('<script>alert(1)</script>')).toBe('validation.noHtml');
  });
});

describe('validatePasswordMatch', () => {
  it('acceptă când parolele coincid', () => {
    expect(validatePasswordMatch('parola12', 'parola12')).toBeNull();
  });

  it('respinge confirmarea goală', () => {
    expect(validatePasswordMatch('parola12', '')).toBe('validation.confirmRequired');
  });

  it('respinge când parolele diferă', () => {
    expect(validatePasswordMatch('parola12', 'parola13')).toBe(
      'validation.passwordsMismatch',
    );
  });
});

describe('cheile ajung la texte reale', () => {
  afterAll(async () => {
    await i18n.changeLanguage('ro');
  });

  it('pragul de lungime vine din cod, nu scris de mână în catalog', () => {
    expect(
      i18n.t('auth:validation.passwordTooShort', { min: MIN_PASSWORD_LENGTH }),
    ).toBe('Parola trebuie să aibă cel puțin 8 caractere.');
  });

  it('aceeași cheie dă textul limbii active', async () => {
    await i18n.changeLanguage('ru');
    expect(i18n.t('auth:validation.passwordsMismatch')).toBe('Пароли не совпадают.');

    await i18n.changeLanguage('en');
    expect(i18n.t('auth:validation.passwordsMismatch')).toBe(
      'The passwords do not match.',
    );
  });
});
