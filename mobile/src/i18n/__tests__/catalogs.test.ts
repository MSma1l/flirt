/**
 * Gardianul cataloagelor. Rulează peste TOATE limbile × namespace-urile, deci
 * prinde automat și cheile adăugate de agenții care migrează ecrane — fără ca
 * ei să scrie vreun test aici.
 */
import { NAMESPACES, SUPPORTED_LANGUAGES, type Language, type Namespace } from '../config';
import { resources } from '../resources';

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

/** `age_one` → `age`; cheile fără plural rămân neatinse. */
function stripPluralSuffix(key: string): string {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(`_${suffix}`)) return key.slice(0, -(suffix.length + 1));
  }
  return key;
}

function baseKeys(lang: Language, ns: Namespace): Set<string> {
  return new Set(flatten(resources[lang][ns]).map(stripPluralSuffix));
}

/** Cheile de bază care au variante de plural într-o limbă. */
function pluralBaseKeys(lang: Language, ns: Namespace): Set<string> {
  const keys = flatten(resources[lang][ns]);
  return new Set(
    keys.filter((k) => stripPluralSuffix(k) !== k).map(stripPluralSuffix),
  );
}

describe('cataloage', () => {
  it('fiecare limbă are un fișier pentru fiecare namespace', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const ns of NAMESPACES) {
        expect(resources[lang][ns]).toBeDefined();
      }
    }
  });

  // Româna e referința: e limba implicită și singura garantat completă.
  describe.each(NAMESPACES)('namespace „%s"', (ns) => {
    const roKeys = baseKeys('ro', ns);

    it.each(SUPPORTED_LANGUAGES.filter((l) => l !== 'ro'))(
      'are aceleași chei în „%s" ca în română',
      (lang) => {
        const langKeys = baseKeys(lang, ns);

        const missing = [...roKeys].filter((k) => !langKeys.has(k));
        const extra = [...langKeys].filter((k) => !roKeys.has(k));

        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      },
    );
  });

  /**
   * Pluralul nu e „o cheie în plus": fiecare limbă are propriile categorii CLDR
   * (româna: one/few/other; rusa și ucraineana adaugă `many`; engleza: one/other).
   * Verificăm cu Intl.PluralRules — aceeași sursă pe care o folosește i18next —
   * ca să nu inventăm noi regulile.
   */
  describe('forme de plural', () => {
    it.each(SUPPORTED_LANGUAGES)('„%s" are toate categoriile CLDR cerute', (lang) => {
      const required = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;

      for (const ns of NAMESPACES) {
        const keys = flatten(resources[lang][ns]);

        for (const base of pluralBaseKeys(lang, ns)) {
          const present = required.filter((cat) => keys.includes(`${base}_${cat}`));
          expect({ ns, base, present }).toEqual({ ns, base, present: required });
        }
      }
    });

    it('cheile cu plural sunt aceleași în toate limbile', () => {
      for (const ns of NAMESPACES) {
        const roPlurals = [...pluralBaseKeys('ro', ns)].sort();

        for (const lang of SUPPORTED_LANGUAGES) {
          expect({ ns, lang, keys: [...pluralBaseKeys(lang, ns)].sort() }).toEqual({
            ns,
            lang,
            keys: roPlurals,
          });
        }
      }
    });
  });

  /**
   * O interpolare pierdută la traducere („{{count}} ani" → „ani") produce text
   * fără număr, în producție, tăcut. Comparăm mulțimile de variabile.
   */
  it('păstrează aceleași variabile de interpolare în toate limbile', () => {
    const variablesOf = (text: string) =>
      [...text.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort();

    for (const ns of NAMESPACES) {
      const roCatalog = resources.ro[ns];

      for (const key of flatten(roCatalog)) {
        const roText = key.split('.').reduce<unknown>((o, k) => (o as never)?.[k], roCatalog);
        if (typeof roText !== 'string') continue;

        const expected = variablesOf(roText);
        if (expected.length === 0) continue;

        for (const lang of SUPPORTED_LANGUAGES) {
          const catalog = resources[lang][ns];
          const base = stripPluralSuffix(key);
          // La plural, comparăm pe categoriile existente în limba respectivă.
          const candidates = flatten(catalog).filter((k) => stripPluralSuffix(k) === base);

          for (const candidate of candidates) {
            const text = candidate
              .split('.')
              .reduce<unknown>((o, k) => (o as never)?.[k], catalog);
            if (typeof text !== 'string') continue;

            expect({ ns, lang, key: candidate, vars: variablesOf(text) }).toEqual({
              ns,
              lang,
              key: candidate,
              vars: expected,
            });
          }
        }
      }
    }
  });
});
