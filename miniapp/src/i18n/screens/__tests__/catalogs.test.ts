/**
 * Gardianul catalogului `screens` — namespace-ul propriu al Mini App-ului.
 *
 * Model: `mobile/src/i18n/__tests__/catalogs.test.ts`, care păzește cataloagele
 * partajate cu aplicația nativă. Acela NU vede `screens` (nu e în `NAMESPACES`
 * din configul partajat), deci fără testul de aici o cheie adăugată doar în
 * `ro.json` ar ajunge nevăzută în producție: româna ar arăta corect, iar rusa și
 * engleza ar afișa cheia brută sau textul românesc prin fallback.
 *
 * Verificăm patru lucruri, în ordinea în care se strică de obicei:
 *   1. fiecare limbă are catalogul;
 *   2. aceleași chei în toate limbile (româna e referința — e limba implicită);
 *   3. formele de plural cerute de CLDR pentru fiecare limbă;
 *   4. aceleași variabile de interpolare (un `{{name}}` pierdut la traducere e
 *      tăcut în producție).
 */
import { SUPPORTED_LANGUAGES, type Language } from '@mobile/i18n/config';

import { i18n, SCREENS_NAMESPACE, screensResources } from '../..';

/** Sufixele de plural pe care i18next le adaugă la cheia de bază. */
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** `{a: {b: "x"}}` → `["a.b"]`. */
function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? flatten(value as Record<string, unknown>, path)
      : [path];
  });
}

/** `entries_one` → `entries`; cheile fără plural rămân neatinse. */
function stripPluralSuffix(key: string): string {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suffix}`)) return key.slice(0, -(suffix.length + 1));
  }
  return key;
}

function catalog(lang: Language): Record<string, unknown> {
  return screensResources[lang];
}

function baseKeys(lang: Language): Set<string> {
  return new Set(flatten(catalog(lang)).map(stripPluralSuffix));
}

/** Cheile de bază care au variante de plural într-o limbă. */
function pluralBaseKeys(lang: Language): Set<string> {
  return new Set(
    flatten(catalog(lang))
      .filter((k) => stripPluralSuffix(k) !== k)
      .map(stripPluralSuffix),
  );
}

function textAt(lang: Language, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as never)?.[k], catalog(lang));
}

describe('catalogul „screens"', () => {
  it('există pentru fiecare limbă suportată și nu e gol', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(catalog(lang)).toBeDefined();
      expect(flatten(catalog(lang)).length).toBeGreaterThan(0);
    }
  });

  // Româna e referința: e limba implicită și singura garantat completă.
  it.each(SUPPORTED_LANGUAGES.filter((l) => l !== 'ro'))(
    'are aceleași chei în „%s" ca în română',
    (lang) => {
      const roKeys = baseKeys('ro');
      const langKeys = baseKeys(lang);

      const missing = [...roKeys].filter((k) => !langKeys.has(k));
      const extra = [...langKeys].filter((k) => !roKeys.has(k));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    },
  );

  it.each(SUPPORTED_LANGUAGES)('„%s" nu are texte goale', (lang) => {
    const empty = flatten(catalog(lang)).filter((key) => {
      const value = textAt(lang, key);
      return typeof value !== 'string' ? false : value.trim() === '';
    });
    expect({ lang, empty }).toEqual({ lang, empty: [] });
  });

  /**
   * Pluralul nu e „o cheie în plus": fiecare limbă are propriile categorii CLDR
   * (româna: one/few/other; rusa adaugă `many`; engleza: one/other). Folosim
   * `Intl.PluralRules` — aceeași sursă pe care o folosește i18next — ca să nu
   * inventăm noi regulile.
   */
  describe('forme de plural', () => {
    it.each(SUPPORTED_LANGUAGES)('„%s" are toate categoriile CLDR cerute', (lang) => {
      const required = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const keys = flatten(catalog(lang));

      for (const base of pluralBaseKeys(lang)) {
        const present = required.filter((cat) => keys.includes(`${base}_${cat}`));
        expect({ base, present }).toEqual({ base, present: required });
      }
    });

    it('cheile cu plural sunt aceleași în toate limbile', () => {
      const roPlurals = [...pluralBaseKeys('ro')].sort();

      for (const lang of SUPPORTED_LANGUAGES) {
        expect({ lang, keys: [...pluralBaseKeys(lang)].sort() }).toEqual({
          lang,
          keys: roPlurals,
        });
      }
    });
  });

  /**
   * O interpolare pierdută la traducere („Deschide {{title}}" → „Открыть") ar
   * produce o etichetă fără numele evenimentului, în producție, tăcut.
   */
  it('păstrează aceleași variabile de interpolare în toate limbile', () => {
    const variablesOf = (text: string) =>
      [...text.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort();

    for (const key of flatten(catalog('ro'))) {
      const roText = textAt('ro', key);
      if (typeof roText !== 'string') continue;

      const expected = variablesOf(roText);
      if (expected.length === 0) continue;

      const base = stripPluralSuffix(key);

      for (const lang of SUPPORTED_LANGUAGES) {
        // La plural, comparăm pe categoriile existente în limba respectivă.
        const candidates = flatten(catalog(lang)).filter(
          (k) => stripPluralSuffix(k) === base,
        );

        for (const candidate of candidates) {
          const text = textAt(lang, candidate);
          if (typeof text !== 'string') continue;

          expect({ lang, key: candidate, vars: variablesOf(text) }).toEqual({
            lang,
            key: candidate,
            vars: expected,
          });
        }
      }
    }
  });

  /**
   * Cataloagele pot fi perfecte și totuși inutile dacă namespace-ul nu e
   * ÎNREGISTRAT în instanța i18n. Verificăm pe viu, comutând limba.
   */
  it('e înregistrat în instanța i18n și răspunde în fiecare limbă', async () => {
    const initial = i18n.language;
    try {
      for (const lang of SUPPORTED_LANGUAGES) {
        await i18n.changeLanguage(lang);
        const text = i18n.t(`${SCREENS_NAMESPACE}:events.kind.concert`);
        expect({ lang, text }).toEqual({ lang, text: textAt(lang, 'events.kind.concert') });
      }
    } finally {
      await i18n.changeLanguage(initial);
    }
  });

  /**
   * Traducerea „uitată": textul rusesc/englez identic cu cel românesc. Câteva
   * cazuri sunt LEGITIME (nume de produs, cuvinte internaționale), deci sunt
   * trecute explicit mai jos — lista scurtă e exact ideea: orice alt text
   * necopiat trebuie observat.
   */
  it('nu lasă texte românești necopiate în rusă', () => {
    const ALLOWED = new Set([
      'events.kind.flirt_party', // numele produsului nu se traduce
    ]);

    const copied = flatten(catalog('ro')).filter((key) => {
      if (ALLOWED.has(key)) return false;
      const ro = textAt('ro', key);
      const ru = textAt('ru', key);
      return typeof ro === 'string' && ro === ru;
    });

    expect(copied).toEqual([]);
  });
});
