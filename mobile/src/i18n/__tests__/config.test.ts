import {
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  NAMESPACES,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  normalizeLanguage,
} from '../config';

describe('config i18n', () => {
  it('suportă exact cele 4 limbi cerute, cu româna implicită', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['ro', 'ru', 'uk', 'en']);
    expect(DEFAULT_LANGUAGE).toBe('ro');
  });

  it('numele limbilor sunt endonime (fiecare în limba ei)', () => {
    expect(LANGUAGE_LABELS).toEqual({
      ro: 'Română',
      ru: 'Русский',
      uk: 'Українська',
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
      expect(normalizeLanguage('uk-UA')).toBe('uk');
      expect(normalizeLanguage('en-GB')).toBe('en');
    });

    it('acceptă și separatorul cu underscore, și majuscule', () => {
      expect(normalizeLanguage('ru_RU')).toBe('ru');
      expect(normalizeLanguage('UK')).toBe('uk');
    });

    it('tratează codul învechit „mo" (moldovenească) ca română', () => {
      expect(normalizeLanguage('mo')).toBe('ro');
      expect(normalizeLanguage('mo-MD')).toBe('ro');
    });

    it('întoarce null pentru limbi nesuportate sau valori goale', () => {
      expect(normalizeLanguage('de')).toBeNull();
      expect(normalizeLanguage('')).toBeNull();
      expect(normalizeLanguage(null)).toBeNull();
      expect(normalizeLanguage(undefined)).toBeNull();
    });

    it('nu confundă `uk` (ucraineană) cu `en` prin regiunea UK', () => {
      // „en-GB" e engleză britanică; „uk" e ucraineană. Confuzia asta e clasică.
      expect(normalizeLanguage('en-GB')).toBe('en');
      expect(normalizeLanguage('uk-UA')).toBe('uk');
    });
  });

  describe('isSupportedLanguage', () => {
    it('acceptă doar limbile din listă', () => {
      expect(isSupportedLanguage('ro')).toBe(true);
      expect(isSupportedLanguage('uk')).toBe(true);
      expect(isSupportedLanguage('de')).toBe(false);
      expect(isSupportedLanguage(42)).toBe(false);
      expect(isSupportedLanguage(null)).toBe(false);
    });
  });
});
