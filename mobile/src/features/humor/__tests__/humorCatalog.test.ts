/**
 * Gardianul catalogului `humor` în cele 4 limbi.
 *
 * Paritatea cheilor și interpolările sunt deja verificate global, pentru toate
 * namespace-urile, de `src/i18n/__tests__/catalogs.test.ts` — nu le dublăm aici.
 * Ce NU acoperă gardianul global e valoarea: o cheie prezentă, dar cu text gol,
 * trece de paritate și ajunge pe ecran ca un buton fără etichetă. Ecranul de umor
 * e obligatoriu, deci un buton gol acolo = user blocat.
 */
import enHumor from '@/i18n/locales/en/humor.json';
import roHumor from '@/i18n/locales/ro/humor.json';
import ruHumor from '@/i18n/locales/ru/humor.json';
import ukHumor from '@/i18n/locales/uk/humor.json';

const CATALOGS = { ro: roHumor, ru: ruHumor, uk: ukHumor, en: enHumor };

/** `{a: {b: "x"}}` → `[["a.b", "x"]]`. */
function entries(obj: Record<string, unknown>, prefix = ''): [string, unknown][] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? entries(value as Record<string, unknown>, path)
      : ([[path, value]] as [string, unknown][]);
  });
}

describe('catalogul `humor`', () => {
  it.each(Object.keys(CATALOGS))('„%s" nu are niciun text gol', (lang) => {
    const empty = entries(CATALOGS[lang as keyof typeof CATALOGS])
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([key]) => key);

    expect({ lang, empty }).toEqual({ lang, empty: [] });
  });

  it('nicio limbă nu a rămas cu textul românesc copiat („traducere" uitată)', () => {
    // Nu prinde o traducere proastă, dar prinde copy-paste-ul din română —
    // greșeala tipică la umplerea unui catalog nou.
    for (const [lang, catalog] of Object.entries(CATALOGS)) {
      if (lang === 'ro') continue;

      const identical = entries(catalog)
        .filter(([key, value]) => {
          const roValue = key
            .split('.')
            .reduce<unknown>((o, k) => (o as never)?.[k], roHumor as unknown);
          return typeof roValue === 'string' && roValue === value;
        })
        .map(([key]) => key);

      expect({ lang, identical }).toEqual({ lang, identical: [] });
    }
  });
});
