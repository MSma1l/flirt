import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  NAMESPACES,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
} from '../config';

describe('config i18n', () => {
  it('suportă exact cele 3 limbi cerute, cu româna implicită', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['ro', 'ru', 'en']);
    expect(DEFAULT_LANGUAGE).toBe('ro');
  });

  it('numele limbilor sunt endonime (fiecare în limba ei)', () => {
    expect(LANGUAGE_LABELS).toEqual({
      ro: 'Română',
      ru: 'Русский',
      en: 'English',
    });
  });

  it('namespace-urile sunt unice', () => {
    expect(new Set(NAMESPACES).size).toBe(NAMESPACES.length);
  });

  describe('normalizeLanguage', () => {
    it('reduce eticheta regională la limbă', () => {
      expect(normalizeLanguage('ro-MD')).toBe('ro');
      expect(normalizeLanguage('ru-RU')).toBe('ru');
      expect(normalizeLanguage('en-GB')).toBe('en');
    });

    it('acceptă și separatorul cu underscore, și majuscule', () => {
      expect(normalizeLanguage('ru_RU')).toBe('ru');
      expect(normalizeLanguage('RU')).toBe('ru');
    });

    it('tratează codul învechit „mo" (moldovenească) ca română', () => {
      expect(normalizeLanguage('mo')).toBe('ro');
      expect(normalizeLanguage('mo-MD')).toBe('ro');
    });

    it('întoarce null pentru limbi nesuportate sau valori goale', () => {
      expect(normalizeLanguage('de')).toBeNull();
      // Ucraineana a ieșit din interfață: nu mai e o limbă suportată.
      expect(normalizeLanguage('uk')).toBeNull();
      expect(normalizeLanguage('uk-UA')).toBeNull();
      expect(normalizeLanguage('')).toBeNull();
      expect(normalizeLanguage(null)).toBeNull();
      expect(normalizeLanguage(undefined)).toBeNull();
    });

    it('nu confundă `uk` (ucraineană) cu `en` prin regiunea UK', () => {
      // „en-GB" e engleză britanică; „uk" e ucraineană — nu engleză din UK.
      // Acum că `uk` nu mai e suportată, corect e `null`, NU „en".
      expect(normalizeLanguage('en-GB')).toBe('en');
      expect(normalizeLanguage('uk-UA')).toBeNull();
    });
  });

  describe('isSupportedLanguage', () => {
    it('acceptă doar limbile din listă', () => {
      expect(isSupportedLanguage('ro')).toBe(true);
      expect(isSupportedLanguage('uk')).toBe(false);
      expect(isSupportedLanguage('de')).toBe(false);
      expect(isSupportedLanguage(42)).toBe(false);
      expect(isSupportedLanguage(null)).toBe(false);
    });
  });
});
