import * as Localization from 'expo-localization';

import { DEFAULT_LANGUAGE } from '../config';
import i18n, { initI18n, resolveInitialLanguage } from '../index';
import { languageStore } from '../languageStore';

const mockedGetLocales = Localization.getLocales as jest.MockedFunction<
  typeof Localization.getLocales
>;

function deviceLocale(languageTag: string, languageCode: string) {
  return [{ languageTag, languageCode }] as unknown as ReturnType<typeof Localization.getLocales>;
}

describe('i18n', () => {
  beforeEach(async () => {
    await languageStore.clear();
    mockedGetLocales.mockReturnValue(deviceLocale('ro-MD', 'ro'));
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  afterAll(async () => {
    await languageStore.clear();
    await i18n.changeLanguage(DEFAULT_LANGUAGE);
  });

  it('pornește inițializat, pe română, fără să aștepte nimic', () => {
    // Esențial: testele existente randează ecrane sincron. Dacă instanța n-ar fi
    // gata la import, ele ar vedea chei brute în loc de text românesc.
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.language).toBe('ro');
  });

  describe('resolveInitialLanguage', () => {
    it('preferă limba salvată de utilizator', async () => {
      await languageStore.set('uk');
      mockedGetLocales.mockReturnValue(deviceLocale('ru-RU', 'ru'));

      await expect(resolveInitialLanguage()).resolves.toBe('uk');
    });

    it('fără alegere salvată, ia limba dispozitivului', async () => {
      mockedGetLocales.mockReturnValue(deviceLocale('ru-RU', 'ru'));

      await expect(resolveInitialLanguage()).resolves.toBe('ru');
    });

    it('cade pe română când limba dispozitivului nu e suportată', async () => {
      mockedGetLocales.mockReturnValue(deviceLocale('de-DE', 'de'));

      await expect(resolveInitialLanguage()).resolves.toBe('ro');
    });

    it('cade pe română când dispozitivul nu raportează nicio limbă', async () => {
      mockedGetLocales.mockReturnValue([]);

      await expect(resolveInitialLanguage()).resolves.toBe('ro');
    });

    it('nu aruncă dacă modulul nativ de localizare crapă', async () => {
      mockedGetLocales.mockImplementation(() => {
        throw new Error('modul nativ indisponibil');
      });

      await expect(resolveInitialLanguage()).resolves.toBe('ro');
    });
  });

  describe('initI18n', () => {
    it('comută instanța pe limba rezolvată', async () => {
      await languageStore.set('en');

      await expect(initI18n()).resolves.toBe('en');
      expect(i18n.language).toBe('en');
    });

    it('rămâne pe română când nu există preferință și dispozitivul e românesc', async () => {
      await expect(initI18n()).resolves.toBe('ro');
      expect(i18n.language).toBe('ro');
    });
  });

  describe('traduceri', () => {
    it('întoarce textul din namespace-ul cerut, în limba activă', async () => {
      expect(i18n.t('auth:login.title')).toBe('Bine ai revenit');

      await i18n.changeLanguage('ru');
      expect(i18n.t('auth:login.title')).toBe('С возвращением');

      await i18n.changeLanguage('uk');
      expect(i18n.t('auth:login.title')).toBe('З поверненням');

      await i18n.changeLanguage('en');
      expect(i18n.t('auth:login.title')).toBe('Welcome back');
    });

    it('cade pe română pentru o cheie netradusă încă', async () => {
      await i18n.changeLanguage('en');
      // Cheie inexistentă în engleză → fallbackLng „ro".
      expect(i18n.t('auth:login.title', { lng: 'ro' })).toBe('Bine ai revenit');
    });

    it('aplică regulile de plural ale fiecărei limbi', async () => {
      // Româna are 3 forme: 1 an / 2..19 ani / 20+ „de ani".
      await i18n.changeLanguage('ro');
      expect(i18n.t('common:age', { count: 1 })).toBe('1 an');
      expect(i18n.t('common:age', { count: 5 })).toBe('5 ani');
      expect(i18n.t('common:age', { count: 20 })).toBe('20 de ani');

      // Rusa are 4: 1 год / 2-4 года / 5-20 лет.
      await i18n.changeLanguage('ru');
      expect(i18n.t('common:age', { count: 1 })).toBe('1 год');
      expect(i18n.t('common:age', { count: 3 })).toBe('3 года');
      expect(i18n.t('common:age', { count: 7 })).toBe('7 лет');

      // Ucraineana, la fel, dar cu formele ei — NU e rusa transliterată.
      await i18n.changeLanguage('uk');
      expect(i18n.t('common:age', { count: 1 })).toBe('1 рік');
      expect(i18n.t('common:age', { count: 3 })).toBe('3 роки');
      expect(i18n.t('common:age', { count: 7 })).toBe('7 років');

      await i18n.changeLanguage('en');
      expect(i18n.t('common:age', { count: 1 })).toBe('1 year old');
      expect(i18n.t('common:age', { count: 7 })).toBe('7 years old');
    });
  });
});
